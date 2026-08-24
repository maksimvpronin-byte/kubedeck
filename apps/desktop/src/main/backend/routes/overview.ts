import type { IncomingMessage, ServerResponse } from "node:http";
import { ClusterNotFoundError, type ConfigStore } from "../config/configStore";
import { writeError } from "../errors";
import { writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError, writeKubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import { buildOverviewSnapshot } from "../overview/overviewEngine";
import { applyNodeDiskMetrics, applyNodeMetricsSnapshot, fetchNodeMetrics } from "../resources/metrics";
import { isRequestCancelled, requestAbortSignal } from "../requestCancellation";
import { normalizeResourceItems } from "../resources/normalizers";
import { RequestValidationError, validateIdentifier } from "../validation";

const SOURCES = ["pods", "deployments", "statefulsets", "daemonsets", "jobs", "events", "nodes", "persistentvolumeclaims", "resourcequotas"] as const;
const CLUSTER_SCOPED = new Set(["nodes"]);

function match(method: string | undefined, pathname: string) {
  if (method !== "GET") return null;
  const found = pathname.match(/^\/clusters\/([^/]+)\/overview$/);
  return found ? validateIdentifier(decodeURIComponent(found[1]), "cluster_id", 128) : null;
}

function namespacesFromUrl(url: string | undefined): string[] {
  const raw = new URL(url ?? "/", "http://127.0.0.1").searchParams.get("namespace") ?? "all";
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length || values.includes("all")) return ["all"];
  return [...new Set(values.map((value) => validateIdentifier(value, "namespace", 253)))];
}

async function loadSource(
  configStore: ConfigStore,
  runner: KubectlRunner,
  clusterId: string,
  resource: (typeof SOURCES)[number],
  namespaces: string[],
  signal?: AbortSignal,
): Promise<Array<Record<string, unknown>>> {
  if (!CLUSTER_SCOPED.has(resource) && namespaces.length > 1 && namespaces[0] !== "all") {
    const rows: Array<Array<Record<string, unknown>>> = await Promise.all(namespaces.map((namespace) => loadSource(configStore, runner, clusterId, resource, [namespace], signal)));
    return rows.flat();
  }
  const args = ["get", resource];
  if (!CLUSTER_SCOPED.has(resource)) {
    if (namespaces[0] === "all") args.push("-A");
    else args.push("-n", namespaces[0]);
  }
  args.push("-o", "json");
  // `kubectl top nodes` does not need the node list, so it runs alongside the
  // `kubectl get` instead of after it.
  const nodeMetrics = resource === "nodes" ? fetchNodeMetrics(configStore, runner, clusterId, signal) : null;
  nodeMetrics?.catch(() => undefined);
  const data = await runner.runJson(clusterCommand(configStore, clusterId, args, 45, 64 * 1024 * 1024), signal);
  const items = data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).items) ? (data as { items: unknown[] }).items : [];
  const rows = normalizeResourceItems(resource, items);
  if (nodeMetrics) {
    const [snapshot] = await Promise.all([nodeMetrics, applyNodeDiskMetrics(configStore, runner, clusterId, rows)]);
    applyNodeMetricsSnapshot(snapshot, rows);
  }
  return rows;
}

export async function buildOverviewResponse(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, namespaces: string[], signal?: AbortSignal) {
  const config = configStore.load();
  configStore.getCluster(clusterId, config);
  const results = await Promise.all(
    SOURCES.map(async (resource) => {
      try {
        return { resource, rows: await loadSource(configStore, runner, clusterId, resource, namespaces, signal), error: null };
      } catch (error) {
        if (!(error instanceof KubectlError)) throw error;
        return { resource, rows: [], error: { ...error.info, resource } };
      }
    }),
  );
  const sources: Record<string, Array<Record<string, unknown>>> = {};
  const errors: Array<Record<string, unknown>> = [];
  for (const result of results) {
    sources[result.resource] = result.rows;
    if (result.error) errors.push(result.error);
  }
  const threshold = Math.max(1, Number(config.settings.restartProblemThreshold ?? 3));
  return buildOverviewSnapshot(clusterId, namespaces, sources, errors, threshold);
}

export function handleOverviewRequest(request: IncomingMessage, response: ServerResponse, pathname: string, configStore: ConfigStore, runner: KubectlRunner, log: (message: string) => void): boolean {
  try {
    const clusterId = match(request.method, pathname);
    if (!clusterId) return false;
    const namespaces = namespacesFromUrl(request.url);
    // Nine cluster-wide lists per refresh - the heaviest recurring request the
    // app makes, and the one worth stopping the moment nobody is reading it.
    const signal = requestAbortSignal(request, response);
    void buildOverviewResponse(configStore, runner, clusterId, namespaces, signal)
      .then((body) => writeJson(response, body))
      .catch((error) => {
        if (isRequestCancelled(error, signal)) return;
        if (error instanceof ClusterNotFoundError) return writeError(response, 404, "CLUSTER_NOT_FOUND", error.message);
        if (error instanceof KubectlError) return writeKubectlError(response, error);
        log(`gateway overview failed: ${error instanceof Error ? error.message : String(error)}`);
        writeError(response, 500, "OVERVIEW_FAILED", "Unable to build cluster overview");
      });
    return true;
  } catch (error) {
    if (error instanceof RequestValidationError) writeError(response, error.statusCode, error.code, error.message);
    else writeError(response, 400, "INVALID_OVERVIEW_REQUEST", error instanceof Error ? error.message : String(error));
    return true;
  }
}
