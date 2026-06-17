import type { ApiClient } from "../api";
import type { ResourceDefinition, ResourceRow } from "../types";

export const MAX_NAMESPACE_PARALLEL_REQUESTS = 2;

export function normalizeNamespaceSelection(value: string | string[]) {
  const raw = Array.isArray(value) ? value : value.split(",");
  const normalized = Array.from(new Set(raw.map((item) => item.trim()).filter(Boolean)));
  if (normalized.includes("_cluster")) return ["_cluster"];
  if (normalized.includes("all") || normalized.length === 0) return ["all"];
  return normalized;
}

export function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function findResourceDefinition(definitions: ResourceDefinition[], resource: string) {
  return definitions.find((item) => item.name === resource || fullyQualifiedResource(item) === resource);
}

export function sameResourceIdentity(target: ResourceRow, candidate: ResourceRow) {
  if (target.uid && candidate.uid && target.uid === candidate.uid) return true;
  const targetName = String(target.name || "");
  const candidateName = String(candidate.name || "");
  const targetNamespace = String(target.namespace || "_cluster");
  const candidateNamespace = String(candidate.namespace || "_cluster");
  return Boolean(targetName) && targetName === candidateName && targetNamespace === candidateNamespace;
}

export function fullyQualifiedResource(definition: ResourceDefinition) {
  return definition.apiGroup ? `${definition.name}.${definition.apiGroup}` : definition.name;
}

export function groupCrds(rows: ResourceRow[]) {
  const groups = new Map<string, Array<{ group: string; kind: string; plural: string; resource: string }>>();
  for (const row of rows) {
    const group = String(row.group || "unknown");
    const plural = String(row.plural || "");
    const kind = String(row.kind || "");
    const resource = String(row.resourceName || (plural && group !== "unknown" ? `${plural}.${group}` : plural));
    if (!resource) continue;
    const items = groups.get(group) ?? [];
    items.push({ group, kind, plural, resource });
    groups.set(group, items);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, items]) => ({
      group,
      items: items.sort((left, right) => (left.kind || left.plural).localeCompare(right.kind || right.plural)),
    }));
}

export function canDeleteResource(definition: ResourceDefinition | undefined) {
  if (!definition) return true;
  return String(definition.verbs ?? "").split(/\s*,\s*|\s+/).includes("delete");
}

export async function loadNamespaceResourceBatches(
  api: ApiClient,
  clusterId: string,
  resource: string,
  namespaces: string[],
  signal?: AbortSignal,
  options: { useCache?: boolean; forceRefresh?: boolean } = {},
) {
  const normalized = normalizeNamespaceSelection(namespaces);
  // KubeDeck 1.0.5 unavailable-cache hotfix:
  // main resource tables must be live. Silent auto-refresh must still hit
  // kubectl, otherwise a disconnected cluster keeps showing stale rows.
  const liveOptions = { ...options, useCache: false, forceRefresh: true };
  if (normalized.length <= 1) {
    return [await api.resources(clusterId, resource, normalized[0] ?? "all", signal, liveOptions)];
  }

  const responses: Array<{ items: ResourceRow[]; rawCount: number; cached?: boolean; cacheTtlSeconds?: number }> = [];
  for (let index = 0; index < normalized.length; index += MAX_NAMESPACE_PARALLEL_REQUESTS) {
    const batch = normalized.slice(index, index + MAX_NAMESPACE_PARALLEL_REQUESTS);
    responses.push(...await Promise.all(batch.map((item) => api.resources(clusterId, resource, item, signal, liveOptions))));
  }
  return responses;
}
