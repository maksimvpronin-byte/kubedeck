import { parseDocument } from "yaml";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function named(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function nameOf(entry: Record<string, unknown> | undefined): string {
  return typeof entry?.name === "string" ? entry.name.trim() : "";
}

// The name a freshly imported kubeconfig is listed under: the cluster its
// current context points at, else the first cluster it defines. A file name -
// "config", "admin.conf", a download with a number on the end - says little
// about which cluster it is, and the kubeconfig usually says it plainly.
// Empty when the file names no cluster or does not parse; the caller falls back
// to the file name then.
export function kubeconfigClusterName(content: string): string {
  let parsed: unknown;
  try {
    parsed = parseDocument(content).toJS();
  } catch {
    return "";
  }
  if (!isRecord(parsed)) return "";

  const clusters = named(parsed.clusters);
  const currentContext = typeof parsed["current-context"] === "string" ? parsed["current-context"] : "";
  const context = named(parsed.contexts).find((entry) => entry.name === currentContext);
  const contextCluster = isRecord(context?.context) && typeof context.context.cluster === "string" ? context.context.cluster.trim() : "";
  if (contextCluster && clusters.some((entry) => nameOf(entry) === contextCluster)) return contextCluster;
  return clusters.map(nameOf).find(Boolean) ?? contextCluster;
}
