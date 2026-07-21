import type { IncomingMessage, ServerResponse } from "node:http";

import { ClusterNotFoundError, type ConfigStore } from "../config/configStore";
import { writeError } from "../errors";
import { readJsonBody, RequestBodyError, writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { RequestValidationError, validateIdentifier } from "../validation";
import {
  WatchManager,
  WatchStartError,
} from "../watch/watchManager";

interface WatchStartBody {
  resource: string;
  namespace?: string;
}

function decodePart(value: string, field: string): string {
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

function watchArgs(resource: string, namespace: string): string[] {
  const args = [
    "get",
    resource,
    "-o",
    "json",
    "--watch-only=true",
    "--output-watch-events=true",
  ];
  if (namespace === "all") args.push("-A");
  else if (namespace !== "_cluster") args.push("-n", namespace);
  return args;
}

function parseStartBody(value: unknown): WatchStartBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError(422, "INVALID_BODY", "Request body must be an object");
  }
  const record = value as Record<string, unknown>;
  const resource = validateIdentifier(String(record.resource ?? ""), "resource", 128).toLowerCase();
  const rawNamespace =
    typeof record.namespace === "string" && record.namespace.trim()
      ? record.namespace.trim()
      : "all";
  const namespace =
    rawNamespace === "all" || rawNamespace === "_cluster"
      ? rawNamespace
      : validateIdentifier(rawNamespace, "namespace");
  return { resource, namespace };
}

function writeWatchError(
  response: ServerResponse,
  error: unknown,
  log: (message: string) => void,
): void {
  if (error instanceof RequestValidationError) {
    writeError(response, error.statusCode, error.code, error.message);
    return;
  }
  if (error instanceof RequestBodyError) {
    writeError(
      response,
      error.code === "REQUEST_TOO_LARGE" ? 413 : 400,
      error.code,
      error.message,
    );
    return;
  }
  if (error instanceof ClusterNotFoundError) {
    writeError(response, 404, "CLUSTER_NOT_FOUND", error.message);
    return;
  }
  if (error instanceof WatchStartError) {
    writeJson(
      response,
      {
        detail: {
          code: error.code,
          message: error.message,
          rawStderr: error.rawStderr,
          commandPreview: error.commandPreview,
        },
      },
      502,
    );
    return;
  }
  log(`gateway watch route failed: ${error instanceof Error ? error.message : String(error)}`);
  writeError(response, 500, "WATCH_FAILED", "Unable to manage resource watch");
}

async function startWatch(
  request: IncomingMessage,
  response: ServerResponse,
  clusterId: string,
  configStore: ConfigStore,
  watchManager: WatchManager,
): Promise<void> {
  const body = parseStartBody(await readJsonBody(request, 64 * 1024));
  const namespace = body.namespace ?? "all";
  const command = clusterCommand(
    configStore,
    clusterId,
    watchArgs(body.resource, namespace),
    0,
    0,
  );
  writeJson(response, await watchManager.start(command, body.resource, namespace));
}

export function handleWatchRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  watchManager: WatchManager,
  log: (message: string) => void,
): boolean {
  try {
    if (request.method === "GET" && pathname === "/watches/status") {
      writeJson(response, watchManager.status());
      return true;
    }

    if (request.method === "POST" && pathname === "/watches/stop-all") {
      void watchManager
        .stopAll(true)
        .then((result) => writeJson(response, result))
        .catch((error) => writeWatchError(response, error, log));
      return true;
    }

    const startMatch = pathname.match(/^\/clusters\/([^/]+)\/watches$/);
    if (request.method === "POST" && startMatch) {
      const clusterId = validateIdentifier(
        decodePart(startMatch[1], "cluster_id"),
        "cluster_id",
        128,
      );
      void startWatch(request, response, clusterId, configStore, watchManager).catch(
        (error) => writeWatchError(response, error, log),
      );
      return true;
    }

    const stopMatch = pathname.match(/^\/watches\/([^/]+)$/);
    if (request.method === "DELETE" && stopMatch) {
      const watchId = validateIdentifier(
        decodePart(stopMatch[1], "watch_id"),
        "watch_id",
        64,
      );
      void watchManager
        .stop(watchId, true)
        .then((result) => writeJson(response, result))
        .catch((error) => writeWatchError(response, error, log));
      return true;
    }

    return false;
  } catch (error) {
    writeWatchError(response, error, log);
    return true;
  }
}
