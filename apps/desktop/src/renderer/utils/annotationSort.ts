import type { ResourceRow } from "../types";
import type { ColumnSortMetric } from "./resourceTableSortMetrics";

// Sorting a table by "annotations" would sort by whichever key comes first in
// the alphabet - `alpha.kubernetes.io/provided-node-ip` on every node - which
// orders nothing. What sorts is one chosen annotation, so the sort key names
// it, and the header offers the keys the loaded rows actually carry.
export const ANNOTATION_SORT_PREFIX = "annotation:";
export const ANNOTATION_COLUMN_KEY = "nodeAnnotations";

const MAX_SORT_KEYS = 40;

export interface AnnotationItem {
  key: string;
  value: string;
}

export function annotationItems(row: ResourceRow): AnnotationItem[] {
  const items = (row.nodeAnnotationItems ?? []) as Array<{ key?: unknown; value?: unknown }>;
  return items.filter(Boolean).map((item) => ({ key: String(item.key ?? ""), value: String(item.value ?? "") }));
}

export function annotationValue(row: ResourceRow, key: string): string {
  return annotationItems(row).find((item) => item.key === key)?.value ?? "";
}

export function annotationSortKey(key: string): string {
  return `${ANNOTATION_SORT_PREFIX}${key}`;
}

export function isAnnotationSortKey(sortKey: string): boolean {
  return sortKey.startsWith(ANNOTATION_SORT_PREFIX);
}

export function annotationKeyFromSortKey(sortKey: string): string {
  return isAnnotationSortKey(sortKey) ? sortKey.slice(ANNOTATION_SORT_PREFIX.length) : "";
}

// The keys carried by the most nodes first: an annotation on one node out of
// forty sorts nothing, and the menu is a list somebody has to read.
export function annotationSortMetrics(rows: ResourceRow[]): ColumnSortMetric[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const item of annotationItems(row)) {
      if (item.key) counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([leftKey, leftCount], [rightKey, rightCount]) => rightCount - leftCount || leftKey.localeCompare(rightKey))
    .slice(0, MAX_SORT_KEYS)
    .map(([key]) => ({ key: annotationSortKey(key), label: key }));
}
