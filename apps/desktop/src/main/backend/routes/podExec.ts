import type { IncomingMessage, ServerResponse } from "node:http";

import type { AuditStore } from "../audit/auditStore";
import { type ConfigStore } from "../config/configStore";
import { readJsonBody, writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import { RequestValidationError, confirmationString, decodePathPart, validateIdentifier } from "../validation";
import { RouteInfoError, writeRouteError } from "./routeErrors";

const EXEC_REQUEST_MAX_BYTES = 64 * 1024;
const MAX_EXEC_COMMAND_CHARS = 4000;
const EXEC_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const AUTH_MAX_OUTPUT_BYTES = 1024 * 1024;
const EXEC_TIMEOUT_SECONDS = 60;
const AUTH_TIMEOUT_SECONDS = 15;

type ExecShell = "sh" | "bash" | "ash";
type JsonObject = Record<string, unknown>;

interface OperationConfirmation {
  clusterId?: unknown;
  action?: unknown;
  typedName?: unknown;
  namespace?: unknown;
  resource?: unknown;
  name?: unknown;
}

interface PodExecRequestPayload {
  command: string;
  container: string;
  shell: ExecShell;
  confirmation?: OperationConfirmation;
}

export interface PodExecRouteTarget {
  clusterId: string;
  namespace: string;
  name: string;
}

export interface PodExecPlan {
  args: string[];
  command: string;
  container: string;
  shell: ExecShell;
  timeoutSeconds: number;
  maxOutputBytes: number;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function matchPodExecRoute(method: string | undefined, pathname: string): PodExecRouteTarget | null {
  if (method !== "POST") return null;

  const match = pathname.match(/^\/clusters\/([^/]+)\/pods\/([^/]+)\/([^/]+)\/exec$/);
  if (!match) return null;

  return {
    clusterId: validateIdentifier(decodePathPart(match[1], "cluster_id"), "cluster_id", 128),
    namespace: validateIdentifier(decodePathPart(match[2], "namespace"), "namespace"),
    name: validateIdentifier(decodePathPart(match[3], "name"), "name"),
  };
}

function normalizeCommand(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RequestValidationError(400, "EMPTY_COMMAND", "Command is required");
  }

  const command = value.trim();
  if (command.length > MAX_EXEC_COMMAND_CHARS) {
    throw new RequestValidationError(400, "COMMAND_TOO_LONG", `Command is too long; limit is ${MAX_EXEC_COMMAND_CHARS} characters`);
  }

  return command;
}

function normalizeShell(value: unknown): ExecShell {
  if (value === undefined || value === null || value === "") return "sh";
  if (typeof value !== "string") {
    throw new RequestValidationError(422, "INVALID_REQUEST", "shell must be a string");
  }

  const shell = value.trim() || "sh";
  if (!["sh", "bash", "ash"].includes(shell)) {
    throw new RequestValidationError(400, "INVALID_SHELL", "Shell must be sh, bash, or ash");
  }

  return shell as ExecShell;
}

function normalizeContainer(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw new RequestValidationError(422, "INVALID_REQUEST", "container must be a string");
  }

  const container = value.trim();
  return container ? validateIdentifier(container, "container", 253) : "";
}

async function readExecPayload(request: IncomingMessage): Promise<PodExecRequestPayload> {
  const body = await readJsonBody(request, EXEC_REQUEST_MAX_BYTES);

  if (!isRecord(body)) {
    throw new RequestValidationError(422, "INVALID_REQUEST", "Request body must be an object");
  }

  if (body.confirmation !== undefined && body.confirmation !== null && !isRecord(body.confirmation)) {
    throw new RequestValidationError(422, "INVALID_REQUEST", "confirmation must be an object");
  }

  return {
    command: normalizeCommand(body.command),
    container: normalizeContainer(body.container),
    shell: normalizeShell(body.shell),
    ...(isRecord(body.confirmation) ? { confirmation: body.confirmation as OperationConfirmation } : {}),
  };
}

export function requirePodExecConfirmation(confirmation: OperationConfirmation | undefined, target: PodExecRouteTarget): void {
  if (!confirmation) {
    throw new RequestValidationError(400, "CONFIRMATION_REQUIRED", "Confirmation is required for pod exec");
  }

  const checks: Array<[unknown, string, string, string]> = [
    [confirmation.clusterId, target.clusterId, "CONFIRMATION_CLUSTER_MISMATCH", "cluster"],
    [confirmation.action, "exec", "CONFIRMATION_ACTION_MISMATCH", "action"],
    [confirmation.resource, "pods", "CONFIRMATION_RESOURCE_MISMATCH", "resource"],
    [confirmation.namespace, target.namespace, "CONFIRMATION_NAMESPACE_MISMATCH", "namespace"],
    [confirmation.name, target.name, "CONFIRMATION_NAME_MISMATCH", "name"],
    [confirmation.typedName, target.name, "CONFIRMATION_TYPED_NAME_MISMATCH", "typedName"],
  ];

  for (const [actual, expected, code, field] of checks) {
    if (confirmationString(actual) !== expected) {
      throw new RequestValidationError(400, code, `Confirmation ${field} does not match request`);
    }
  }
}

export function buildPodExecPlan(target: PodExecRouteTarget, payload: Pick<PodExecRequestPayload, "command" | "container" | "shell">): PodExecPlan {
  const args = ["exec", target.name, "-n", target.namespace];

  if (payload.container) {
    args.push("-c", payload.container);
  }

  args.push("--", payload.shell, "-lc", payload.command);

  return {
    args,
    command: payload.command,
    container: payload.container,
    shell: payload.shell,
    timeoutSeconds: EXEC_TIMEOUT_SECONDS,
    maxOutputBytes: EXEC_MAX_OUTPUT_BYTES,
  };
}

async function verifyPodExecAuthorization(configStore: ConfigStore, runner: KubectlRunner, target: PodExecRouteTarget): Promise<void> {
  const authCommand = clusterCommand(configStore, target.clusterId, ["auth", "can-i", "create", "pods/exec", "-n", target.namespace], AUTH_TIMEOUT_SECONDS, AUTH_MAX_OUTPUT_BYTES);

  const result = await runner.run(authCommand);
  const output = result.stdout.trim().toLowerCase();

  if (!new Set(["yes", "y"]).has(output)) {
    throw new RouteInfoError(403, {
      code: "KUBECTL_AUTH_DENIED",
      message: `kubectl auth can-i create pods/exec returned ${output || "no"}`,
      rawStderr: "",
      commandPreview: result.commandPreview,
    });
  }
}

async function executePodExec(request: IncomingMessage, response: ServerResponse, target: PodExecRouteTarget, configStore: ConfigStore, auditStore: AuditStore, runner: KubectlRunner): Promise<void> {
  const payload = await readExecPayload(request);
  requirePodExecConfirmation(payload.confirmation, target);

  const plan = buildPodExecPlan(target, payload);
  await verifyPodExecAuthorization(configStore, runner, target);

  const command = clusterCommand(configStore, target.clusterId, plan.args, plan.timeoutSeconds, plan.maxOutputBytes);

  try {
    const result = await runner.run(command);
    const status = result.returnCode === 0 ? "success" : "failed";

    auditStore.append({
      action: "pod.exec",
      status,
      clusterId: target.clusterId,
      namespace: target.namespace,
      resource: "pods",
      name: target.name,
      commandPreview: result.commandPreview,
      extra: {
        returnCode: result.returnCode,
        container: plan.container,
        shell: plan.shell,
      },
    });

    writeJson(response, {
      ok: result.returnCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      commandPreview: result.commandPreview,
      returnCode: result.returnCode,
    });
  } catch (error) {
    if (error instanceof KubectlError) {
      auditStore.append({
        action: "pod.exec",
        status: "failed",
        clusterId: target.clusterId,
        namespace: target.namespace,
        resource: "pods",
        name: target.name,
        commandPreview: error.info.commandPreview,
        message: error.info.message,
        extra: {
          container: plan.container,
          shell: plan.shell,
        },
      });
    }

    throw error;
  }
}

export function handlePodExecRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  auditStore: AuditStore,
  runner: KubectlRunner,
  log: (message: string) => void,
): boolean {
  let target: PodExecRouteTarget | null;

  try {
    target = matchPodExecRoute(request.method, pathname);
  } catch (error) {
    writeRouteError(response, error, log, { label: "pod exec", fallbackCode: "POD_EXEC_FAILED", fallbackMessage: "Unable to execute command in pod" });
    return true;
  }

  if (!target) return false;

  void executePodExec(request, response, target, configStore, auditStore, runner).catch((error) =>
    writeRouteError(response, error, log, { label: "pod exec", fallbackCode: "POD_EXEC_FAILED", fallbackMessage: "Unable to execute command in pod" }),
  );

  return true;
}
