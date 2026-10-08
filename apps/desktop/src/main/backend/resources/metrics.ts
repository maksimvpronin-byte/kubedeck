import { formatBytes, formatCpuNotation, formatMemoryNotation } from "../../../shared/formatQuantity";
import type { ConfigStore } from "../config/configStore";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import type { ResourceRow } from "./normalizers";
import { parseCpuMillicores, parseMemoryBytes } from "./quantity";

export { parseCpuMillicores, parseMemoryBytes } from "./quantity";

const METRICS_TIMEOUT_SECONDS = 12;
const METRICS_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const QUOTA_TIMEOUT_SECONDS = 20;
const QUOTA_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
// Node filesystems fill over hours, not seconds. The previous half-minute
// window meant a full kubelet round trip per node practically every time the
// table was opened, which is the wait the user actually sees.
const NODE_DISK_METRICS_CACHE_TTL_MS = 300_000;
const NODE_DISK_METRICS_CONCURRENCY = 12;

interface NodeDiskCacheEntry {
  expiresAt: number;
  value: ResourceRow;
}

const nodeDiskCache = new Map<string, NodeDiskCacheEntry>();
// The nodes table, the cluster overview and the list warm-up can all ask for
// the same node at once. Sharing the in-flight promise keeps that to a single
// kubectl process instead of one per caller.
const nodeDiskInFlight = new Map<string, Promise<ResourceRow>>();
// Bumped whenever a cluster's cache is dropped, so a request that was already
// running against the old endpoint cannot write its answer back afterwards.
const nodeDiskGeneration = new Map<string, number>();

function nodeDiskGenerationOf(clusterId: string): number {
  return nodeDiskGeneration.get(clusterId) ?? 0;
}

function nodeDiskCacheKey(clusterId: string, nodeName: string): string {
  return `${clusterId}\u0000${nodeName}`;
}

export function clearNodeDiskMetricsCache(clusterId?: string): void {
  if (!clusterId) {
    for (const key of nodeDiskGeneration.keys()) nodeDiskGeneration.set(key, nodeDiskGenerationOf(key) + 1);
    nodeDiskCache.clear();
    nodeDiskInFlight.clear();
    return;
  }
  nodeDiskGeneration.set(clusterId, nodeDiskGenerationOf(clusterId) + 1);
  const prefix = `${clusterId}\u0000`;
  for (const key of nodeDiskCache.keys()) {
    if (key.startsWith(prefix)) nodeDiskCache.delete(key);
  }
  for (const key of nodeDiskInFlight.keys()) {
    if (key.startsWith(prefix)) nodeDiskInFlight.delete(key);
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export const formatCpu = (value: number | null): string => formatCpuNotation(value, { fallback: "N/A" });

export const formatMemory = (value: number | null): string => formatMemoryNotation(value, { fallback: "N/A" });

export function parsePodMetrics(output: string, allNamespaces: boolean): Map<string, { cpu: string; memory: string }> {
  const result = new Map<string, { cpu: string; memory: string }>();

  for (const rawLine of output.split(/\r?\n/)) {
    const parts = rawLine.trim().split(/\s+/);
    if (!parts[0]) continue;

    if (allNamespaces) {
      if (parts.length < 4) continue;
      const [namespace, name, cpu, memory] = parts;
      result.set(`${namespace}/${name}`, { cpu, memory });
    } else {
      if (parts.length < 3) continue;
      const [name, cpu, memory] = parts;
      result.set(name, { cpu, memory });
    }
  }

  return result;
}

export function parseNodeMetrics(output: string): Map<string, { cpu: string; cpuPercent: string; memory: string; memoryPercent: string }> {
  const result = new Map<string, { cpu: string; cpuPercent: string; memory: string; memoryPercent: string }>();
  for (const rawLine of output.split(/\r?\n/)) {
    const [name, cpu, cpuPercent, memory, memoryPercent] = rawLine.trim().split(/\s+/);
    if (name && cpu && memory) result.set(name, { cpu, cpuPercent: cpuPercent ?? "", memory, memoryPercent: memoryPercent ?? "" });
  }
  return result;
}

export type NodeMetricsSnapshot = ReturnType<typeof parseNodeMetrics> | null;

const METRICS_API = "/apis/metrics.k8s.io/v1beta1";

// A Metrics API quantity in millicores, unrounded ("1234567n" is 1.234567).
function cpuMillicoresExact(value: unknown): number | null {
  const raw = text(value).trim();
  const match = /^(\d+(?:\.\d+)?)(n|u|m)?$/.exec(raw);
  if (!match) return null;
  const amount = Number(match[1]);
  if (match[2] === "n") return amount / 1_000_000;
  if (match[2] === "u") return amount / 1000;
  if (match[2] === "m") return amount;
  return amount * 1000;
}

// How `kubectl top` prints a reading: CPU in whole millicores rounded up (as
// Quantity.MilliValue rounds), memory in whole MiB rounded down. The tables
// were built on that output, so the Metrics API read directly is rendered the
// same way.
function topCpu(millicores: number): string {
  return `${Math.ceil(millicores - 1e-9)}m`;
}

function topMemory(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))}Mi`;
}

function metricItems(data: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(data.items) ? data.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

// PodMetrics summed per pod, keyed the way `parsePodMetrics` keys `kubectl top pods`.
export function podMetricsFromApi(data: Record<string, unknown>, allNamespaces: boolean): Map<string, { cpu: string; memory: string }> {
  const result = new Map<string, { cpu: string; memory: string }>();
  for (const item of metricItems(data)) {
    const metadata = asRecord(item.metadata);
    const name = text(metadata.name);
    if (!name) continue;
    let cpu = 0;
    let memory = 0;
    for (const container of Array.isArray(item.containers) ? item.containers : []) {
      const usage = asRecord(asRecord(container).usage);
      cpu += cpuMillicoresExact(usage.cpu) ?? 0;
      memory += parseMemoryBytes(usage.memory) ?? 0;
    }
    result.set(allNamespaces ? `${text(metadata.namespace)}/${name}` : name, { cpu: topCpu(cpu), memory: topMemory(memory) });
  }
  return result;
}

// NodeMetrics by node name. The percentages `kubectl top nodes` prints need
// the node list; the rows they are applied to already carry allocatable, so
// they are left empty here and worked out there.
export function nodeMetricsFromApi(data: Record<string, unknown>): Map<string, { cpu: string; cpuPercent: string; memory: string; memoryPercent: string }> {
  const result = new Map<string, { cpu: string; cpuPercent: string; memory: string; memoryPercent: string }>();
  for (const item of metricItems(data)) {
    const name = text(asRecord(item.metadata).name);
    const usage = asRecord(item.usage);
    const cpu = cpuMillicoresExact(usage.cpu);
    const memory = parseMemoryBytes(usage.memory);
    if (!name || cpu === null || memory === null) continue;
    result.set(name, { cpu: topCpu(cpu), cpuPercent: "", memory: topMemory(memory), memoryPercent: "" });
  }
  return result;
}

function readMetricsApi(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return runner.runJson(clusterCommand(configStore, clusterId, ["get", "--raw", path], METRICS_TIMEOUT_SECONDS, METRICS_MAX_OUTPUT_BYTES), signal);
}

// Go's integer percentage, as `kubectl top nodes` prints it.
function topPercent(used: number | null, total: number | null): string {
  if (used === null || total === null || total <= 0) return "";
  return `${Math.floor((used * 100) / total)}%`;
}

// `kubectl top` does not depend on the resource list, so the caller can start it
// before awaiting `kubectl get` and pay for one round trip instead of two. A
// missing metrics-server is reported as a KubectlError and leaves the usage
// columns empty, exactly as the combined call did.
export async function fetchNodeMetrics(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, signal?: AbortSignal): Promise<NodeMetricsSnapshot> {
  try {
    // Read from the Metrics API: `kubectl top nodes` is the same reading plus a
    // node list and API discovery, in a process of its own.
    return nodeMetricsFromApi(await readMetricsApi(configStore, runner, clusterId, `${METRICS_API}/nodes`, signal));
  } catch (error) {
    if (!(error instanceof KubectlError)) throw error;
    return null;
  }
}

export function applyNodeMetricsSnapshot(metrics: NodeMetricsSnapshot, rows: ResourceRow[]): void {
  if (!metrics) return;
  for (const row of rows) {
    const metric = metrics.get(text(row.name));
    if (!metric) continue;
    const cpuAllocatable = parseCpuMillicores(row.cpuAllocatableRaw);
    const cpuUsed = parseCpuMillicores(metric.cpu);
    const cpuFree = remaining(cpuAllocatable, cpuUsed);
    const memoryUsed = parseMemoryBytes(metric.memory);
    const memoryAllocatable = parseMemoryBytes(row.memoryAllocatableRaw);
    const memoryFree = remaining(memoryAllocatable, memoryUsed);
    const cpuPercent = metric.cpuPercent || topPercent(cpuUsed, cpuAllocatable);
    const memoryPercent = metric.memoryPercent || topPercent(memoryUsed, memoryAllocatable);
    row.cpuUsage = metric.cpu;
    row.cpuUsageRaw = metric.cpu;
    row.cpuUsagePercent = cpuPercent;
    row.cpuAvailable = formatCpu(cpuFree);
    row.memoryUsage = formatNodeBytes(memoryUsed);
    row.memoryUsageRaw = metric.memory;
    row.memoryUsagePercent = memoryPercent;
    row.memoryAvailable = formatNodeBytes(memoryFree);
    // The displayed values are formatted strings; the table sorts on these.
    row.cpuUsagePercentValue = percentValue(cpuPercent);
    row.memoryUsagePercentValue = percentValue(memoryPercent);
    row.nodeResources = `CPU ${metric.cpu} used · ${formatCpu(cpuFree)} free\nRAM ${formatNodeBytes(memoryUsed)} used · ${formatNodeBytes(memoryFree)} free`;
  }
}

export async function applyNodeMetrics(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, rows: ResourceRow[]): Promise<void> {
  applyNodeMetricsSnapshot(await fetchNodeMetrics(configStore, runner, clusterId), rows);
}

export function loadNodeDiskMetrics(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, nodeName: string, now: () => number = Date.now): Promise<ResourceRow> {
  const key = nodeDiskCacheKey(clusterId, nodeName);
  const cached = nodeDiskCache.get(key);
  if (cached && cached.expiresAt > now()) {
    return Promise.resolve(cached.value);
  }

  const running = nodeDiskInFlight.get(key);
  if (running) return running;

  const request = fetchNodeDiskMetrics(configStore, runner, clusterId, nodeName, now).finally(() => {
    if (nodeDiskInFlight.get(key) === request) nodeDiskInFlight.delete(key);
  });
  nodeDiskInFlight.set(key, request);
  return request;
}

async function fetchNodeDiskMetrics(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, nodeName: string, now: () => number): Promise<ResourceRow> {
  const key = nodeDiskCacheKey(clusterId, nodeName);
  const generation = nodeDiskGenerationOf(clusterId);
  const data = await runner.runJson(clusterCommand(configStore, clusterId, ["get", `--raw=/api/v1/nodes/${nodeName}/proxy/stats/summary`], METRICS_TIMEOUT_SECONDS, METRICS_MAX_OUTPUT_BYTES));
  const fs = asRecord(asRecord(data.node).fs);
  const used = finiteNumber(fs.usedBytes);
  const available = finiteNumber(fs.availableBytes);
  const capacity = finiteNumber(fs.capacityBytes);
  const value: ResourceRow = {
    uid: "",
    name: nodeName,
    diskUsage: formatNodeBytes(used),
    diskUsageRaw: used ?? undefined,
    diskAvailable: formatNodeBytes(available),
    diskAvailableRaw: available ?? undefined,
    diskObservedCapacity: formatNodeBytes(capacity),
    diskObservedCapacityRaw: capacity ?? undefined,
    diskUsagePercent: percentage(used, capacity ?? (used !== null && available !== null ? used + available : null)),
  };
  // The cluster may have been removed or its kubeconfig rewritten while this
  // request was running, in which case the answer belongs to an endpoint that
  // no longer applies. The caller still gets it; the cache does not.
  if (generation === nodeDiskGenerationOf(clusterId)) {
    nodeDiskCache.set(key, { expiresAt: now() + NODE_DISK_METRICS_CACHE_TTL_MS, value });
  }
  return value;
}

export async function applyNodeDiskMetrics(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, rows: ResourceRow[], now: () => number = Date.now): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const row = rows[next++];
      const identity = { uid: row.uid, name: row.name };
      try {
        Object.assign(row, await loadNodeDiskMetrics(configStore, runner, clusterId, String(row.name), now), identity);
      } catch (error) {
        if (!(error instanceof KubectlError)) throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(NODE_DISK_METRICS_CONCURRENCY, rows.length) }, worker));
}

// Started, not awaited, when the nodes list is served: the kubelet round trips
// begin while the renderer is still painting the table, and the per-node
// requests that follow join the in-flight work or hit the cache instead of
// starting their own kubectl process.
export function warmNodeDiskMetrics(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, rows: ResourceRow[]): void {
  const names = rows.map((row) => String(row.name ?? "")).filter(Boolean);
  if (!names.length) return;
  let next = 0;
  const worker = async () => {
    while (next < names.length) {
      await loadNodeDiskMetrics(configStore, runner, clusterId, names[next++]).catch(() => undefined);
    }
  };
  void Promise.all(Array.from({ length: Math.min(NODE_DISK_METRICS_CONCURRENCY, names.length) }, worker));
}

function percentage(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

// A request is a scheduling floor, not a ceiling: a pod without a limit may run
// well above it, and clamping that to 100% would hide exactly the pods worth
// looking at. The ratio against a request is therefore reported unclamped.
function unclampedPercentage(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null;
  return Math.max(0, Math.round((used / total) * 100));
}

function remaining(total: number | null, used: number | null): number | null {
  return total === null || used === null ? null : Math.max(0, total - used);
}

// `kubectl top` reports percentages as "39%".
function percentValue(value: unknown): number | undefined {
  const parsed = Number.parseFloat(String(value ?? "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

// The result travels as a row field that ResourceSummary parses back, so it
// must stay in the shape that regex accepts: a number, a space, a binary unit.
const formatNodeBytes = (value: number | null): string => formatBytes(value, { fallback: "N/A" });

export interface PodMetricsSnapshot {
  metrics: ReturnType<typeof parsePodMetrics>;
  allNamespaces: boolean;
}

export async function fetchPodMetrics(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, namespace: string, signal?: AbortSignal): Promise<PodMetricsSnapshot | null> {
  const allNamespaces = namespace === "all";

  try {
    // Pods with no namespace are the kubeconfig context's default, which only
    // kubectl knows; every other scope reads the Metrics API directly.
    if (namespace === "_cluster") {
      const result = await runner.run(clusterCommand(configStore, clusterId, ["top", "pods", "--no-headers"], METRICS_TIMEOUT_SECONDS, METRICS_MAX_OUTPUT_BYTES), signal);
      return { metrics: parsePodMetrics(result.stdout, false), allNamespaces };
    }
    const path = allNamespaces ? `${METRICS_API}/pods` : `${METRICS_API}/namespaces/${encodeURIComponent(namespace)}/pods`;
    return { metrics: podMetricsFromApi(await readMetricsApi(configStore, runner, clusterId, path, signal), allNamespaces), allNamespaces };
  } catch (error) {
    if (!(error instanceof KubectlError)) throw error;
    return null;
  }
}

export function applyPodMetricsSnapshot(snapshot: PodMetricsSnapshot | null, rows: ResourceRow[]): void {
  if (!snapshot) return;
  const { metrics, allNamespaces } = snapshot;

  for (const row of rows) {
    const name = text(row.name);
    const rowNamespace = text(row.namespace);
    const key = allNamespaces ? `${rowNamespace}/${name}` : name;
    const metric = metrics.get(key);
    const cpuUsed = parseCpuMillicores(metric?.cpu);
    const memoryUsed = parseMemoryBytes(metric?.memory);
    row.cpuUsage = metric?.cpu ?? "";
    // `kubectl top` reports memory in whichever unit it likes, and it likes Ki:
    // 403840Ki is unreadable next to a 70Mi request. The recorded-samples route
    // already formats the same reading, so leaving this raw also made the two
    // paths disagree and rewrite the row on every refresh.
    row.memoryUsage = memoryUsed === null ? (metric?.memory ?? "") : formatMemory(Math.round(memoryUsed));
    // Pods are sorted on absolute usage: a percentage needs a limit, and most
    // pods do not have one.
    row.podCpuUsageValue = cpuUsed ?? undefined;
    row.podMemoryUsageValue = memoryUsed ?? undefined;
    const cpuLimit = finiteNumber(row.podCpuLimitValue);
    const memoryLimit = finiteNumber(row.podMemoryLimitValue);
    row.podCpuUsagePercent = percentage(cpuUsed, cpuLimit);
    row.podMemoryUsagePercent = percentage(memoryUsed, memoryLimit);
    // Without a limit there is still a scheduling floor to compare against.
    // CPU limits are far more often omitted than memory limits, which left the
    // CPU usage of most pods with no bar at all.
    row.podCpuRequestPercent = unclampedPercentage(cpuUsed, finiteNumber(row.podCpuRequestValue));
    row.podMemoryRequestPercent = unclampedPercentage(memoryUsed, finiteNumber(row.podMemoryRequestValue));
  }
}

export async function applyPodMetrics(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, namespace: string, rows: ResourceRow[]): Promise<void> {
  applyPodMetricsSnapshot(await fetchPodMetrics(configStore, runner, clusterId, namespace), rows);
}

interface NamespaceUsage {
  cpu: number;
  memory: number;
}

interface NamespaceQuota {
  cpu: number | null;
  memory: number | null;
  storage: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export interface NamespaceMetricsSnapshot {
  usage: Map<string, NamespaceUsage>;
  quota: Map<string, NamespaceQuota>;
  metricsAvailable: boolean;
}

export async function fetchNamespaceMetrics(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, signal?: AbortSignal): Promise<NamespaceMetricsSnapshot> {
  const usage = new Map<string, NamespaceUsage>();
  let metricsAvailable = true;

  try {
    const pods = podMetricsFromApi(await readMetricsApi(configStore, runner, clusterId, `${METRICS_API}/pods`, signal), true);

    for (const [key, metric] of pods) {
      const namespace = key.slice(0, key.indexOf("/"));
      const cpu = parseCpuMillicores(metric.cpu);
      const memory = parseMemoryBytes(metric.memory);
      const bucket = usage.get(namespace) ?? { cpu: 0, memory: 0 };
      if (cpu !== null) bucket.cpu += cpu;
      if (memory !== null) bucket.memory += memory;
      usage.set(namespace, bucket);
    }
  } catch (error) {
    if (!(error instanceof KubectlError)) throw error;
    metricsAvailable = false;
  }

  const quota = new Map<string, NamespaceQuota>();
  try {
    const data = await runner.runJson(clusterCommand(configStore, clusterId, ["get", "--raw", "/api/v1/resourcequotas"], QUOTA_TIMEOUT_SECONDS, QUOTA_MAX_OUTPUT_BYTES), signal);
    const items = Array.isArray(data.items) ? data.items : [];

    for (const rawItem of items) {
      const item = asRecord(rawItem);
      const metadata = asRecord(item.metadata);
      const namespace = text(metadata.namespace);
      if (!namespace) continue;
      const status = asRecord(item.status);
      const hard = asRecord(status.hard);

      let cpu: number | null = null;
      for (const key of ["limits.cpu", "requests.cpu", "cpu"]) {
        cpu = parseCpuMillicores(hard[key]);
        if (cpu !== null) break;
      }

      let memory: number | null = null;
      for (const key of ["limits.memory", "requests.memory", "memory"]) {
        memory = parseMemoryBytes(hard[key]);
        if (memory !== null) break;
      }

      const persistentStorage = parseMemoryBytes(hard["requests.storage"]);
      const ephemeralStorage = parseMemoryBytes(hard["limits.ephemeral-storage"]) ?? parseMemoryBytes(hard["requests.ephemeral-storage"]);
      const storage = persistentStorage === null && ephemeralStorage === null ? null : (persistentStorage ?? 0) + (ephemeralStorage ?? 0);
      const usedValues = asRecord(status.used);
      const persistentStorageUsed = parseMemoryBytes(usedValues["requests.storage"]);
      const ephemeralStorageUsed = parseMemoryBytes(usedValues["limits.ephemeral-storage"]) ?? parseMemoryBytes(usedValues["requests.ephemeral-storage"]);
      const storageUsed = persistentStorageUsed === null && ephemeralStorageUsed === null ? null : (persistentStorageUsed ?? 0) + (ephemeralStorageUsed ?? 0);

      const bucket = quota.get(namespace) ?? { cpu: null, memory: null, storage: null };
      if (cpu !== null) bucket.cpu = (bucket.cpu ?? 0) + cpu;
      if (memory !== null) bucket.memory = (bucket.memory ?? 0) + memory;
      if (storage !== null) bucket.storage = (bucket.storage ?? 0) + storage;
      quota.set(namespace, bucket);
      const usageBucket = usage.get(namespace) as (NamespaceUsage & { storage?: number }) | undefined;
      if (storageUsed !== null) {
        const next = usageBucket ?? { cpu: 0, memory: 0 };
        next.storage = (next.storage ?? 0) + storageUsed;
        usage.set(namespace, next);
      }
    }
  } catch (error) {
    if (!(error instanceof KubectlError)) throw error;
  }

  return { usage, quota, metricsAvailable };
}

export function applyNamespaceMetricsSnapshot({ usage, quota, metricsAvailable }: NamespaceMetricsSnapshot, rows: ResourceRow[]): void {
  for (const row of rows) {
    const namespace = text(row.name) || text(row.namespace);
    const used = usage.get(namespace) ?? { cpu: 0, memory: 0 };
    const hard = quota.get(namespace) ?? { cpu: null, memory: null, storage: null };
    const usedCpu = metricsAvailable ? used.cpu : null;
    const usedMemory = metricsAvailable ? used.memory : null;
    const cpuQuota = hard.cpu === null ? "no quota" : formatCpu(hard.cpu);
    const memoryQuota = hard.memory === null ? "no quota" : formatMemory(hard.memory);
    const metricsSuffix = metricsAvailable ? "" : " (metrics N/A)";

    row.namespaceCpuUsed = formatCpu(usedCpu);
    row.namespaceMemoryUsed = formatMemory(usedMemory);
    row.namespaceCpuQuota = cpuQuota;
    row.namespaceMemoryQuota = memoryQuota;
    const storageUsed = (used as NamespaceUsage & { storage?: number }).storage ?? 0;
    row.namespaceCpuUsedValue = usedCpu;
    row.namespaceCpuQuotaValue = hard.cpu;
    row.namespaceCpuUsagePercent = percentage(usedCpu, hard.cpu);
    row.namespaceMemoryUsedValue = usedMemory;
    row.namespaceMemoryQuotaValue = hard.memory;
    row.namespaceMemoryUsagePercent = percentage(usedMemory, hard.memory);
    row.namespaceStorageUsed = formatNodeBytes(storageUsed);
    row.namespaceStorageQuota = hard.storage === null ? "no quota" : formatNodeBytes(hard.storage);
    row.namespaceStorageUsedValue = storageUsed;
    row.namespaceStorageQuotaValue = hard.storage;
    row.namespaceStorageUsagePercent = percentage(storageUsed, hard.storage);
    row.namespaceResources = `CPU ${formatCpu(usedCpu)} / ${cpuQuota}; ` + `RAM ${formatMemory(usedMemory)} / ${memoryQuota}${metricsSuffix}`;
  }
}

export async function applyNamespaceMetrics(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, rows: ResourceRow[]): Promise<void> {
  applyNamespaceMetricsSnapshot(await fetchNamespaceMetrics(configStore, runner, clusterId), rows);
}
