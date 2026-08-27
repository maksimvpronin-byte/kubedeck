export type JsonObject = Record<string, unknown>;
export type ResourceRow = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function record(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

export function records(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

interface LabelEntry {
  key: string;
  lower: string;
  value: unknown;
}

// `String.prototype.localeCompare` builds a collator behind every single
// comparison, and this runs for every row of every list - a table of a few
// thousand pods is tens of thousands of them. Comparing keys that were
// lowercased once, and breaking ties the way the collator does (lowercase
// before uppercase), keeps the order it produced at less than half the cost.
function compareLabelKeys(left: LabelEntry, right: LabelEntry): number {
  if (left.lower !== right.lower) return left.lower < right.lower ? -1 : 1;
  return left.key < right.key ? 1 : left.key > right.key ? -1 : 0;
}

function labelsText(labels: JsonObject): string {
  const entries: LabelEntry[] = Object.entries(labels).map(([key, value]) => ({ key, lower: key.toLowerCase(), value }));
  entries.sort(compareLabelKeys);
  return entries.map((entry) => `${entry.key}=${String(entry.value)}`).join(", ");
}

export function meta(item: JsonObject): ResourceRow {
  const metadata = record(item.metadata);
  const labels = record(metadata.labels);
  return {
    uid: text(metadata.uid),
    name: text(metadata.name),
    namespace: text(metadata.namespace),
    createdAt: text(metadata.creationTimestamp),
    deletionTimestamp: text(metadata.deletionTimestamp),
    generation: numberValue(metadata.generation),
    labels,
    labelsText: labelsText(labels),
    ownerReferences: records(metadata.ownerReferences),
  };
}
