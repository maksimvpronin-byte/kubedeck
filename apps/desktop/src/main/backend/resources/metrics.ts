import type { ConfigStore } from "../config/configStore";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import type { ResourceRow } from "./normalizers";

const METRICS_TIMEOUT_SECONDS = 12;
const METRICS_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const QUOTA_TIMEOUT_SECONDS = 20;
const QUOTA_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseCpuMillicores(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  let parsed: number;
  if (raw.endsWith("m")) parsed = Number(raw.slice(0, -1));
  else if (raw.endsWith("u")) parsed = Number(raw.slice(0, -1)) / 1000;
  else if (raw.endsWith("n")) parsed = Number(raw.slice(0, -1)) / 1_000_000;
  else parsed = Number(raw) * 1000;

  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function parseMemoryBytes(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const units: Array<[string, number]> = [
    ["Ki", 1024],
    ["Mi", 1024 ** 2],
    ["Gi", 1024 ** 3],
    ["Ti", 1024 ** 4],
    ["Pi", 1024 ** 5],
    ["Ei", 1024 ** 6],
    ["K", 1000],
    ["M", 1000 ** 2],
    ["G", 1000 ** 3],
    ["T", 1000 ** 4],
    ["P", 1000 ** 5],
    ["E", 1000 ** 6],
  ];

  for (const [suffix, multiplier] of units) {
    if (raw.endsWith(suffix)) {
      const parsed = Number(raw.slice(0, -suffix.length));
      return Number.isFinite(parsed) ? Math.trunc(parsed * multiplier) : null;
    }
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function formatCpu(value: number | null): string {
  if (value === null) return "N/A";
  if (value === 0) return "0m";
  if (value % 1000 === 0) return String(value / 1000);
  return `${value}m`;
}

function formatMemory(value: number | null): string {
  if (value === null) return "N/A";
  if (value === 0) return "0Mi";

  for (const [suffix, multiplier] of [
    ["Gi", 1024 ** 3],
    ["Mi", 1024 ** 2],
    ["Ki", 1024],
  ] as const) {
    if (value >= multiplier && value % multiplier === 0) {
      return `${value / multiplier}${suffix}`;
    }
  }

  if (value >= 1024 ** 2) {
    return `${Math.round((value / 1024 ** 2) * 10) / 10}Mi`;
  }
  if (value >= 1024) {
    return `${Math.round((value / 1024) * 10) / 10}Ki`;
  }
  return `${value}B`;
}

export function parsePodMetrics(
  output: string,
  allNamespaces: boolean,
): Map<string, { cpu: string; memory: string }> {
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

export async function applyPodMetrics(
  configStore: ConfigStore,
  runner: KubectlRunner,
  clusterId: string,
  namespace: string,
  rows: ResourceRow[],
): Promise<void> {
  const allNamespaces = namespace === "all";
  const args = ["top", "pods", "--no-headers"];
  if (allNamespaces) args.push("-A");
  else if (namespace !== "_cluster") args.push("-n", namespace);

  try {
    const result = await runner.run(
      clusterCommand(
        configStore,
        clusterId,
        args,
        METRICS_TIMEOUT_SECONDS,
        METRICS_MAX_OUTPUT_BYTES,
      ),
    );
    const metrics = parsePodMetrics(result.stdout, allNamespaces);

    for (const row of rows) {
      const name = text(row.name);
      const rowNamespace = text(row.namespace);
      const key = allNamespaces ? `${rowNamespace}/${name}` : name;
      const metric = metrics.get(key);
      row.cpuUsage = metric?.cpu ?? "";
      row.memoryUsage = metric?.memory ?? "";
    }
  } catch (error) {
    if (!(error instanceof KubectlError)) throw error;
  }
}

interface NamespaceUsage {
  cpu: number;
  memory: number;
}

interface NamespaceQuota {
  cpu: number | null;
  memory: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function applyNamespaceMetrics(
  configStore: ConfigStore,
  runner: KubectlRunner,
  clusterId: string,
  rows: ResourceRow[],
): Promise<void> {
  const usage = new Map<string, NamespaceUsage>();
  let metricsAvailable = true;

  try {
    const result = await runner.run(
      clusterCommand(
        configStore,
        clusterId,
        ["top", "pods", "-A", "--no-headers"],
        METRICS_TIMEOUT_SECONDS,
        METRICS_MAX_OUTPUT_BYTES,
      ),
    );

    for (const rawLine of result.stdout.split(/\r?\n/)) {
      const parts = rawLine.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const namespace = parts[0];
      const cpu = parseCpuMillicores(parts.at(-2));
      const memory = parseMemoryBytes(parts.at(-1));
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
    const data = await runner.runJson(
      clusterCommand(
        configStore,
        clusterId,
        ["get", "resourcequota", "-A", "-o", "json"],
        QUOTA_TIMEOUT_SECONDS,
        QUOTA_MAX_OUTPUT_BYTES,
      ),
    );
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

      const bucket = quota.get(namespace) ?? { cpu: null, memory: null };
      if (cpu !== null) bucket.cpu = (bucket.cpu ?? 0) + cpu;
      if (memory !== null) bucket.memory = (bucket.memory ?? 0) + memory;
      quota.set(namespace, bucket);
    }
  } catch (error) {
    if (!(error instanceof KubectlError)) throw error;
  }

  for (const row of rows) {
    const namespace = text(row.name) || text(row.namespace);
    const used = usage.get(namespace) ?? { cpu: 0, memory: 0 };
    const hard = quota.get(namespace) ?? { cpu: null, memory: null };
    const usedCpu = metricsAvailable ? used.cpu : null;
    const usedMemory = metricsAvailable ? used.memory : null;
    const cpuQuota = hard.cpu === null ? "no quota" : formatCpu(hard.cpu);
    const memoryQuota =
      hard.memory === null ? "no quota" : formatMemory(hard.memory);
    const metricsSuffix = metricsAvailable ? "" : " (metrics N/A)";

    row.namespaceCpuUsed = formatCpu(usedCpu);
    row.namespaceMemoryUsed = formatMemory(usedMemory);
    row.namespaceCpuQuota = cpuQuota;
    row.namespaceMemoryQuota = memoryQuota;
    row.namespaceResources =
      `CPU ${formatCpu(usedCpu)} / ${cpuQuota}; ` +
      `RAM ${formatMemory(usedMemory)} / ${memoryQuota}${metricsSuffix}`;
  }
}
