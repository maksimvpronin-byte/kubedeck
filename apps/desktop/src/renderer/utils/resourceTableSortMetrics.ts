export interface ColumnSortMetric {
  key: string;
  label: string;
}

// A usage column draws several bars in one cell, so there is no single value to
// sort it by — clicking its header used to sort on a formatted string, or on a
// field that does not exist. These are the values the header offers instead.
//
// Nodes compare as a percentage of what the node has; pods and namespaces
// compare on absolute usage, because the percentage needs a limit or a quota
// and most of them have neither.
const COLUMN_SORT_METRICS: Record<string, ColumnSortMetric[]> = {
  nodeResources: [
    { key: "cpuUsagePercentValue", label: "CPU %" },
    { key: "memoryUsagePercentValue", label: "RAM %" },
    { key: "diskUsagePercent", label: "Disk %" },
  ],
  podResources: [
    { key: "podCpuUsageValue", label: "CPU" },
    { key: "podMemoryUsageValue", label: "RAM" },
  ],
  namespaceResources: [
    { key: "namespaceCpuUsedValue", label: "CPU" },
    { key: "namespaceMemoryUsedValue", label: "RAM" },
    { key: "namespaceStorageUsedValue", label: "Storage" },
  ],
};

export function columnSortMetrics(columnKey: string): ColumnSortMetric[] {
  return COLUMN_SORT_METRICS[columnKey] ?? [];
}

export function activeSortMetric(columnKey: string, sortKey: string): ColumnSortMetric | null {
  return columnSortMetrics(columnKey).find((metric) => metric.key === sortKey) ?? null;
}

// A sort can be active on a value that is not itself a column, so the header of
// the column that owns it stays marked and the sort survives a column reorder.
export function sortKeyBelongsToColumn(columnKey: string, sortKey: string): boolean {
  return columnKey === sortKey || activeSortMetric(columnKey, sortKey) !== null;
}

export function defaultSortKeyForColumn(columnKey: string): string {
  return columnSortMetrics(columnKey)[0]?.key ?? columnKey;
}
