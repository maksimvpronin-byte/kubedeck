import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuditStore } from "../audit/auditStore";
import type { ConfigStore } from "../config/configStore";
import type { ErrorInfo } from "../errors";
import { readJsonBody, writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { classifyKubectlError, KubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import { confirmationString, decodePathPart, isRecord, RequestValidationError, validateIdentifier } from "../validation";
import {
  type AuthorizationCheck,
  appendActionAudit,
  buildResourceActionPlan,
  deleteArgs,
  type NodeLabelChanges,
  normalizeNodeLabelChanges,
  objectIdentifier,
  type ResourceActionPlan,
  type ResourceActionRouteTarget,
  verifyAuthorization,
} from "./resourceActions";
import { RouteInfoError, writeRouteError } from "./routeErrors";

// One request for many objects of one kind. What it saves over a request per
// object: permissions are asked once per namespace instead of once per object,
// a delete names every object of a namespace in one kubectl call, a cordon
// names every node in one, and drains and labels run side by side. Each object
// still gets its own result and its own audit entry.

const BULK_REQUEST_MAX_BYTES = 1024 * 1024;
const MAX_BULK_TARGETS = 1000;
const BULK_CONCURRENCY = 5;
const NAMED_TIMEOUT_SECONDS = 60;
const NAMED_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
// A Windows command line ends at 32,767 characters, so one command names at
// most this many objects and this many characters of names.
const NAMED_CHUNK_NAMES = 50;
const NAMED_CHUNK_CHARS = 8000;

export type BulkResourceAction = "delete" | "cordon" | "uncordon" | "drain" | "label";
const BULK_ACTIONS: readonly string[] = ["delete", "cordon", "uncordon", "drain", "label"];

export interface BulkActionRouteTarget {
  clusterId: string;
  resource: string;
}

export interface BulkTarget {
  namespace: string;
  name: string;
  labels?: NodeLabelChanges;
}

export interface BulkTargetResult {
  namespace: string;
  name: string;
  ok: boolean;
  error?: ErrorInfo;
}

interface BulkPayload {
  action: BulkResourceAction;
  targets: BulkTarget[];
}

interface PlannedTarget {
  target: ResourceActionRouteTarget;
  plan: ResourceActionPlan;
}

type CacheInvalidator = (clusterId: string) => Promise<void>;

export function matchBulkResourceActionRoute(method: string | undefined, pathname: string): BulkActionRouteTarget | null {
  if (method !== "POST") return null;
  const match = pathname.match(/^\/clusters\/([^/]+)\/resources\/([^/]+)\/bulk-action$/);
  if (!match) return null;
  return {
    clusterId: validateIdentifier(decodePathPart(match[1], "cluster_id"), "cluster_id", 128),
    resource: validateIdentifier(decodePathPart(match[2], "resource"), "resource", 128).toLowerCase(),
  };
}

function targetNamespace(value: unknown): string {
  return value === "_cluster" ? "_cluster" : objectIdentifier(String(value ?? ""), "namespace");
}

function targetKey(target: { namespace: string; name: string }): string {
  return `${target.namespace}/${target.name}`;
}

// The confirmation lists the same objects in the same order: what the dialog
// showed is what runs, and nothing is added on the way.
export function parseBulkPayload(body: unknown, route: BulkActionRouteTarget): BulkPayload {
  if (!isRecord(body)) {
    throw new RequestValidationError(422, "INVALID_REQUEST", "Request body must be an object");
  }
  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  if (!BULK_ACTIONS.includes(action)) {
    throw new RequestValidationError(400, "UNSUPPORTED_ACTION", `Unsupported bulk action: ${String(body.action ?? "")}`);
  }
  if (!Array.isArray(body.targets) || body.targets.length === 0 || body.targets.length > MAX_BULK_TARGETS) {
    throw new RequestValidationError(400, "INVALID_TARGETS", `targets must list 1 to ${MAX_BULK_TARGETS} objects`);
  }

  const seen = new Set<string>();
  const targets = body.targets.map((entry): BulkTarget => {
    if (!isRecord(entry)) {
      throw new RequestValidationError(400, "INVALID_TARGETS", "Each target must be an object");
    }
    const target: BulkTarget = { namespace: targetNamespace(entry.namespace), name: objectIdentifier(String(entry.name ?? ""), "name") };
    if (seen.has(targetKey(target))) {
      throw new RequestValidationError(400, "DUPLICATE_TARGET", `${targetKey(target)} is listed twice`);
    }
    seen.add(targetKey(target));
    if (action === "label") target.labels = normalizeNodeLabelChanges(entry.labels);
    return target;
  });

  const confirmation = isRecord(body.confirmation) ? body.confirmation : {};
  const checks: Array<[unknown, string, string, string]> = [
    [confirmation.clusterId, route.clusterId, "CONFIRMATION_CLUSTER_MISMATCH", "cluster"],
    [confirmation.action, action, "CONFIRMATION_ACTION_MISMATCH", "action"],
    [confirmation.resource, route.resource, "CONFIRMATION_RESOURCE_MISMATCH", "resource"],
  ];
  for (const [actual, expected, code, field] of checks) {
    if (confirmationString(actual) !== expected) {
      throw new RequestValidationError(400, code, `Confirmation ${field} does not match request`);
    }
  }
  const confirmed = Array.isArray(confirmation.targets) ? confirmation.targets : [];
  const matches =
    confirmed.length === targets.length &&
    targets.every((target, index) => {
      const entry = confirmed[index];
      return isRecord(entry) && confirmationString(entry.namespace) === target.namespace && confirmationString(entry.name) === target.name;
    });
  if (!matches) {
    throw new RequestValidationError(400, "CONFIRMATION_TARGETS_MISMATCH", "Confirmation targets do not match request");
  }

  return { action: action as BulkResourceAction, targets };
}

function authorizationKey(check: AuthorizationCheck): string {
  return JSON.stringify([check.verb, check.resource, check.namespace, Boolean(check.allNamespaces)]);
}

function errorInfoOf(error: unknown, fallback: string): ErrorInfo {
  if (error instanceof KubectlError || error instanceof RouteInfoError) return error.info;
  return { code: "RESOURCE_ACTION_FAILED", message: error instanceof Error ? error.message : fallback, rawStderr: "", commandPreview: "" };
}

export async function mapWithConcurrency<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function chunkNames(names: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const name of names) {
    if (current.length && (current.length >= NAMED_CHUNK_NAMES || chars + name.length + 1 > NAMED_CHUNK_CHARS)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(name);
    chars += name.length + 1;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// kubectl prints a line beginning `kind/name` for each object it changed -
// `pod/a` for a delete with `-o name`, `node/a cordoned` for a cordon - and
// goes on past an object that fails.
export function changedNames(stdout: string): Set<string> {
  const names = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const [first = ""] = line.trim().split(/\s+/);
    if (first.includes("/")) names.add(first.slice(first.lastIndexOf("/") + 1));
  }
  return names;
}

function stderrLineFor(name: string, error: ErrorInfo): string | undefined {
  return error.rawStderr.split(/\r?\n/).find((entry) => entry.includes(`"${name}"`));
}

function failureFor(name: string, error: ErrorInfo): ErrorInfo {
  const line = stderrLineFor(name, error);
  if (!line) return error;
  return { code: classifyKubectlError(line), message: line.trim(), rawStderr: line.trim(), commandPreview: error.commandPreview };
}

export async function executeBulkResourceAction(
  route: BulkActionRouteTarget,
  payload: BulkPayload,
  configStore: ConfigStore,
  auditStore: AuditStore,
  runner: KubectlRunner,
): Promise<BulkTargetResult[]> {
  const planned: PlannedTarget[] = payload.targets.map((entry) => {
    const target = { clusterId: route.clusterId, resource: route.resource, namespace: entry.namespace, name: entry.name };
    return { target, plan: buildResourceActionPlan(target, payload.action, undefined, undefined, entry.labels) };
  });

  const results = new Map<string, BulkTargetResult>();
  const succeed = (target: ResourceActionRouteTarget) => results.set(targetKey(target), { namespace: target.namespace, name: target.name, ok: true });
  const fail = (target: ResourceActionRouteTarget, error: ErrorInfo) => results.set(targetKey(target), { namespace: target.namespace, name: target.name, ok: false, error });

  // Every distinct permission is asked once; an object waits only on the
  // answers its own action needs.
  const denied = new Map<string, ErrorInfo>();
  const checks = new Map<string, AuthorizationCheck>();
  for (const { plan } of planned) for (const check of plan.authorizationChecks) checks.set(authorizationKey(check), check);
  for (const [key, check] of checks) {
    try {
      await verifyAuthorization(configStore, runner, route.clusterId, check);
    } catch (error) {
      denied.set(key, errorInfoOf(error, "Authorization check failed"));
    }
  }
  const allowed = planned.filter(({ target, plan }) => {
    const refusal = plan.authorizationChecks.map((check) => denied.get(authorizationKey(check))).find(Boolean);
    if (refusal) fail(target, refusal);
    return !refusal;
  });

  const record = ({ target, plan }: PlannedTarget, commandPreview: string, error?: ErrorInfo) => {
    if (error) {
      appendActionAudit(auditStore, target, plan, { status: "failed", commandPreview, message: error.message });
      fail(target, error);
    } else {
      appendActionAudit(auditStore, target, plan, { status: "success", commandPreview });
      succeed(target);
    }
  };

  const runOne = async (entry: PlannedTarget): Promise<void> => {
    try {
      const result = await runner.run(clusterCommand(configStore, route.clusterId, entry.plan.args, entry.plan.timeoutSeconds, entry.plan.maxOutputBytes));
      record(entry, result.commandPreview);
    } catch (error) {
      const info = errorInfoOf(error, `${entry.plan.action} failed`);
      record(entry, info.commandPreview, info);
    }
  };

  // One command that names every entry. Returns the entries to try again: a
  // cordon looks every node up before it changes any, so one missing node stops
  // the rest, and only the nodes kubectl named as the reason are failed for it.
  const runNamed = async (entries: PlannedTarget[], args: string[], retryUnnamed: boolean): Promise<PlannedTarget[]> => {
    try {
      const result = await runner.run(clusterCommand(configStore, route.clusterId, args, NAMED_TIMEOUT_SECONDS, NAMED_MAX_OUTPUT_BYTES));
      for (const entry of entries) record(entry, result.commandPreview);
      return [];
    } catch (error) {
      const info = errorInfoOf(error, "kubectl command failed");
      const changed = error instanceof KubectlError ? changedNames(error.stdout) : new Set<string>();
      const stoppedEarly = retryUnnamed && changed.size === 0 && entries.some((entry) => stderrLineFor(entry.target.name, info));
      const again: PlannedTarget[] = [];
      for (const entry of entries) {
        if (changed.has(entry.target.name)) record(entry, info.commandPreview);
        else if (stoppedEarly && !stderrLineFor(entry.target.name, info)) again.push(entry);
        else record(entry, info.commandPreview, failureFor(entry.target.name, info));
      }
      return again;
    }
  };

  const chunked = (entries: PlannedTarget[]) => {
    const chunks = chunkNames(entries.map((entry) => entry.target.name));
    return chunks.map((names) => entries.filter((entry) => names.includes(entry.target.name)));
  };
  const namesOf = (entries: PlannedTarget[]) => entries.map((entry) => entry.target.name);

  // Every selected node in one command, so no node is left schedulable while
  // the others are already closed.
  const cordonAll = async (entries: PlannedTarget[], verb: "cordon" | "uncordon") => {
    await Promise.all(
      chunked(entries).map(async (chunk) => {
        const again = await runNamed(chunk, [verb, ...namesOf(chunk)], true);
        if (again.length) await runNamed(again, [verb, ...namesOf(again)], false);
      }),
    );
  };

  if (payload.action === "delete") {
    const byNamespace = new Map<string, PlannedTarget[]>();
    for (const entry of allowed) byNamespace.set(entry.target.namespace, [...(byNamespace.get(entry.target.namespace) ?? []), entry]);
    const groups = [...byNamespace.entries()].flatMap(([namespace, entries]) => chunked(entries).map((chunk) => ({ namespace, chunk })));
    await mapWithConcurrency(groups, BULK_CONCURRENCY, ({ namespace, chunk }) => runNamed(chunk, [...deleteArgs(route.resource, namesOf(chunk), namespace), "-o", "name"], false));
  } else if (payload.action === "cordon" || payload.action === "uncordon") {
    await cordonAll(allowed, payload.action);
  } else if (payload.action === "drain") {
    // Every node is cordoned before the first one is drained, so a pod evicted
    // from one node cannot land on another that is waiting for its own drain.
    // The drains then run five at a time; a node that could not be cordoned is
    // not drained.
    await cordonAll(
      allowed.map((entry) => ({ target: entry.target, plan: buildResourceActionPlan(entry.target, "cordon") })),
      "cordon",
    );
    const cordoned = allowed.filter((entry) => results.get(targetKey(entry.target))?.ok);
    await mapWithConcurrency(cordoned, BULK_CONCURRENCY, runOne);
  } else {
    await mapWithConcurrency(allowed, BULK_CONCURRENCY, runOne);
  }

  return planned.map(({ target }) => results.get(targetKey(target)) ?? { namespace: target.namespace, name: target.name, ok: false, error: errorInfoOf(null, "Not run") });
}

export function handleBulkResourceActionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  auditStore: AuditStore,
  runner: KubectlRunner,
  log: (message: string) => void,
  invalidateResourceCache: CacheInvalidator = async () => {},
): boolean {
  let route: BulkActionRouteTarget | null;
  try {
    route = matchBulkResourceActionRoute(request.method, pathname);
  } catch (error) {
    writeRouteError(response, error, log, { label: "bulk resource action", fallbackCode: "RESOURCE_ACTION_FAILED", fallbackMessage: "Unable to perform bulk resource action" });
    return true;
  }
  if (!route) return false;
  const target = route;

  void (async () => {
    const payload = parseBulkPayload(await readJsonBody(request, BULK_REQUEST_MAX_BYTES), target);
    const results = await executeBulkResourceAction(target, payload, configStore, auditStore, runner);
    if (results.some((result) => result.ok)) {
      try {
        await invalidateResourceCache(target.clusterId);
      } catch (error) {
        log(`gateway bulk resource action cache invalidation failed cluster=${target.clusterId}: ${String(error)}`);
      }
    }
    writeJson(response, { results });
  })().catch((error) => writeRouteError(response, error, log, { label: "bulk resource action", fallbackCode: "RESOURCE_ACTION_FAILED", fallbackMessage: "Unable to perform bulk resource action" }));

  return true;
}
