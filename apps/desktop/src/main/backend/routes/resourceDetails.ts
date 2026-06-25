import type { IncomingMessage, ServerResponse } from "node:http";
import { ClusterNotFoundError, type ConfigStore } from "../config/configStore";
import { writeError } from "../errors";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError, writeKubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import {
  normalizeTailLines,
  parseBooleanQuery,
  RequestValidationError,
  validateIdentifier,
} from "../validation";

const TEXT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const LOGS_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const LOGS_FULL_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

type DetailOperation = "yaml" | "describe" | "logs";

export interface ResourceDetailsTarget {
  clusterId: string;
  resource: string;
  namespace: string;
  name: string;
  operation: DetailOperation;
}

export interface ResourceDetailsInvocation {
  args: string[];
  timeoutSeconds: number;
  maxOutputBytes: number;
}

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

export function matchResourceDetailsPath(pathname: string): ResourceDetailsTarget | null {
  const podMatch = pathname.match(
    /^\/clusters\/([^/]+)\/pods\/([^/]+)\/([^/]+)\/(yaml|describe|logs)$/,
  );
  if (podMatch) {
    return {
      clusterId: decodePathPart(podMatch[1], "cluster_id"),
      resource: "pod",
      namespace: validateIdentifier(decodePathPart(podMatch[2], "namespace"), "namespace"),
      name: validateIdentifier(decodePathPart(podMatch[3], "name"), "name"),
      operation: podMatch[4] as DetailOperation,
    };
  }

  const resourceMatch = pathname.match(
    /^\/clusters\/([^/]+)\/resources\/([^/]+)\/([^/]+)\/([^/]+)\/(yaml|describe)$/,
  );
  if (!resourceMatch) return null;

  const namespaceRaw = decodePathPart(resourceMatch[3], "namespace");
  const namespace = namespaceRaw === "_cluster"
    ? "_cluster"
    : validateIdentifier(namespaceRaw, "namespace");

  return {
    clusterId: decodePathPart(resourceMatch[1], "cluster_id"),
    resource: validateIdentifier(
      decodePathPart(resourceMatch[2], "resource"),
      "resource",
      128,
    ).toLowerCase(),
    namespace,
    name: validateIdentifier(decodePathPart(resourceMatch[4], "name"), "name"),
    operation: resourceMatch[5] as DetailOperation,
  };
}

export function buildResourceDetailsInvocation(
  target: ResourceDetailsTarget,
  requestUrl: string,
): ResourceDetailsInvocation {
  if (target.operation === "logs") {
    const url = new URL(requestUrl, "http://127.0.0.1");
    const allLogs = parseBooleanQuery(url.searchParams.get("all"), "all");
    const follow = parseBooleanQuery(url.searchParams.get("follow"), "follow");
    const previous = parseBooleanQuery(url.searchParams.get("previous"), "previous");
    const timestamps = parseBooleanQuery(url.searchParams.get("timestamps"), "timestamps");

    if (follow) {
      throw new RequestValidationError(
        400,
        "FOLLOW_LOGS_REQUIRES_STREAM",
        "HTTP logs endpoint is bounded; KubeDeck uses bounded polling for follow mode",
      );
    }

    const args = ["--request-timeout=20s", "logs", target.name, "-n", target.namespace];
    let timeoutSeconds: number;
    let maxOutputBytes: number;

    if (allLogs) {
      args.push("--tail=-1");
      timeoutSeconds = 60;
      maxOutputBytes = LOGS_FULL_MAX_OUTPUT_BYTES;
    } else {
      args.push(`--tail=${normalizeTailLines(url.searchParams.get("tail"))}`);
      timeoutSeconds = 35;
      maxOutputBytes = LOGS_MAX_OUTPUT_BYTES;
    }

    const container = url.searchParams.get("container");
    if (container) {
      args.push("-c", validateIdentifier(container, "container", 253));
    }
    if (previous) args.push("--previous");
    if (timestamps) args.push("--timestamps");

    return { args, timeoutSeconds, maxOutputBytes };
  }

  const args = target.operation === "yaml"
    ? ["get", target.resource, target.name]
    : ["describe", target.resource, target.name];

  if (target.namespace !== "_cluster") {
    args.push("-n", target.namespace);
  }
  if (target.operation === "yaml") {
    args.push("-o", "yaml");
  }

  return {
    args,
    timeoutSeconds: 30,
    maxOutputBytes: TEXT_MAX_OUTPUT_BYTES,
  };
}

function writePlainText(response: ServerResponse, body: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
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

  log(`gateway resource details failed: ${error instanceof Error ? error.message : String(error)}`);
  writeError(response, 500, "RESOURCE_DETAILS_FAILED", "Unable to load resource details");
}

async function executeResourceDetails(
  request: IncomingMessage,
  response: ServerResponse,
  target: ResourceDetailsTarget,
  configStore: ConfigStore,
  runner: KubectlRunner,
): Promise<void> {
  const invocation = buildResourceDetailsInvocation(target, request.url ?? "/");
  const result = await runner.run(clusterCommand(
    configStore,
    target.clusterId,
    invocation.args,
    invocation.timeoutSeconds,
    invocation.maxOutputBytes,
  ));
  writePlainText(response, result.stdout);
}

export function handleResourceDetailsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  runner: KubectlRunner,
  log: (message: string) => void,
): boolean {
  if (request.method !== "GET") return false;

  let target: ResourceDetailsTarget | null;
  try {
    target = matchResourceDetailsPath(pathname);
  } catch (error) {
    writeRouteError(response, error, log);
    return true;
  }

  if (!target) return false;

  void executeResourceDetails(request, response, target, configStore, runner)
    .catch((error) => writeRouteError(response, error, log));
  return true;
}
