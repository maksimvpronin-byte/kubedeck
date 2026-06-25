import type { IncomingMessage, ServerResponse } from "node:http";
import { ClusterNotFoundError, type ConfigStore } from "../config/configStore";
import { writeError } from "../errors";
import { writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError, writeKubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import { RequestValidationError, validateIdentifier } from "../validation";

const DISCOVERY_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const EVENTS_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const RESOURCE_DEFINITION_CACHE_TTL_MS = 60_000;
const MAX_RETURNED_EVENTS = 200;

type JsonObject = Record<string, unknown>;

export interface ResourceDefinition {
  name: string;
  shortNames: string;
  apiGroup: string;
  namespaced: boolean;
  kind: string;
  verbs: string;
}

export interface ResourceEventTarget {
  clusterId: string;
  resource: string;
  namespace: string;
  name: string;
}

interface DiscoveryCacheEntry {
  expiresAt: number;
  items: ResourceDefinition[];
}

const discoveryCache = new Map<string, DiscoveryCacheEntry>();

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asObjectArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
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

function validateClusterExists(configStore: ConfigStore, clusterId: string): void {
  const config = configStore.load();
  configStore.getCluster(clusterId, config);
}

export function parseApiResources(output: string): ResourceDefinition[] {
  const lines = output.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length <= 1) return [];

  const items: ResourceDefinition[] = [];

  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;

    const namespacedIndex = parts.findIndex((part) =>
      part === "true" || part === "false");

    if (namespacedIndex < 0 || namespacedIndex + 2 >= parts.length) continue;

    const name = parts[0];
    const shortNames = namespacedIndex > 2 ? parts[1] : "";
    const apiGroup = parts[namespacedIndex - 1] ?? "";
    const namespaced = parts[namespacedIndex] === "true";
    const kind = parts[namespacedIndex + 1] ?? "";
    const verbs = parts.slice(namespacedIndex + 2).join(" ");

    items.push({
      name,
      shortNames,
      apiGroup,
      namespaced,
      kind,
      verbs,
    });
  }

  return items;
}

export function matchResourceEventsPath(pathname: string): ResourceEventTarget | null {
  const match = pathname.match(
    /^\/clusters\/([^/]+)\/resources\/([^/]+)\/([^/]+)\/([^/]+)\/events$/,
  );
  if (!match) return null;

  const namespaceRaw = decodePathPart(match[3], "namespace");

  return {
    clusterId: decodePathPart(match[1], "cluster_id"),
    resource: validateIdentifier(
      decodePathPart(match[2], "resource"),
      "resource",
      128,
    ).toLowerCase(),
    namespace: namespaceRaw === "_cluster"
      ? "_cluster"
      : validateIdentifier(namespaceRaw, "namespace"),
    name: validateIdentifier(decodePathPart(match[4], "name"), "name"),
  };
}

function singularKind(resource: string): string {
  let base = resource.split(".", 1)[0];

  if (base.endsWith("ies")) {
    base = `${base.slice(0, -3)}y`;
  } else if (base.endsWith("ses")) {
    base = base.slice(0, -2);
  } else if (base.endsWith("s")) {
    base = base.slice(0, -1);
  }

  return base
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function kindForResource(resource: string): string {
  const mapping: Record<string, string> = {
    pod: "Pod",
    pods: "Pod",
    deployment: "Deployment",
    deployments: "Deployment",
    "deployments.apps": "Deployment",
    statefulsets: "StatefulSet",
    daemonsets: "DaemonSet",
    replicasets: "ReplicaSet",
    jobs: "Job",
    cronjobs: "CronJob",
    service: "Service",
    services: "Service",
    ingress: "Ingress",
    ingresses: "Ingress",
    "ingresses.networking.k8s.io": "Ingress",
    endpoints: "Endpoints",
    endpointslices: "EndpointSlice",
    "endpointslices.discovery.k8s.io": "EndpointSlice",
    configmaps: "ConfigMap",
    secrets: "Secret",
    persistentvolumeclaims: "PersistentVolumeClaim",
    persistentvolumes: "PersistentVolume",
    storageclasses: "StorageClass",
    node: "Node",
    nodes: "Node",
    namespace: "Namespace",
    namespaces: "Namespace",
    serviceaccounts: "ServiceAccount",
    roles: "Role",
    rolebindings: "RoleBinding",
    clusterroles: "ClusterRole",
    clusterrolebindings: "ClusterRoleBinding",
  };

  return mapping[resource] ?? singularKind(resource);
}

function eventTimestamp(event: JsonObject): string {
  const metadata = asObject(event.metadata);

  return (
    asString(event.lastTimestamp) ||
    asString(event.eventTime) ||
    asString(event.firstTimestamp) ||
    asString(metadata.creationTimestamp)
  );
}

export function filterEventsForTarget(
  events: JsonObject[],
  target: ResourceEventTarget,
  targetRaw: JsonObject,
): JsonObject[] {
  const metadata = asObject(targetRaw.metadata);
  const targetUid = asString(metadata.uid);
  const targetKind = asString(targetRaw.kind) || kindForResource(target.resource);
  const targetNamespace =
    asString(metadata.namespace) ||
    (target.namespace === "_cluster" ? "" : target.namespace);

  const matched = events.filter((event) => {
    const involvedObject = asObject(event.involvedObject);
    const regarding = asObject(event.regarding);
    const involved = Object.keys(involvedObject).length > 0
      ? involvedObject
      : regarding;
    const eventName = asString(involved.name);
    const eventKind = asString(involved.kind);
    const eventUid = asString(involved.uid);
    const eventNamespace =
      asString(involved.namespace) ||
      asString(asObject(event.metadata).namespace);

    if (targetUid && eventUid && eventUid === targetUid) return true;
    if (eventName !== target.name) return false;
    if (targetKind && eventKind && eventKind !== targetKind) return false;
    if (
      targetNamespace &&
      eventNamespace &&
      eventNamespace !== targetNamespace
    ) return false;

    return true;
  });

  return matched.sort((left, right) =>
    eventTimestamp(right).localeCompare(eventTimestamp(left)));
}

export function summarizeEvent(event: JsonObject): JsonObject {
  const metadata = asObject(event.metadata);
  const involvedObject = asObject(event.involvedObject);
  const regarding = asObject(event.regarding);
  const involved = Object.keys(involvedObject).length > 0
    ? involvedObject
    : regarding;
  const series = asObject(event.series);
  const createdAt = eventTimestamp(event);

  const count = event.count || series.count || 1;
  const source = asObject(event.source);

  return {
    uid: asString(metadata.uid),
    name: asString(metadata.name),
    namespace: asString(metadata.namespace),
    createdAt,
    type: asString(event.type),
    reason: asString(event.reason),
    message: asString(event.message) || asString(event.note),
    object: `${asString(involved.kind)}/${asString(involved.name)}`,
    involvedKind: asString(involved.kind),
    involvedName: asString(involved.name),
    involvedNamespace:
      asString(involved.namespace) || asString(metadata.namespace),
    involvedApiVersion: asString(involved.apiVersion),
    count,
    source:
      asString(source.component) ||
      asString(event.reportingController) ||
      asString(event.reportingInstance),
    lastTimestamp: createdAt,
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
    `gateway resource discovery/events failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  writeError(
    response,
    500,
    "RESOURCE_DISCOVERY_EVENTS_FAILED",
    "Unable to load resource discovery or events",
  );
}

async function writeResourceDefinitions(
  response: ServerResponse,
  clusterId: string,
  configStore: ConfigStore,
  runner: KubectlRunner,
): Promise<void> {
  validateClusterExists(configStore, clusterId);

  const cached = discoveryCache.get(clusterId);
  if (cached && cached.expiresAt > Date.now()) {
    writeJson(response, { items: cached.items, cached: true });
    return;
  }

  const result = await runner.run(clusterCommand(
    configStore,
    clusterId,
    ["api-resources", "--verbs=list", "-o", "wide"],
    30,
    DISCOVERY_MAX_OUTPUT_BYTES,
  ));
  const items = parseApiResources(result.stdout);

  discoveryCache.set(clusterId, {
    expiresAt: Date.now() + RESOURCE_DEFINITION_CACHE_TTL_MS,
    items,
  });

  writeJson(response, { items, cached: false });
}

async function writeResourceEvents(
  response: ServerResponse,
  target: ResourceEventTarget,
  configStore: ConfigStore,
  runner: KubectlRunner,
): Promise<void> {
  const targetArgs = ["get", target.resource, target.name];

  if (target.namespace !== "_cluster") {
    targetArgs.push("-n", target.namespace);
  }
  targetArgs.push("-o", "json");

  const targetRaw = await runner.runJson(clusterCommand(
    configStore,
    target.clusterId,
    targetArgs,
    30,
    EVENTS_MAX_OUTPUT_BYTES,
  ));

  const eventsArgs = ["get", "events"];

  if (target.namespace === "_cluster") {
    eventsArgs.push("-A");
  } else {
    eventsArgs.push("-n", target.namespace);
  }
  eventsArgs.push("-o", "json");

  const eventList = await runner.runJson(clusterCommand(
    configStore,
    target.clusterId,
    eventsArgs,
    30,
    EVENTS_MAX_OUTPUT_BYTES,
  ));

  const events = asObjectArray(eventList.items);
  const filtered = filterEventsForTarget(events, target, targetRaw);

  writeJson(response, {
    items: filtered.slice(0, MAX_RETURNED_EVENTS).map(summarizeEvent),
    rawCount: filtered.length,
  });
}

export function clearResourceDefinitionCache(clusterId?: string): void {
  if (clusterId) {
    discoveryCache.delete(clusterId);
  } else {
    discoveryCache.clear();
  }
}

export function handleResourceDiscoveryEventsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  runner: KubectlRunner,
  log: (message: string) => void,
): boolean {
  if (request.method !== "GET") return false;

  const definitionsMatch = pathname.match(
    /^\/clusters\/([^/]+)\/resource-definitions$/,
  );

  if (definitionsMatch) {
    let clusterId: string;
    try {
      clusterId = decodePathPart(definitionsMatch[1], "cluster_id");
    } catch (error) {
      writeRouteError(response, error, log);
      return true;
    }

    void writeResourceDefinitions(response, clusterId, configStore, runner)
      .catch((error) => writeRouteError(response, error, log));
    return true;
  }

  let target: ResourceEventTarget | null;

  try {
    target = matchResourceEventsPath(pathname);
  } catch (error) {
    writeRouteError(response, error, log);
    return true;
  }

  if (!target) return false;

  void writeResourceEvents(response, target, configStore, runner)
    .catch((error) => writeRouteError(response, error, log));
  return true;
}
