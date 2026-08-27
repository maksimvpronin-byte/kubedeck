import type { IncomingMessage, ServerResponse } from "node:http";
import { loadAggregateSource } from "../cache/aggregateSourceCache";
import { type ConfigStore } from "../config/configStore";
import { writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import { buildProblemRows, summarizeProblems, type ProblemSourceRows } from "../problems/problemEngine";
import { isRequestCancelled, requestAbortSignal } from "../requestCancellation";
import { normalizeResourceItems } from "../resources/normalizers";
import { decodePathPart, validateIdentifier } from "../validation";
import { writeRouteError } from "./routeErrors";

const RESOURCE_TIMEOUT_SECONDS = 45;
const RESOURCE_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

interface ProblemsTarget {
  clusterId: string;
}

interface ProblemSourceDefinition {
  resource: "pods" | "deployments" | "events" | "nodes" | "persistentvolumeclaims";
  namespace: "all" | "_cluster";
}

const PROBLEM_SOURCES: readonly ProblemSourceDefinition[] = [
  { resource: "pods", namespace: "all" },
  { resource: "deployments", namespace: "all" },
  { resource: "events", namespace: "all" },
  { resource: "nodes", namespace: "_cluster" },
  { resource: "persistentvolumeclaims", namespace: "all" },
];

function asItems(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as Record<string, unknown>).items;
  return Array.isArray(items) ? items : [];
}

export function matchProblemsRoute(method: string | undefined, pathname: string): ProblemsTarget | null {
  if (method !== "GET") return null;
  const match = pathname.match(/^\/clusters\/([^/]+)\/problems$/);
  if (!match) return null;
  return {
    clusterId: validateIdentifier(decodePathPart(match[1], "cluster_id"), "cluster_id", 128),
  };
}

function resourceArgs(source: ProblemSourceDefinition): string[] {
  const args = ["get", source.resource];
  if (source.namespace === "all") args.push("-A");
  // Only Warning events ever become a problem row, and in a normal cluster they
  // are a small fraction of the stream. Filtering on the API server instead of
  // here is the difference between reading every event in the cluster every ten
  // seconds and reading the handful that matter.
  if (source.resource === "events") args.push("--field-selector", "type=Warning");
  args.push("-o", "json");
  return args;
}

async function loadProblemSource(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, source: ProblemSourceDefinition, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
  const items = await loadAggregateSource(clusterId, sourceCacheKind(source), source.namespace, async () => {
    const data = await runner.runJson(clusterCommand(configStore, clusterId, resourceArgs(source), RESOURCE_TIMEOUT_SECONDS, RESOURCE_MAX_OUTPUT_BYTES), signal);
    return asItems(data);
  });
  return normalizeResourceItems(source.resource, items);
}

// The event list is filtered to warnings, so it must not share a cache entry
// with an unfiltered list of the same kind.
function sourceCacheKind(source: ProblemSourceDefinition): string {
  return source.resource === "events" ? "events:warning" : source.resource;
}

export async function buildProblemsResponse(
  configStore: ConfigStore,
  runner: KubectlRunner,
  clusterId: string,
  signal?: AbortSignal,
): Promise<{
  items: ReturnType<typeof buildProblemRows>;
  summary: ReturnType<typeof summarizeProblems>;
  errors: Array<Record<string, unknown>>;
}> {
  const config = configStore.load();
  configStore.getCluster(clusterId, config);
  const configuredThreshold = Number(config.settings.restartProblemThreshold ?? 3);
  const restartThreshold = Math.max(1, Number.isFinite(configuredThreshold) ? Math.trunc(configuredThreshold) : 3);

  const results = await Promise.all(
    PROBLEM_SOURCES.map(async (source) => {
      try {
        return {
          source,
          rows: await loadProblemSource(configStore, runner, clusterId, source, signal),
          error: null,
        };
      } catch (error) {
        if (!(error instanceof KubectlError)) throw error;
        return {
          source,
          rows: [] as Array<Record<string, unknown>>,
          error: {
            ...error.info,
            resource: source.resource,
            namespace: source.namespace,
          } as Record<string, unknown>,
        };
      }
    }),
  );

  const sources: ProblemSourceRows = {};
  const errors: Array<Record<string, unknown>> = [];
  for (const result of results) {
    sources[result.source.resource] = result.rows;
    if (result.error) errors.push(result.error);
  }

  const items = buildProblemRows(sources.pods ?? [], sources.deployments ?? [], sources.events ?? [], sources.nodes ?? [], sources.persistentvolumeclaims ?? [], restartThreshold);

  return {
    items,
    summary: summarizeProblems(items, sources, errors),
    errors,
  };
}

export function handleProblemsRequest(request: IncomingMessage, response: ServerResponse, pathname: string, configStore: ConfigStore, runner: KubectlRunner, log: (message: string) => void): boolean {
  try {
    const target = matchProblemsRoute(request.method, pathname);
    if (!target) return false;
    // Five cluster-wide lists per refresh: leaving them running for a panel
    // nobody is looking at any more is the most expensive thing this route can
    // do.
    const signal = requestAbortSignal(request, response);
    void buildProblemsResponse(configStore, runner, target.clusterId, signal)
      .then((body) => writeJson(response, body))
      .catch((error) => {
        if (isRequestCancelled(error, signal)) return;
        writeRouteError(response, error, log, { label: "problems", fallbackCode: "PROBLEMS_FAILED", fallbackMessage: "Unable to build Kubernetes problems dashboard" });
      });
    return true;
  } catch (error) {
    writeRouteError(response, error, log, { label: "problems", fallbackCode: "PROBLEMS_FAILED", fallbackMessage: "Unable to build Kubernetes problems dashboard" });
    return true;
  }
}
