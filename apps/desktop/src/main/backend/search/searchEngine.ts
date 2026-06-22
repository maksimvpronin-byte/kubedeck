import { normalizeResourceItems } from "../resources/normalizers";

export interface ApiResourceDefinition {
  name: string;
  shortNames: string;
  apiGroup: string;
  namespaced: boolean;
  kind: string;
  verbs: string;
}

export interface SearchResourceSpec {
  resource: string;
  kind: string;
  scope: "namespaced" | "cluster";
  normalizer: "resource" | "generic";
  definitionOnly?: boolean;
  definitionFilter?: ApiResourceDefinition;
  crdInstance?: boolean;
  apiGroup?: string;
}

export interface SearchResultRow extends Record<string, unknown> {
  uid: string;
  name: string;
  namespace: string;
  resource: string;
  kind: string;
  score: number;
  matchedFields: string[];
  source: "global-search";
  title: string;
  subtitle: string;
  crdInstance: boolean;
}

const BUILT_IN_API_GROUPS = new Set([
  "",
  "apps",
  "batch",
  "extensions",
  "networking.k8s.io",
  "rbac.authorization.k8s.io",
  "storage.k8s.io",
  "autoscaling",
  "policy",
  "coordination.k8s.io",
  "apiextensions.k8s.io",
  "admissionregistration.k8s.io",
  "node.k8s.io",
  "scheduling.k8s.io",
  "authentication.k8s.io",
  "authorization.k8s.io",
  "certificates.k8s.io",
  "discovery.k8s.io",
  "flowcontrol.apiserver.k8s.io",
]);

const BASE_RESOURCE_SPECS: readonly SearchResourceSpec[] = [
  { resource: "pods", kind: "Pod", scope: "namespaced", normalizer: "resource" },
  { resource: "deployments", kind: "Deployment", scope: "namespaced", normalizer: "resource" },
  { resource: "services", kind: "Service", scope: "namespaced", normalizer: "resource" },
  { resource: "configmaps", kind: "ConfigMap", scope: "namespaced", normalizer: "generic" },
  { resource: "secrets", kind: "Secret", scope: "namespaced", normalizer: "generic" },
  { resource: "ingresses", kind: "Ingress", scope: "namespaced", normalizer: "resource" },
  { resource: "persistentvolumeclaims", kind: "PersistentVolumeClaim", scope: "namespaced", normalizer: "generic" },
  { resource: "events", kind: "Event", scope: "namespaced", normalizer: "resource" },
  { resource: "namespaces", kind: "Namespace", scope: "cluster", normalizer: "generic" },
  { resource: "nodes", kind: "Node", scope: "cluster", normalizer: "resource" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function jsonText(value: unknown, maxChars = Number.POSITIVE_INFINITY): string {
  try {
    const output = JSON.stringify(value ?? {}, null, 0);
    return typeof output === "string" ? output.slice(0, maxChars) : "";
  } catch {
    return "";
  }
}

export function genericSearchSummary(raw: Record<string, unknown>): Record<string, unknown> {
  const metadata = record(raw.metadata);
  const status = record(raw.status);
  const spec = record(raw.spec);
  const conditions = Array.isArray(status.conditions)
    ? status.conditions.filter(isRecord)
    : [];
  const lastCondition = conditions.at(-1) ?? {};
  return {
    uid: text(metadata.uid),
    name: text(metadata.name),
    namespace: text(metadata.namespace),
    createdAt: text(metadata.creationTimestamp),
    labels: record(metadata.labels),
    ownerReferences: Array.isArray(metadata.ownerReferences)
      ? metadata.ownerReferences.filter(isRecord)
      : [],
    apiVersion: text(raw.apiVersion),
    kind: text(raw.kind),
    status: text(status.phase) || text(lastCondition.type),
    type: text(spec.type),
  };
}

export function parseApiResources(output: string): ApiResourceDefinition[] {
  const lines = output.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length <= 1) return [];
  const items: ApiResourceDefinition[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const namespacedIndex = parts.findIndex((part) => part === "true" || part === "false");
    if (namespacedIndex < 0 || namespacedIndex + 2 >= parts.length) continue;
    const apiVersion = namespacedIndex > 0 ? parts[namespacedIndex - 1] ?? "" : "";
    items.push({
      name: parts[0] ?? "",
      shortNames: namespacedIndex >= 3 ? parts[1] ?? "" : "",
      apiGroup: apiVersion.includes("/") ? apiVersion.split("/", 1)[0] ?? "" : "",
      namespaced: parts[namespacedIndex] === "true",
      kind: parts[namespacedIndex + 1] ?? "",
      verbs: parts.slice(namespacedIndex + 2).join(" "),
    });
  }
  return items;
}

export function searchMatchesText(query: string, value: string): boolean {
  const haystack = value.toLocaleLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token.toLocaleLowerCase()));
}

export function definitionMatchesQuery(
  definition: ApiResourceDefinition,
  query: string,
): boolean {
  return searchMatchesText(
    query,
    [definition.name, definition.shortNames, definition.apiGroup, definition.kind].join(" "),
  );
}

export function isProbableCustomResource(definition: ApiResourceDefinition): boolean {
  if (!definition.name || definition.name.includes("/")) return false;
  if (!definition.verbs.toLocaleLowerCase().includes("list")) return false;
  return !BUILT_IN_API_GROUPS.has(definition.apiGroup);
}

export function fullyQualifiedApiResource(definition: ApiResourceDefinition): string {
  const name = definition.name.trim();
  const apiGroup = definition.apiGroup.trim();
  return apiGroup && !name.endsWith(`.${apiGroup}`) ? `${name}.${apiGroup}` : name;
}

export function buildSearchResourceSpecs(
  query: string,
  includeCrdInstances: boolean,
  definitions: readonly ApiResourceDefinition[],
  maxCrdInstanceResources = 12,
): SearchResourceSpec[] {
  const specs = BASE_RESOURCE_SPECS.map((item) => ({ ...item }));
  for (const definition of definitions) {
    if (!isProbableCustomResource(definition)) continue;
    if (!definitionMatchesQuery(definition, query)) continue;
    specs.push({
      resource: "customresourcedefinitions",
      kind: "CustomResourceDefinition",
      scope: "cluster",
      normalizer: "resource",
      definitionOnly: true,
      definitionFilter: definition,
    });
  }
  if (includeCrdInstances) {
    const customDefinitions = definitions
      .filter((definition) => isProbableCustomResource(definition))
      .filter((definition) => definitionMatchesQuery(definition, query))
      .slice(0, Math.max(0, maxCrdInstanceResources));
    for (const definition of customDefinitions) {
      specs.push({
        resource: fullyQualifiedApiResource(definition),
        kind: definition.kind || "CustomResource",
        scope: definition.namespaced ? "namespaced" : "cluster",
        normalizer: "generic",
        crdInstance: true,
        apiGroup: definition.apiGroup,
      });
    }
  }
  return specs;
}

export function crdItemMatchesDefinition(
  raw: Record<string, unknown>,
  definition?: ApiResourceDefinition,
): boolean {
  if (!definition) return true;
  const metadata = record(raw.metadata);
  const spec = record(raw.spec);
  const names = record(spec.names);
  const candidates = new Set([text(metadata.name), text(names.plural)]);
  return candidates.has(definition.name) || text(names.kind) === definition.kind;
}

function resourceSummary(
  spec: SearchResourceSpec,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (spec.normalizer === "generic") return genericSearchSummary(raw);
  const rows = normalizeResourceItems(spec.resource, [raw]);
  return rows[0] ?? genericSearchSummary(raw);
}

export function scoreSearchResult(
  query: string,
  resource: string,
  raw: Record<string, unknown>,
  summary: Record<string, unknown>,
): { score: number; matchedFields: string[] } {
  const tokens = query
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLocaleLowerCase());
  const metadata = record(raw.metadata);
  const name = text(summary.name) || text(metadata.name);
  const namespace = text(summary.namespace) || text(metadata.namespace);
  const kind = text(summary.kind) || text(raw.kind);
  const labels = record(metadata.labels);
  const annotations = record(metadata.annotations);
  const status = record(raw.status);
  const spec = record(raw.spec);
  const safeSpec: Record<string, unknown> = {};
  for (const key of ["type", "serviceName", "storageClassName", "ingressClassName"]) {
    if (key in spec) safeSpec[key] = spec[key];
  }
  const fields: Record<string, string> = {
    name,
    namespace,
    kind,
    resource,
    labels: jsonText(labels),
    annotations: jsonText(annotations),
    status: jsonText(status, 4000),
    spec: jsonText(safeSpec),
  };
  const haystack = Object.values(fields).join(" ").toLocaleLowerCase();
  if (!tokens.every((token) => haystack.includes(token))) {
    return { score: 0, matchedFields: [] };
  }
  let score = 10;
  const matchedFields: string[] = [];
  const normalizedQuery = query.toLocaleLowerCase();
  if (name.toLocaleLowerCase() === normalizedQuery) {
    score += 1000;
    matchedFields.push("name");
  } else if (name.toLocaleLowerCase().includes(normalizedQuery)) {
    score += 500;
    matchedFields.push("name");
  }
  if (namespace && namespace.toLocaleLowerCase().includes(normalizedQuery)) {
    score += 160;
    matchedFields.push("namespace");
  }
  if (kind && kind.toLocaleLowerCase().includes(normalizedQuery)) {
    score += 120;
    matchedFields.push("kind");
  }
  if (resource && resource.toLocaleLowerCase().includes(normalizedQuery)) {
    score += 100;
    matchedFields.push("resource");
  }
  for (const [field, value] of Object.entries(fields)) {
    if (matchedFields.includes(field)) continue;
    if (tokens.some((token) => value.toLocaleLowerCase().includes(token))) {
      matchedFields.push(field);
    }
  }
  return { score, matchedFields: matchedFields.slice(0, 5) };
}

function resultSubtitle(
  resource: string,
  namespace: string,
  row: Record<string, unknown>,
  spec: SearchResourceSpec,
): string {
  const kind = text(row.kind) || spec.kind || resource;
  const parts = [kind, resource];
  if (namespace && namespace !== "_cluster") parts.push(namespace);
  const status = text(row.status) || text(row.phase);
  if (status) parts.push(status);
  return parts.join(" · ");
}

export function searchResultRow(
  spec: SearchResourceSpec,
  summary: Record<string, unknown>,
  score: number,
  matchedFields: string[],
): SearchResultRow {
  const row = { ...summary };
  const namespace = text(row.namespace) || (spec.scope === "cluster" ? "_cluster" : "");
  const name = text(row.name);
  const resource = spec.resource;
  const kind = text(row.kind) || spec.kind;
  const uid = text(row.uid) || `search:${resource}:${namespace}:${name}`;
  return {
    ...row,
    uid,
    name,
    resource,
    kind,
    namespace,
    score,
    matchedFields,
    source: "global-search",
    title: name,
    subtitle: resultSubtitle(resource, namespace, row, spec),
    crdInstance: Boolean(spec.crdInstance),
  };
}

export function rankRawItems(
  spec: SearchResourceSpec,
  rawItems: readonly unknown[],
  query: string,
  limit: number,
): SearchResultRow[] {
  const collected: SearchResultRow[] = [];
  for (const value of rawItems) {
    if (!isRecord(value)) continue;
    if (spec.definitionOnly && !crdItemMatchesDefinition(value, spec.definitionFilter)) {
      continue;
    }
    const summary = resourceSummary(spec, value);
    const { score, matchedFields } = scoreSearchResult(query, spec.resource, value, summary);
    if (score <= 0) continue;
    collected.push(searchResultRow(spec, summary, score, matchedFields));
    if (collected.length >= limit) break;
  }
  return collected.sort(compareSearchResults).slice(0, limit);
}

export function compareSearchResults(left: SearchResultRow, right: SearchResultRow): number {
  return right.score - left.score
    || left.resource.localeCompare(right.resource)
    || left.name.localeCompare(right.name);
}

export function deduplicateSearchResults(items: readonly SearchResultRow[]): SearchResultRow[] {
  const byKey = new Map<string, SearchResultRow>();
  for (const item of items) {
    const key = `${item.resource}\u0000${item.namespace}\u0000${item.name || item.uid}`;
    const current = byKey.get(key);
    if (!current || item.score > current.score) byKey.set(key, item);
  }
  return [...byKey.values()];
}
