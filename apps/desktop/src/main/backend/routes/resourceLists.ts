import type { IncomingMessage, ServerResponse } from "node:http";

import type { ResourceSnapshotCache } from "../cache/resourceSnapshotCache";
import { type ConfigStore } from "../config/configStore";
import { writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import { normalizeResourceItems } from "../resources/normalizers";
import {
  applyNamespaceMetricsSnapshot,
  applyNodeMetricsSnapshot,
  applyPodMetricsSnapshot,
  fetchNamespaceMetrics,
  fetchNodeMetrics,
  fetchPodMetrics,
  warmNodeDiskMetrics,
  type NamespaceMetricsSnapshot,
  type NodeMetricsSnapshot,
  type PodMetricsSnapshot,
} from "../resources/metrics";
import type { UsageHistorySampler } from "../resources/usageHistorySampler";
import { samplesFromPodMetrics } from "../resources/usageHistorySampler";
import { decodePathPart, parseBooleanQuery, validateIdentifier } from "../validation";
import { writeRouteError } from "./routeErrors";

const RESOURCE_TIMEOUT_SECONDS = 45;
const RESOURCE_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const READINESS_TIMEOUT_SECONDS = 5;
const READINESS_MAX_OUTPUT_BYTES = 1024 * 1024;

interface ResourceListTarget {
  clusterId: string;
  resource: string;
  namespace: string;
  useCache: boolean;
  forceRefresh: boolean;
}

function asItems(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as Record<string, unknown>).items;
  return Array.isArray(items) ? items : [];
}

function clusterScopedWithoutNamespaceArgument(resource: string): boolean {
  return new Set([
    "namespaces",
    "namespace",
    "ns",
    "nodes",
    "node",
    "customresourcedefinitions",
    "customresourcedefinition",
    "crd",
    "crds",
    "customresourcedefinitions.apiextensions.k8s.io",
    "customresourcedefinition.apiextensions.k8s.io",
    "clusterroles",
    "clusterrole",
    "clusterrolebindings",
    "clusterrolebinding",
    "persistentvolumes",
    "persistentvolume",
    "storageclasses",
    "storageclass",
  ]).has(resource);
}

export function matchResourceListRoute(method: string | undefined, pathname: string, requestUrl: string | undefined): ResourceListTarget | null {
  if (method !== "GET") return null;

  const match = pathname.match(/^\/clusters\/([^/]+)\/resources\/([^/]+)$/);
  if (!match) return null;

  const url = new URL(requestUrl ?? pathname, "http://127.0.0.1");
  const rawNamespace = url.searchParams.get("namespace")?.trim() || "all";
  const namespace = rawNamespace === "all" || rawNamespace === "_cluster" ? rawNamespace : validateIdentifier(rawNamespace, "namespace");

  return {
    clusterId: validateIdentifier(decodePathPart(match[1], "cluster_id"), "cluster_id", 128),
    resource: validateIdentifier(decodePathPart(match[2], "resource"), "resource", 128).toLowerCase(),
    namespace,
    useCache: parseBooleanQuery(url.searchParams.get("useCache"), "useCache", false),
    forceRefresh: parseBooleanQuery(url.searchParams.get("forceRefresh"), "forceRefresh", false),
  };
}

function resourceArgs(target: ResourceListTarget): string[] {
  const args = ["get", target.resource];

  if (!clusterScopedWithoutNamespaceArgument(target.resource)) {
    if (target.namespace === "all") args.push("-A");
    else if (target.namespace !== "_cluster") {
      args.push("-n", target.namespace);
    }
  }

  args.push("-o", "json");
  return args;
}

async function verifyClusterReadiness(configStore: ConfigStore, runner: KubectlRunner, clusterId: string): Promise<void> {
  await runner.run(clusterCommand(configStore, clusterId, ["get", "--raw=/readyz"], READINESS_TIMEOUT_SECONDS, READINESS_MAX_OUTPUT_BYTES));
}

type PendingListMetrics =
  | { kind: "pods"; snapshot: Promise<PodMetricsSnapshot | null> }
  | { kind: "nodes"; snapshot: Promise<NodeMetricsSnapshot> }
  | { kind: "namespaces"; snapshot: Promise<NamespaceMetricsSnapshot> }
  | null;

function startListMetrics(target: ResourceListTarget, configStore: ConfigStore, runner: KubectlRunner): PendingListMetrics {
  const pending = startListMetricsCommand(target, configStore, runner);
  // The list request can reject before the snapshot is awaited. Observing the
  // rejection here keeps a failing metrics command from surfacing as an
  // unhandled rejection; `applyListMetrics` still rethrows it when reached.
  pending?.snapshot.catch(() => undefined);
  return pending;
}

function startListMetricsCommand(target: ResourceListTarget, configStore: ConfigStore, runner: KubectlRunner): PendingListMetrics {
  if (target.resource === "pods" || target.resource === "pod") {
    return { kind: "pods", snapshot: fetchPodMetrics(configStore, runner, target.clusterId, target.namespace) };
  }

  if (target.resource === "nodes" || target.resource === "node") {
    return { kind: "nodes", snapshot: fetchNodeMetrics(configStore, runner, target.clusterId) };
  }

  if (target.resource === "namespaces" || target.resource === "namespace" || target.resource === "ns") {
    return { kind: "namespaces", snapshot: fetchNamespaceMetrics(configStore, runner, target.clusterId) };
  }

  return null;
}

async function applyListMetrics(
  pending: PendingListMetrics,
  rows: ReturnType<typeof normalizeResourceItems>,
  configStore: ConfigStore,
  runner: KubectlRunner,
  target: ResourceListTarget,
  usageHistory: UsageHistorySampler,
): Promise<void> {
  const clusterId = target.clusterId;
  if (!pending) return;
  if (pending.kind === "pods") {
    const snapshot = await pending.snapshot;
    if (snapshot) {
      // These metrics were fetched for the table anyway, so recording them
      // costs nothing and fills the history for whatever the user is looking
      // at. Recording happens before the backfill so a value this call did not
      // return is never fed back in as if it had been sampled now.
      usageHistory.ingest(clusterId, samplesFromPodMetrics(snapshot.metrics, snapshot.allNamespaces, target.namespace));
      // A pod that metrics-server only started reporting after this list call
      // was issued would otherwise show N/A in the table while the drawer
      // shows a recorded reading for the very same pod.
      usageHistory.backfillPodMetrics(clusterId, snapshot.metrics, rows, snapshot.allNamespaces, target.namespace);
    }
    // Applied last so the backfilled entries go through the same percentage
    // and sorting math as the ones kubectl returned.
    applyPodMetricsSnapshot(snapshot, rows);
    // A pod list is the only place the workload behind a pod name is visible,
    // so it is also where the background sampler's rows get attributed.
    usageHistory.attributePods(clusterId, rows);
  } else if (pending.kind === "namespaces") applyNamespaceMetricsSnapshot(await pending.snapshot, rows);
  else {
    applyNodeMetricsSnapshot(await pending.snapshot, rows);
    // Disk usage is one kubelet round trip per node and is fetched separately
    // by the table, so it is started here rather than awaited: the response
    // stays as fast as it is now and the bars have a head start.
    warmNodeDiskMetrics(configStore, runner, clusterId, rows);
  }
}

async function loadResources(
  response: ServerResponse,
  target: ResourceListTarget,
  configStore: ConfigStore,
  runner: KubectlRunner,
  cache: ResourceSnapshotCache,
  usageHistory: UsageHistorySampler,
): Promise<void> {
  // Browsing a cluster is what starts its usage history: sampling every
  // configured cluster regardless of use would spend kubectl processes on
  // endpoints the user never opened.
  usageHistory.ensureCluster(target.clusterId);

  if (target.useCache && !target.forceRefresh) {
    const cached = cache.get(target.clusterId, target.resource, target.namespace);

    if (cached) {
      try {
        await verifyClusterReadiness(configStore, runner, target.clusterId);
      } catch (error) {
        cache.clear(target.clusterId, "cluster.unavailable");
        throw error;
      }

      writeJson(response, cached);
      return;
    }
  }

  // `kubectl top` and the resource quota lookup do not depend on the list, so
  // they run alongside `kubectl get` instead of after it. The usage bars used to
  // wait for two kubectl round trips in sequence, which is what made the node and
  // pod usage columns appear long after the table itself.
  const metrics = startListMetrics(target, configStore, runner);

  try {
    const data = await runner.runJson(clusterCommand(configStore, target.clusterId, resourceArgs(target), RESOURCE_TIMEOUT_SECONDS, RESOURCE_MAX_OUTPUT_BYTES));

    const rawItems = asItems(data);
    const rows = normalizeResourceItems(target.resource, rawItems);

    await applyListMetrics(metrics, rows, configStore, runner, target, usageHistory);

    const result = cache.set(target.clusterId, target.resource, target.namespace, {
      items: rows,
      rawCount: rawItems.length,
      kind: "ResourceList",
    });

    writeJson(response, result);
  } catch (error) {
    if (error instanceof KubectlError) {
      cache.clear(target.clusterId, "kubectl.failure");
    }
    throw error;
  }
}

function handleCacheStatus(request: IncomingMessage, response: ServerResponse, pathname: string, cache: ResourceSnapshotCache, clearDiscoveryCache: (clusterId?: string) => void): boolean {
  if (request.method === "GET" && pathname === "/resource-cache/status") {
    writeJson(response, cache.status());
    return true;
  }

  if (request.method === "POST" && pathname === "/resource-cache/clear") {
    const url = new URL(request.url ?? pathname, "http://127.0.0.1");
    const rawClusterId = url.searchParams.get("cluster_id")?.trim();
    const clusterId = rawClusterId ? validateIdentifier(rawClusterId, "cluster_id", 128) : undefined;
    const cleared = cache.clear(clusterId, clusterId ? "manual.clear_cluster" : "manual.clear_all");
    clearDiscoveryCache(clusterId);
    writeJson(response, { cleared });
    return true;
  }

  return false;
}

export function handleResourceListRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  runner: KubectlRunner,
  cache: ResourceSnapshotCache,
  clearDiscoveryCache: (clusterId?: string) => void,
  usageHistory: UsageHistorySampler,
  log: (message: string) => void,
): boolean {
  try {
    if (handleCacheStatus(request, response, pathname, cache, clearDiscoveryCache)) {
      return true;
    }

    const target = matchResourceListRoute(request.method, pathname, request.url);
    if (!target) return false;

    void loadResources(response, target, configStore, runner, cache, usageHistory).catch((error) =>
      writeRouteError(response, error, log, { label: "resource list", fallbackCode: "RESOURCE_LIST_FAILED", fallbackMessage: "Unable to load Kubernetes resources" }),
    );

    return true;
  } catch (error) {
    writeRouteError(response, error, log, { label: "resource list", fallbackCode: "RESOURCE_LIST_FAILED", fallbackMessage: "Unable to load Kubernetes resources" });
    return true;
  }
}
