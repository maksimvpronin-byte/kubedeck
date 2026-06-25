import type { IncomingMessage, ServerResponse } from "node:http";
import { ClusterNotFoundError, type ConfigStore } from "../config/configStore";
import { writeError } from "../errors";
import { writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError, writeKubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import {
  buildProblemRows,
  summarizeProblems,
  type ProblemSourceRows,
} from "../problems/problemEngine";
import { normalizeResourceItems } from "../resources/normalizers";
import { RequestValidationError, validateIdentifier } from "../validation";

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

function decodePathPart(value: string, field: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new RequestValidationError(
      400,
      "INVALID_IDENTIFIER",
      `${field} is not valid URL encoding`,
    );
  }
}

function asItems(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as Record<string, unknown>).items;
  return Array.isArray(items) ? items : [];
}

export function matchProblemsRoute(
  method: string | undefined,
  pathname: string,
): ProblemsTarget | null {
  if (method !== "GET") return null;
  const match = pathname.match(/^\/clusters\/([^/]+)\/problems$/);
  if (!match) return null;
  return {
    clusterId: validateIdentifier(
      decodePathPart(match[1], "cluster_id"),
      "cluster_id",
      128,
    ),
  };
}

function resourceArgs(source: ProblemSourceDefinition): string[] {
  const args = ["get", source.resource];
  if (source.namespace === "all") args.push("-A");
  args.push("-o", "json");
  return args;
}

async function loadProblemSource(
  configStore: ConfigStore,
  runner: KubectlRunner,
  clusterId: string,
  source: ProblemSourceDefinition,
): Promise<Array<Record<string, unknown>>> {
  const data = await runner.runJson(
    clusterCommand(
      configStore,
      clusterId,
      resourceArgs(source),
      RESOURCE_TIMEOUT_SECONDS,
      RESOURCE_MAX_OUTPUT_BYTES,
    ),
  );
  return normalizeResourceItems(source.resource, asItems(data));
}

export async function buildProblemsResponse(
  configStore: ConfigStore,
  runner: KubectlRunner,
  clusterId: string,
): Promise<{
  items: ReturnType<typeof buildProblemRows>;
  summary: ReturnType<typeof summarizeProblems>;
  errors: Array<Record<string, unknown>>;
}> {
  const config = configStore.load();
  configStore.getCluster(clusterId, config);
  const configuredThreshold = Number(config.settings.restartProblemThreshold ?? 3);
  const restartThreshold = Math.max(
    1,
    Number.isFinite(configuredThreshold) ? Math.trunc(configuredThreshold) : 3,
  );

  const results = await Promise.all(
    PROBLEM_SOURCES.map(async (source) => {
      try {
        return {
          source,
          rows: await loadProblemSource(configStore, runner, clusterId, source),
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

  const items = buildProblemRows(
    sources.pods ?? [],
    sources.deployments ?? [],
    sources.events ?? [],
    sources.nodes ?? [],
    sources.persistentvolumeclaims ?? [],
    restartThreshold,
  );

  return {
    items,
    summary: summarizeProblems(items, sources, errors),
    errors,
  };
}

function writeRouteError(
  response: ServerResponse,
  error: unknown,
  log: (message: string) => void,
): void {
  if (error instanceof RequestValidationError) {
    writeError(response, error.statusCode, error.code, error.message);
    return;
  }
  if (error instanceof ClusterNotFoundError) {
    writeError(response, 404, "CLUSTER_NOT_FOUND", error.message);
    return;
  }
  if (error instanceof KubectlError) {
    writeKubectlError(response, error);
    return;
  }
  log(
    `gateway problems failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  writeError(
    response,
    500,
    "PROBLEMS_FAILED",
    "Unable to build Kubernetes problems dashboard",
  );
}

export function handleProblemsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  runner: KubectlRunner,
  log: (message: string) => void,
): boolean {
  try {
    const target = matchProblemsRoute(request.method, pathname);
    if (!target) return false;
    void buildProblemsResponse(configStore, runner, target.clusterId)
      .then((body) => writeJson(response, body))
      .catch((error) => writeRouteError(response, error, log));
    return true;
  } catch (error) {
    writeRouteError(response, error, log);
    return true;
  }
}
