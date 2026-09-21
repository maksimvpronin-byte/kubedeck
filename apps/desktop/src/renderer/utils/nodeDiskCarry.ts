import type { ResourceRow } from "../types";

// What useNodeDiskUsage adds to a node row. A list refresh does not carry
// them: they come from each node's kubelet, one request at a time.
const DISK_FIELDS = [
  "diskUsage",
  "diskUsageRaw",
  "diskAvailable",
  "diskAvailableRaw",
  "diskObservedCapacity",
  "diskObservedCapacityRaw",
  "diskUsagePercent",
  "diskMetricsUnavailable",
  "diskLoading",
] as const;

function rowKey(row: ResourceRow): string {
  return String(row.uid || row.name);
}

// A node list refresh replaces every row, and the rows it brings have no disk
// reading. The watch refreshes the list each time a kubelet reports in, so the
// Disk bars went blank and came back from the cache on every refresh - on a
// wide cluster, a steady flicker. The reading on screen is kept until the
// disk loader replaces it; a row that brings its own is left alone.
export function carryNodeDisk(previous: ResourceRow[] | undefined, next: ResourceRow[]): ResourceRow[] {
  if (!previous?.length) return next;
  const byKey = new Map(previous.map((row) => [rowKey(row), row]));
  return next.map((row) => {
    const before = byKey.get(rowKey(row));
    if (!before || row.diskUsagePercent !== undefined || row.diskMetricsUnavailable !== undefined) return row;
    const carried: ResourceRow = { ...row };
    let any = false;
    for (const field of DISK_FIELDS) {
      if (before[field] === undefined) continue;
      carried[field] = before[field];
      any = true;
    }
    return any ? carried : row;
  });
}
