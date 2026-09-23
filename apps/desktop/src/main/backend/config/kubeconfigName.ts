import fs from "node:fs";
import { parseDocument } from "yaml";

// Larger than any kubeconfig in use; a file this big is not parsed to name a
// cluster, and is not offered for editing.
export const MAX_KUBECONFIG_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function named(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function nameOf(entry: Record<string, unknown> | undefined): string {
  return typeof entry?.name === "string" ? entry.name.trim() : "";
}

export interface KubeconfigCluster {
  name: string;
  server: string;
}

// The cluster a kubeconfig is about: the one its current context points at,
// else the first one it defines. Null when the file names no cluster or does
// not parse.
export function kubeconfigCluster(content: string): KubeconfigCluster | null {
  let parsed: unknown;
  try {
    parsed = parseDocument(content).toJS();
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const clusters = named(parsed.clusters).filter((entry) => nameOf(entry));
  const currentContext = typeof parsed["current-context"] === "string" ? parsed["current-context"] : "";
  const context = named(parsed.contexts).find((entry) => entry.name === currentContext);
  const contextCluster = isRecord(context?.context) && typeof context.context.cluster === "string" ? context.context.cluster.trim() : "";
  const entry = clusters.find((item) => nameOf(item) === contextCluster) ?? clusters[0];
  if (!entry) return contextCluster ? { name: contextCluster, server: "" } : null;
  const server = isRecord(entry.cluster) && typeof entry.cluster.server === "string" ? entry.cluster.server.trim() : "";
  return { name: nameOf(entry), server };
}

// Names kubeadm and the local distributions give every cluster they make. Ten
// clusters imported under "kubernetes" cannot be told apart, so for these the
// API server's host names the cluster instead.
const GENERIC_CLUSTER_NAMES = new Set(["kubernetes", "default", "local", "cluster", "k3s-default"]);

export function serverHost(server: string): string {
  try {
    return new URL(server).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return "";
  }
}

// The name a freshly imported kubeconfig is listed under. A file name -
// "config", "admin.conf", a download with a number on the end - says little
// about which cluster it is, and the kubeconfig usually says it plainly.
// Empty when the file offers nothing better; the caller falls back to the file
// name then.
export function kubeconfigClusterName(content: string): string {
  const cluster = kubeconfigCluster(content);
  if (!cluster) return "";
  if (!GENERIC_CLUSTER_NAMES.has(cluster.name.toLowerCase())) return cluster.name;
  return serverHost(cluster.server);
}

// The API server a stored kubeconfig points at, for telling clusters apart in
// the interface. Read per config request, so it is cached on the file's size
// and modification time; a kubeconfig edited in KubeDeck or outside it is
// read again.
const serverCache = new Map<string, { stamp: string; server: string }>();

export function kubeconfigFileServer(kubeconfigPath: string): string {
  try {
    const stat = fs.statSync(kubeconfigPath);
    if (stat.size > MAX_KUBECONFIG_BYTES) return "";
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    const cached = serverCache.get(kubeconfigPath);
    if (cached?.stamp === stamp) return cached.server;
    const server = kubeconfigCluster(fs.readFileSync(kubeconfigPath, "utf8"))?.server ?? "";
    serverCache.set(kubeconfigPath, { stamp, server });
    return server;
  } catch {
    return "";
  }
}
