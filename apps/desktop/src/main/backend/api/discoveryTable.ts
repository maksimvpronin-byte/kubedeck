// `kubectl api-resources --verbs=list -o wide`, built from the API server's
// aggregated discovery instead of a kubectl process.
//
// kubectl answers it from its on-disk discovery cache, which on Windows is
// hundreds of small files read by a process started for the purpose. Two
// requests on the cluster's kept connection give the same table: `/api` and
// `/apis` in the aggregated form (Kubernetes 1.26+). A server that answers in
// the legacy form gets the question back to kubectl.
//
// The table keeps kubectl's columns, because the code reading it splits on
// whitespace and finds NAMESPACED by its true/false.

export const AGGREGATED_DISCOVERY_ACCEPT = "application/json;g=apidiscovery.k8s.io;v=v2;as=APIGroupDiscoveryList,application/json;g=apidiscovery.k8s.io;v=v2beta1;as=APIGroupDiscoveryList";

export const API_RESOURCES_ARGS = ["api-resources", "--verbs=list", "-o", "wide"];

export function isApiResourcesCommand(args: readonly string[]): boolean {
  return args.length === API_RESOURCES_ARGS.length && args.every((arg, index) => arg === API_RESOURCES_ARGS[index]);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

interface Row {
  name: string;
  shortNames: string;
  apiVersion: string;
  namespaced: string;
  kind: string;
  verbs: string;
  categories: string;
}

// The rows of one aggregated discovery document, or null when it is not one.
function discoveryRows(document: Record<string, unknown>): Row[] | null {
  if (document.kind !== "APIGroupDiscoveryList" || !Array.isArray(document.items)) return null;
  const rows: Row[] = [];
  for (const item of document.items) {
    const group = record(item);
    const groupName = typeof record(group.metadata).name === "string" ? (record(group.metadata).name as string) : "";
    // The first version listed is the group's preferred one, which is the one
    // kubectl api-resources shows.
    const versions = Array.isArray(group.versions) ? group.versions : [];
    const preferred = record(versions[0]);
    const version = typeof preferred.version === "string" ? preferred.version : "";
    if (!version) continue;
    const apiVersion = groupName ? `${groupName}/${version}` : version;
    for (const entry of Array.isArray(preferred.resources) ? preferred.resources : []) {
      const resource = record(entry);
      const name = typeof resource.resource === "string" ? resource.resource : "";
      const verbs = strings(resource.verbs);
      if (!name || !verbs.includes("list")) continue;
      const kind = typeof record(resource.responseKind).kind === "string" ? (record(resource.responseKind).kind as string) : "";
      rows.push({
        name,
        shortNames: strings(resource.shortNames).join(","),
        apiVersion,
        namespaced: resource.scope === "Namespaced" ? "true" : "false",
        kind,
        verbs: verbs.join(","),
        categories: strings(resource.categories).join(","),
      });
    }
  }
  return rows;
}

// kubectl's table for the core and named-group documents, or null when
// either is not in the aggregated form.
export function apiResourcesTable(core: Record<string, unknown>, groups: Record<string, unknown>): string | null {
  const coreRows = discoveryRows(core);
  const groupRows = discoveryRows(groups);
  if (!coreRows || !groupRows) return null;
  const rows = [...coreRows, ...groupRows];
  const header: Row = { name: "NAME", shortNames: "SHORTNAMES", apiVersion: "APIVERSION", namespaced: "NAMESPACED", kind: "KIND", verbs: "VERBS", categories: "CATEGORIES" };
  const columns: Array<keyof Row> = ["name", "shortNames", "apiVersion", "namespaced", "kind", "verbs", "categories"];
  const widths = columns.map((column) => Math.max(header[column].length, ...rows.map((row) => row[column].length)));
  const line = (row: Row) =>
    columns
      .map((column, index) => (index === columns.length - 1 ? row[column] : row[column].padEnd(widths[index])))
      .join("   ")
      .trimEnd();
  return `${[header, ...rows].map(line).join("\n")}\n`;
}
