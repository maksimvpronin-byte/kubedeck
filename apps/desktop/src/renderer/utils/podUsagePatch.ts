import type { PodUsageEntry, ResourceRow } from "../types";

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Mirrors `percentage` in the backend's resources/metrics.ts. The two have to
// agree, because a row can carry a usage reading that came from a list load on
// one refresh and from recorded samples on the next.
function percentage(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

// A request is a scheduling floor, not a ceiling, so this one is not clamped.
function unclampedPercentage(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null;
  return Math.max(0, Math.round((used / total) * 100));
}

export function podUsageKey(namespace: unknown, name: unknown): string {
  return `${String(namespace ?? "")}/${String(name ?? "")}`;
}

// Recorded usage only refreshes the usage fields: everything else on the row
// belongs to the list response and must survive untouched.
export function applyPodUsage(rows: ResourceRow[], entries: PodUsageEntry[]): ResourceRow[] {
  if (entries.length === 0) return rows;
  const byKey = new Map(entries.map((entry) => [podUsageKey(entry.namespace, entry.pod), entry]));
  let changed = false;

  const next = rows.map((row) => {
    const entry = byKey.get(podUsageKey(row.namespace, row.name));
    if (!entry) return row;
    if (row.cpuUsage === entry.cpu && row.memoryUsage === entry.memory) return row;
    changed = true;

    const cpuLimit = numeric(row.podCpuLimitValue);
    const memoryLimit = numeric(row.podMemoryLimitValue);
    return {
      ...row,
      cpuUsage: entry.cpu,
      memoryUsage: entry.memory,
      podCpuUsageValue: entry.cpuMillicores ?? undefined,
      podMemoryUsageValue: entry.memoryBytes ?? undefined,
      podCpuUsagePercent: percentage(entry.cpuMillicores, cpuLimit),
      podMemoryUsagePercent: percentage(entry.memoryBytes, memoryLimit),
      podCpuRequestPercent: unclampedPercentage(entry.cpuMillicores, numeric(row.podCpuRequestValue)),
      podMemoryRequestPercent: unclampedPercentage(entry.memoryBytes, numeric(row.podMemoryRequestValue)),
    } satisfies ResourceRow;
  });

  // A new array on every tick would re-render the table for nothing.
  return changed ? next : rows;
}
