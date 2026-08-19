import fs from "node:fs";
import path from "node:path";
import type { ConfigStore } from "../config/configStore";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import { formatCpu, formatMemory, parsePodMetrics } from "./metrics";
import { UsageHistoryStore, type UsageHistoryResult, type UsageSample } from "./usageHistoryStore";
import { formatWorkloadKey, workloadKeyForPod } from "./workloadKey";

const SAMPLE_TIMEOUT_SECONDS = 20;
const SAMPLE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_INTERVAL_MS = 30_000;
const BACKFILL_MAX_AGE_MS = 2 * 60_000;

type JsonObject = Record<string, unknown>;

export interface UsageHistorySamplerOptions {
  intervalMs?: number;
  now?: () => number;
  // Tests drive their own directory; production always purges the real one.
  purgeOnStart?: boolean;
}

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

export function parseCpuMillicoresValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(m|n|u)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  if (match[2] === "m") return amount;
  if (match[2] === "u") return amount / 1000;
  if (match[2] === "n") return amount / 1_000_000;
  return amount * 1000;
}

export function parseMemoryBytesValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei|k|K|M|G|T|P|E)?i?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const factors: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
    k: 1000,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6,
  };
  return amount * (factors[match[2] ?? ""] ?? 1);
}

// `kubectl top` keys pods as `namespace/pod` only with -A; otherwise the
// namespace has to come from the request that asked for them.
export function samplesFromPodMetrics(metrics: Map<string, { cpu: string; memory: string }>, allNamespaces: boolean, fallbackNamespace: string): UsageSample[] {
  const samples: UsageSample[] = [];
  for (const [key, metric] of metrics) {
    const separator = key.indexOf("/");
    const namespace = allNamespaces && separator >= 0 ? key.slice(0, separator) : fallbackNamespace;
    const pod = allNamespaces && separator >= 0 ? key.slice(separator + 1) : key;
    const cpuMillicores = parseCpuMillicoresValue(metric.cpu);
    const memoryBytes = parseMemoryBytesValue(metric.memory);
    if (cpuMillicores === null && memoryBytes === null) continue;
    samples.push({ namespace, pod, cpuMillicores, memoryBytes });
  }
  return samples;
}

export function samplesFromTopOutput(stdout: string, allNamespaces: boolean, fallbackNamespace: string): UsageSample[] {
  return samplesFromPodMetrics(parsePodMetrics(stdout, allNamespaces), allNamespaces, fallbackNamespace);
}

// History lives for one run of the application: it is held in memory, dropped
// when KubeDeck exits, and bounded by the retention window while it runs. There
// is no Prometheus behind it to backfill from, so a fresh start means a fresh
// window.
export class UsageHistorySampler {
  private readonly store: UsageHistoryStore;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly intervalMs: number;
  private closed = false;

  constructor(
    private readonly configStore: ConfigStore,
    private readonly runner: KubectlRunner,
    private readonly log: (message: string) => void,
    options: UsageHistorySamplerOptions = {},
  ) {
    this.store = new UsageHistoryStore(options.now ?? Date.now);
    this.intervalMs = Math.max(5_000, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    if (options.purgeOnStart !== false) this.purgeStoredHistory();
  }

  // Earlier versions kept history on disk between runs. Nothing reads those
  // files any more, so they are removed rather than left behind holding
  // cluster data the user has no way to see.
  purgeStoredHistory(): void {
    const directory = this.configStore.paths.metrics;
    let entries: string[];
    try {
      entries = fs.readdirSync(directory);
    } catch {
      // No directory means nothing was ever written.
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json") && !entry.endsWith(".tmp")) continue;
      try {
        fs.rmSync(path.join(directory, entry), { force: true });
      } catch (error) {
        this.log(`usage history cleanup failed for ${entry}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async sample(clusterId: string): Promise<void> {
    try {
      const result = await this.runner.run(clusterCommand(this.configStore, clusterId, ["top", "pods", "-A", "--no-headers"], SAMPLE_TIMEOUT_SECONDS, SAMPLE_MAX_OUTPUT_BYTES));
      this.ingest(clusterId, samplesFromTopOutput(result.stdout, true, ""));
    } catch (error) {
      // A cluster without metrics-server, or one that went away, must not turn
      // into a repeating error: the next tick simply tries again.
      if (!(error instanceof KubectlError)) this.log(`usage history sample failed for ${clusterId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  ingest(clusterId: string, samples: UsageSample[]): void {
    if (this.closed || samples.length === 0) return;
    this.store.record(clusterId, samples);
  }

  // Called with a freshly loaded pod list: `kubectl top` carries no labels or
  // ownerReferences, so this is the only place the workload behind a pod name
  // can be learned.
  attributePods(clusterId: string, rows: JsonObject[]): void {
    if (this.closed || rows.length === 0) return;
    for (const row of rows) {
      const pod = text(row.name);
      if (!pod) continue;
      const workload = formatWorkloadKey(workloadKeyForPod(row));
      if (workload) this.store.attribute(clusterId, text(row.namespace), pod, workload);
    }
  }

  ensureCluster(clusterId: string): void {
    if (this.closed || this.timers.has(clusterId)) return;
    const timer = setInterval(() => void this.sample(clusterId), this.intervalMs);
    timer.unref?.();
    this.timers.set(clusterId, timer);
    void this.sample(clusterId);
  }

  // Fills a table row whose `kubectl top` call predates the pod appearing in
  // metrics-server. Two minutes is generous next to the sampling interval and
  // still short enough that a pod which stopped reporting goes back to blank.
  backfillPodMetrics(clusterId: string, metrics: Map<string, { cpu: string; memory: string }>, rows: JsonObject[], allNamespaces: boolean, fallbackNamespace: string): void {
    for (const row of rows) {
      const pod = text(row.name);
      if (!pod) continue;
      const namespace = text(row.namespace) || fallbackNamespace;
      const key = allNamespaces ? `${namespace}/${pod}` : pod;
      if (metrics.has(key)) continue;
      const recorded = this.store.latestSample(clusterId, namespace, pod, BACKFILL_MAX_AGE_MS);
      if (!recorded) continue;
      // An empty string means "not measured", which is what a row without a
      // metric already carries. formatCpu/formatMemory would render the literal
      // "N/A" here, turning a missing half of the reading into fake content.
      metrics.set(key, {
        cpu: recorded.cpuMillicores === null ? "" : formatCpu(Math.round(recorded.cpuMillicores)),
        memory: recorded.memoryBytes === null ? "" : formatMemory(Math.round(recorded.memoryBytes)),
      });
    }
  }

  // Current usage for every pod in scope, served entirely from what has
  // already been sampled: the table can refresh its numbers without a second
  // `kubectl get pods`, which is the expensive half of a list reload.
  currentUsage(clusterId: string, namespace: string): Array<{ namespace: string; pod: string; cpu: string; memory: string; cpuMillicores: number | null; memoryBytes: number | null }> {
    return this.store.recentSamples(clusterId, namespace, BACKFILL_MAX_AGE_MS).map((entry) => ({
      namespace: entry.namespace,
      pod: entry.pod,
      cpu: entry.cpuMillicores === null ? "" : formatCpu(Math.round(entry.cpuMillicores)),
      memory: entry.memoryBytes === null ? "" : formatMemory(Math.round(entry.memoryBytes)),
      cpuMillicores: entry.cpuMillicores === null ? null : Math.round(entry.cpuMillicores),
      memoryBytes: entry.memoryBytes === null ? null : Math.round(entry.memoryBytes),
    }));
  }

  history(clusterId: string, namespace: string, pod: string, podRow: JsonObject | null = null): UsageHistoryResult {
    const key = podRow ? workloadKeyForPod(podRow) : null;
    if (key) this.store.attribute(clusterId, namespace, pod, formatWorkloadKey(key));
    return this.store.history(clusterId, namespace, pod, key ? { key: formatWorkloadKey(key), exact: key.exact } : undefined);
  }

  stopCluster(clusterId: string): void {
    const timer = this.timers.get(clusterId);
    if (timer) clearInterval(timer);
    this.timers.delete(clusterId);
  }

  // Removing a cluster must take its history with it: it is data about an
  // endpoint the user asked KubeDeck to forget.
  forgetCluster(clusterId: string): void {
    this.stopCluster(clusterId);
    this.store.clearCluster(clusterId);
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }

  seriesCount(clusterId: string): number {
    return this.store.seriesCount(clusterId);
  }
}
