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
    labelsText: Object.entries(labels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(", "),
    ownerReferences: records(metadata.ownerReferences),
  };
}
