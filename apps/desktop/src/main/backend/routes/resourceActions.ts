import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuditStore } from "../audit/auditStore";
import { type ConfigStore } from "../config/configStore";
import { readJsonBody } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import { RequestValidationError, confirmationString, decodePathPart, validateIdentifier } from "../validation";
import { RouteInfoError, writeRouteError } from "./routeErrors";

const ACTION_REQUEST_MAX_BYTES = 64 * 1024;
const ACTION_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const AUTH_MAX_OUTPUT_BYTES = 1024 * 1024;
const ACTION_TIMEOUT_SECONDS = 45;
const DRAIN_TIMEOUT_SECONDS = 330;
const AUTH_TIMEOUT_SECONDS = 15;

export type ResourceAction = "delete" | "restart" | "redeploy" | "scale" | "cordon" | "uncordon" | "drain" | "trigger";

const RESOURCE_ACTIONS = ["delete", "restart", "redeploy", "scale", "cordon", "uncordon", "drain", "trigger"];

// A Job created by hand needs a name of its own, and Kubernetes will only take a
// DNS-1123 label for it. The name arrives from the caller rather than being
// invented here, so the command the confirmation showed is the command that runs.
const JOB_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const MAX_JOB_NAME_LENGTH = 63;

interface OperationConfirmation {
  clusterId?: unknown;
  action?: unknown;
  typedName?: unknown;
  namespace?: unknown;
  resource?: unknown;
  name?: unknown;
}

interface ResourceActionRequestPayload {
  action: ResourceAction;
  replicas?: number;
  jobName?: string;
  confirmation?: OperationConfirmation;
}

export interface ResourceActionRouteTarget {
  clusterId: string;
  resource: string;
  namespace: string;
  name: string;
}

export interface AuthorizationCheck {
  verb: string;
  resource: string;
  namespace: string;
  allNamespaces?: boolean;
}

export interface ResourceActionPlan {
  action: ResourceAction;
  args: string[];
  namespace: string;
  replicas?: number;
  jobName?: string;
  authorizationChecks: AuthorizationCheck[];
  timeoutSeconds: number;
  maxOutputBytes: number;
}

type CacheInvalidator = (clusterId: string) => Promise<void>;

function actionExtra(plan: ResourceActionPlan): { extra?: Record<string, unknown> } {
  if (plan.action === "scale") return { extra: { replicas: plan.replicas } };
  if (plan.action === "trigger") return { extra: { jobName: plan.jobName } };
  return {};
}

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function matchResourceActionRoute(method: string | undefined, pathname: string): ResourceActionRouteTarget | null {
  if (method !== "POST") return null;

  const match = pathname.match(/^\/clusters\/([^/]+)\/resources\/([^/]+)\/([^/]+)\/([^/]+)\/action$/);
  if (!match) return null;

  const namespaceValue = decodePathPart(match[3], "namespace");

  return {
    clusterId: validateIdentifier(decodePathPart(match[1], "cluster_id"), "cluster_id", 128),
    resource: validateIdentifier(decodePathPart(match[2], "resource"), "resource", 128).toLowerCase(),
    namespace: namespaceValue === "_cluster" ? "_cluster" : validateIdentifier(namespaceValue, "namespace"),
    name: validateIdentifier(decodePathPart(match[4], "name"), "name"),
  };
}

function normalizeAction(value: unknown): ResourceAction {
  if (typeof value !== "string" || !value.trim()) {
    throw new RequestValidationError(422, "INVALID_REQUEST", "action must be a non-empty string");
  }

  const action = value.trim().toLowerCase();
  if (!RESOURCE_ACTIONS.includes(action)) {
    throw new RequestValidationError(400, "UNSUPPORTED_ACTION", `Unsupported action: ${value}`);
  }

  return action as ResourceAction;
}

function normalizeJobName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RequestValidationError(400, "INVALID_JOB_NAME", "jobName must be a non-empty string");
  }
  const name = value.trim();
  if (name.length > MAX_JOB_NAME_LENGTH || !JOB_NAME_PATTERN.test(name)) {
    throw new RequestValidationError(400, "INVALID_JOB_NAME", `jobName must be a DNS-1123 label of at most ${MAX_JOB_NAME_LENGTH} characters`);
  }
  return name;
}

function normalizeReplicas(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RequestValidationError(400, "INVALID_REPLICAS", "replicas must be a non-negative integer");
  }
  return value;
}

async function readActionPayload(request: IncomingMessage): Promise<ResourceActionRequestPayload> {
  const body = await readJsonBody(request, ACTION_REQUEST_MAX_BYTES);
  if (!isRecord(body)) {
    throw new RequestValidationError(422, "INVALID_REQUEST", "Request body must be an object");
  }

  return {
    action: normalizeAction(body.action),
    ...(body.replicas !== undefined ? { replicas: normalizeReplicas(body.replicas) } : {}),
    ...(body.jobName !== undefined ? { jobName: normalizeJobName(body.jobName) } : {}),
    ...(isRecord(body.confirmation) ? { confirmation: body.confirmation as OperationConfirmation } : {}),
  };
}

function unsupported(action: ResourceAction, resource: string): never {
  throw new RequestValidationError(400, "UNSUPPORTED_ACTION", `${action} is not supported for ${resource}`);
}

export function buildResourceActionPlan(target: ResourceActionRouteTarget, action: ResourceAction, replicas?: number, jobName?: string): ResourceActionPlan {
  const resource = target.resource;
  const namespaced = target.namespace !== "_cluster";
  const namespaceArgs = namespaced ? ["-n", target.namespace] : [];

  if (action === "delete") {
    const forceArgs = ["pod", "pods"].includes(resource) ? ["--force", "--grace-period=0"] : [];
    return {
      action,
      args: ["delete", resource, target.name, ...forceArgs, "--wait=false", ...namespaceArgs],
      namespace: target.namespace,
      authorizationChecks: [
        {
          verb: "delete",
          resource,
          namespace: target.namespace,
        },
      ],
      timeoutSeconds: ACTION_TIMEOUT_SECONDS,
      maxOutputBytes: ACTION_MAX_OUTPUT_BYTES,
    };
  }

  if (action === "restart" || action === "redeploy") {
    if (["pod", "pods"].includes(resource)) {
      return {
        action,
        args: ["delete", "pod", target.name, "--wait=false", ...namespaceArgs],
        namespace: target.namespace,
        authorizationChecks: [
          {
            verb: "delete",
            resource,
            namespace: target.namespace,
          },
        ],
        timeoutSeconds: ACTION_TIMEOUT_SECONDS,
        maxOutputBytes: ACTION_MAX_OUTPUT_BYTES,
      };
    }

    if (["deployment", "deployments", "statefulset", "statefulsets", "daemonset", "daemonsets"].includes(resource)) {
      return {
        action,
        args: ["rollout", "restart", `${resource}/${target.name}`, ...namespaceArgs],
        namespace: target.namespace,
        authorizationChecks: [
          {
            verb: "patch",
            resource,
            namespace: target.namespace,
          },
        ],
        timeoutSeconds: ACTION_TIMEOUT_SECONDS,
        maxOutputBytes: ACTION_MAX_OUTPUT_BYTES,
      };
    }

    return unsupported(action, resource);
  }

  if (action === "scale") {
    if (replicas === undefined || !Number.isInteger(replicas) || replicas < 0) {
      throw new RequestValidationError(400, "INVALID_REPLICAS", "replicas must be a non-negative integer");
    }

    if (!["deployment", "deployments", "statefulset", "statefulsets", "replicaset", "replicasets"].includes(resource)) {
      return unsupported(action, resource);
    }

    return {
      action,
      args: ["scale", `${resource}/${target.name}`, `--replicas=${replicas}`, ...namespaceArgs],
      namespace: target.namespace,
      replicas,
      authorizationChecks: [
        {
          verb: "update",
          resource: `${resource}/scale`,
          namespace: target.namespace,
        },
      ],
      timeoutSeconds: ACTION_TIMEOUT_SECONDS,
      maxOutputBytes: ACTION_MAX_OUTPUT_BYTES,
    };
  }

  if (action === "trigger") {
    if (!["cronjob", "cronjobs"].includes(resource)) {
      return unsupported(action, resource);
    }
    if (!namespaced) {
      throw new RequestValidationError(400, "INVALID_NAMESPACE", "trigger requires a namespaced CronJob");
    }

    // What kubectl does for `create job --from=cronjob/x`: it copies the job
    // template out of the CronJob and creates one Job from it. The schedule is
    // untouched, and the CronJob keeps running as it did.
    const name = normalizeJobName(jobName);
    return {
      action,
      args: ["create", "job", name, `--from=cronjob/${target.name}`, ...namespaceArgs],
      namespace: target.namespace,
      jobName: name,
      authorizationChecks: [
        {
          verb: "create",
          resource: "jobs",
          namespace: target.namespace,
        },
      ],
      timeoutSeconds: ACTION_TIMEOUT_SECONDS,
      maxOutputBytes: ACTION_MAX_OUTPUT_BYTES,
    };
  }

  if (!["node", "nodes"].includes(resource)) {
    return unsupported(action, resource);
  }

  if (action === "drain") {
    return {
      action,
      args: ["drain", target.name, "--ignore-daemonsets", "--delete-emptydir-data", "--timeout=300s"],
      namespace: "_cluster",
      authorizationChecks: [
        { verb: "patch", resource: "nodes", namespace: "_cluster" },
        {
          verb: "create",
          resource: "pods/eviction",
          namespace: "_cluster",
          allNamespaces: true,
        },
      ],
      timeoutSeconds: DRAIN_TIMEOUT_SECONDS,
      maxOutputBytes: ACTION_MAX_OUTPUT_BYTES,
    };
  }

  return {
    action,
    args: [action, target.name],
    namespace: "_cluster",
    authorizationChecks: [
      {
        verb: "patch",
        resource: "nodes",
        namespace: "_cluster",
      },
    ],
    timeoutSeconds: ACTION_TIMEOUT_SECONDS,
    maxOutputBytes: ACTION_MAX_OUTPUT_BYTES,
  };
}

export function requireResourceActionConfirmation(confirmation: OperationConfirmation | undefined, target: ResourceActionRouteTarget, plan: ResourceActionPlan): void {
  if (!confirmation || !isRecord(confirmation)) {
    throw new RequestValidationError(400, "CONFIRMATION_REQUIRED", "Confirmation is required for resource action");
  }

  const checks: Array<[unknown, string, string, string]> = [
    [confirmation.clusterId, target.clusterId, "CONFIRMATION_CLUSTER_MISMATCH", "cluster"],
    [confirmation.action, plan.action, "CONFIRMATION_ACTION_MISMATCH", "action"],
    [confirmation.resource, target.resource, "CONFIRMATION_RESOURCE_MISMATCH", "resource"],
    [confirmation.namespace, plan.namespace, "CONFIRMATION_NAMESPACE_MISMATCH", "namespace"],
    [confirmation.name, target.name, "CONFIRMATION_NAME_MISMATCH", "name"],
  ];

  for (const [actual, expected, code, field] of checks) {
    if (confirmationString(actual) !== expected) {
      throw new RequestValidationError(400, code, `Confirmation ${field} does not match request`);
    }
  }

  if (["restart", "redeploy", "scale", "trigger"].includes(plan.action)) {
    if (confirmationString(confirmation.typedName) !== target.name) {
      throw new RequestValidationError(400, "CONFIRMATION_TYPED_NAME_MISMATCH", "Typed confirmation value is invalid");
    }
  }
}

async function verifyAuthorization(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, check: AuthorizationCheck): Promise<void> {
  const args = ["auth", "can-i", check.verb, check.resource];
  if (check.allNamespaces) {
    args.push("--all-namespaces");
  } else if (check.namespace !== "_cluster") {
    args.push("-n", check.namespace);
  }

  const command = clusterCommand(configStore, clusterId, args, AUTH_TIMEOUT_SECONDS, AUTH_MAX_OUTPUT_BYTES);
  const result = await runner.run(command);
  const output = result.stdout.trim().toLowerCase();

  if (!new Set(["yes", "y"]).has(output)) {
    throw new RouteInfoError(403, {
      code: "KUBECTL_AUTH_DENIED",
      message: `kubectl auth can-i ${check.verb} ${check.resource} returned ${output || "no"}`,
      rawStderr: "",
      commandPreview: result.commandPreview,
    });
  }
}

function writePlainText(response: ServerResponse, body: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

async function executeResourceAction(
  request: IncomingMessage,
  response: ServerResponse,
  target: ResourceActionRouteTarget,
  configStore: ConfigStore,
  auditStore: AuditStore,
  runner: KubectlRunner,
  log: (message: string) => void,
  invalidateResourceCache: CacheInvalidator,
): Promise<void> {
  const payload = await readActionPayload(request);
  const plan = buildResourceActionPlan(target, payload.action, payload.replicas, payload.jobName);
  requireResourceActionConfirmation(payload.confirmation, target, plan);

  for (const check of plan.authorizationChecks) {
    await verifyAuthorization(configStore, runner, target.clusterId, check);
  }

  const command = clusterCommand(configStore, target.clusterId, plan.args, plan.timeoutSeconds, plan.maxOutputBytes);

  try {
    const result = await runner.run(command);
    auditStore.append({
      action: `resource.${plan.action}`,
      status: "success",
      clusterId: target.clusterId,
      namespace: plan.namespace,
      resource: target.resource,
      name: target.name,
      commandPreview: result.commandPreview,
      ...actionExtra(plan),
    });

    try {
      await invalidateResourceCache(target.clusterId);
    } catch (error) {
      log(`gateway resource action cache invalidation failed cluster=${target.clusterId}: ${String(error)}`);
    }

    writePlainText(response, result.stdout);
  } catch (error) {
    if (error instanceof KubectlError) {
      auditStore.append({
        action: `resource.${plan.action}`,
        status: "failed",
        clusterId: target.clusterId,
        namespace: plan.namespace,
        resource: target.resource,
        name: target.name,
        commandPreview: error.info.commandPreview,
        message: error.info.message,
        ...actionExtra(plan),
      });
    }
    throw error;
  }
}

export function handleResourceActionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  auditStore: AuditStore,
  runner: KubectlRunner,
  log: (message: string) => void,
  invalidateResourceCache: CacheInvalidator = async () => {},
): boolean {
  let target: ResourceActionRouteTarget | null;
  try {
    target = matchResourceActionRoute(request.method, pathname);
  } catch (error) {
    writeRouteError(response, error, log, { label: "resource action", fallbackCode: "RESOURCE_ACTION_FAILED", fallbackMessage: "Unable to perform resource action" });
    return true;
  }

  if (!target) return false;

  void executeResourceAction(request, response, target, configStore, auditStore, runner, log, invalidateResourceCache).catch((error) =>
    writeRouteError(response, error, log, { label: "resource action", fallbackCode: "RESOURCE_ACTION_FAILED", fallbackMessage: "Unable to perform resource action" }),
  );

  return true;
}
