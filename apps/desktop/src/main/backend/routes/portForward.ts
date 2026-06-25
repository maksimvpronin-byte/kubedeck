import type { IncomingMessage, ServerResponse } from "node:http";

import type { AuditStore } from "../audit/auditStore";
import { ClusterNotFoundError, type ConfigStore } from "../config/configStore";
import { readJsonBody, RequestBodyError, writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import {
  PortForwardError,
  type PortForwardManager,
  type PortForwardStartInput,
} from "../portForward/portForwardManager";
import { RequestValidationError, validateIdentifier } from "../validation";

const REQUEST_MAX_BYTES = 64 * 1024;
const SUPPORTED_RESOURCES = new Map<string, PortForwardStartInput["resource"]>([
  ["pod", "pod"],
  ["pods", "pod"],
  ["service", "service"],
  ["services", "service"],
  ["deployment", "deployment"],
  ["deployments", "deployment"],
]);

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function integerPort(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RequestValidationError(
      422,
      "INVALID_PORT",
      `${field} must be an integer`,
    );
  }
  return value;
}

async function readStartInput(
  request: IncomingMessage,
): Promise<PortForwardStartInput> {
  const body = await readJsonBody(request, REQUEST_MAX_BYTES);
  if (!isRecord(body)) {
    throw new RequestValidationError(
      422,
      "INVALID_REQUEST",
      "Request body must be an object",
    );
  }

  const rawResource = validateIdentifier(
    String(body.resource ?? ""),
    "resource",
    64,
  ).toLowerCase();
  const resource = SUPPORTED_RESOURCES.get(rawResource);
  if (!resource) {
    throw new RequestValidationError(
      400,
      "INVALID_RESOURCE",
      "Port-forward supports pods, services, and deployments",
    );
  }

  const namespace = validateIdentifier(
    String(body.namespace ?? ""),
    "namespace",
  );
  if (namespace === "all" || namespace === "_cluster") {
    throw new RequestValidationError(
      400,
      "INVALID_NAMESPACE",
      "Port-forward requires a concrete namespace",
    );
  }

  const name = validateIdentifier(String(body.name ?? ""), "name");
  const localPort = integerPort(body.localPort, "localPort");
  const remotePort = integerPort(body.remotePort, "remotePort");
  if (localPort < 0 || localPort > 65535 || remotePort < 1 || remotePort > 65535) {
    throw new RequestValidationError(
      400,
      "INVALID_PORT",
      "Local port must be 0..65535 and remote port must be 1..65535",
    );
  }

  return { resource, namespace, name, localPort, remotePort };
}

function writeRouteError(
  response: ServerResponse,
  error: unknown,
  log: (message: string) => void,
): void {
  if (error instanceof RequestBodyError) {
    writeJson(
      response,
      {
        detail: {
          code: error.code,
          message: error.message,
          rawStderr: "",
          commandPreview: "",
        },
      },
      error.code === "REQUEST_TOO_LARGE" ? 413 : 400,
    );
    return;
  }
  if (error instanceof RequestValidationError) {
    writeJson(
      response,
      {
        detail: {
          code: error.code,
          message: error.message,
          rawStderr: "",
          commandPreview: "",
        },
      },
      error.statusCode,
    );
    return;
  }
  if (error instanceof ClusterNotFoundError) {
    writeJson(
      response,
      {
        detail: {
          code: "CLUSTER_NOT_FOUND",
          message: error.message,
          rawStderr: "",
          commandPreview: "",
        },
      },
      404,
    );
    return;
  }
  if (error instanceof PortForwardError) {
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
      error.statusCode,
    );
    return;
  }
  log(
    `gateway port-forward failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  writeJson(
    response,
    {
      detail: {
        code: "PORT_FORWARD_FAILED",
        message: "Unable to manage port-forward session",
        rawStderr: "",
        commandPreview: "",
      },
    },
    500,
  );
}

async function startPortForward(
  request: IncomingMessage,
  response: ServerResponse,
  clusterId: string,
  configStore: ConfigStore,
  auditStore: AuditStore,
  manager: PortForwardManager,
): Promise<void> {
  const input = await readStartInput(request);
  try {
    const result = await manager.start(
      (localPort) =>
        clusterCommand(
          configStore,
          clusterId,
          [
            "port-forward",
            "--address",
            "127.0.0.1",
            "-n",
            input.namespace,
            `${input.resource}/${input.name}`,
            `${localPort}:${input.remotePort}`,
          ],
          0,
          0,
        ),
      clusterId,
      input,
    );
    if (!result.alreadyRunning) {
      auditStore.append({
        action: "port-forward.start",
        status: "success",
        clusterId,
        namespace: input.namespace,
        resource: input.resource,
        name: input.name,
        commandPreview: result.commandPreview,
        extra: {
          localPort: result.localPort,
          remotePort: result.remotePort,
        },
      });
    }
    writeJson(response, result);
  } catch (error) {
    if (error instanceof PortForwardError) {
      auditStore.append({
        action: "port-forward.start",
        status: "failed",
        clusterId,
        namespace: input.namespace,
        resource: input.resource,
        name: input.name,
        commandPreview: error.commandPreview,
        message: error.message,
        extra: {
          localPort: input.localPort,
          remotePort: input.remotePort,
        },
      });
    }
    throw error;
  }
}

async function stopPortForward(
  response: ServerResponse,
  sessionId: string,
  auditStore: AuditStore,
  manager: PortForwardManager,
): Promise<void> {
  if (sessionId.startsWith("external:")) {
    throw new PortForwardError(
      403,
      "EXTERNAL_PORT_FORWARD_READ_ONLY",
      "KubeDeck will not stop external port-forward processes",
    );
  }
  const before = manager.get(sessionId);
  if (!before) {
    throw new PortForwardError(
      404,
      "PORT_FORWARD_NOT_FOUND",
      "Port-forward session not found",
    );
  }
  await manager.stop(sessionId, true);
  auditStore.append({
    action: "port-forward.stop",
    status: "success",
    clusterId: before.clusterId,
    namespace: before.namespace,
    resource: before.resource,
    name: before.name,
    commandPreview: before.commandPreview,
    extra: {
      localPort: before.localPort,
      remotePort: before.remotePort,
    },
  });
  writeJson(response, { ok: true });
}

export function handlePortForwardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  auditStore: AuditStore,
  manager: PortForwardManager,
  log: (message: string) => void,
): boolean {
  try {
    if (request.method === "GET" && pathname === "/port-forwards") {
      writeJson(response, { items: manager.list() });
      return true;
    }

    const startMatch = pathname.match(/^\/clusters\/([^/]+)\/port-forwards$/);
    if (request.method === "POST" && startMatch) {
      const clusterId = validateIdentifier(
        decodePart(startMatch[1], "cluster_id"),
        "cluster_id",
        128,
      );
      void startPortForward(
        request,
        response,
        clusterId,
        configStore,
        auditStore,
        manager,
      ).catch((error) => writeRouteError(response, error, log));
      return true;
    }

    const stopMatch = pathname.match(/^\/port-forwards\/([^/]+)$/);
    if (request.method === "DELETE" && stopMatch) {
      const sessionId = validateIdentifier(
        decodePart(stopMatch[1], "session_id"),
        "session_id",
        128,
      );
      void stopPortForward(response, sessionId, auditStore, manager).catch(
        (error) => writeRouteError(response, error, log),
      );
      return true;
    }

    return false;
  } catch (error) {
    writeRouteError(response, error, log);
    return true;
  }
}
