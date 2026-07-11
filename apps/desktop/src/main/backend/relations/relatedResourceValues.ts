export type UnknownRecord = Record<string, unknown>;

export type SafeLoad = (
  resource: string,
  namespace: string,
) => Promise<Array<UnknownRecord>>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function record(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

export function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

export function metadata(item: UnknownRecord): UnknownRecord {
  return record(item.metadata);
}

export function metadataName(item: UnknownRecord): string {
  return text(metadata(item).name);
}

export function metadataNamespace(
  item: UnknownRecord,
  fallback = "_cluster",
): string {
  return text(metadata(item).namespace) || fallback;
}
