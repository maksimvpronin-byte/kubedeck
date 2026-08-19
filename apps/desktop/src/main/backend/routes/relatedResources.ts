import type { IncomingMessage, ServerResponse } from "node:http";
import { type ConfigStore } from "../config/configStore";
import { writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import type { KubectlRunner } from "../kubectl/runner";
import { buildRelatedResources, type RelatedLink } from "../relations/relatedResourcesEngine";
import { getApiResourcesOutput } from "../resources/apiResourcesCache";
// The search parser splits the API version into a bare group, which is the form
// kubectl accepts as "<plural>.<group>".
import { parseApiResources } from "../search/searchEngine";
import { decodePathPart, validateIdentifier } from "../validation";
import { writeRouteError } from "./routeErrors";

const TARGET_TIMEOUT_SECONDS = 30;
const SOURCE_TIMEOUT_SECONDS = 25;
const TARGET_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const SOURCE_MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const MAX_RELATED_ITEMS = 200;

const CLUSTER_SCOPED_RESOURCES = new Set([
  "namespaces",
  "namespace",
  "nodes",
  "node",
  "persistentvolumes",
  "persistentvolume",
  "pv",
  "storageclasses",
  "storageclass",
  "clusterroles",
  "clusterrole",
  "clusterrolebindings",
  "clusterrolebinding",
  "customresourcedefinitions",
  "customresourcedefinitions.apiextensions.k8s.io",
]);

interface RelatedTarget {
  clusterId: string;
  resource: string;
  namespace: string;
  name: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asItems(value: unknown): Array<Record<string, unknown>> {
  const items = asRecord(value).items;
  return Array.isArray(items) ? items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

export function matchRelatedResourcesRoute(method: string | undefined, pathname: string): RelatedTarget | null {
  if (method !== "GET") return null;
  const match = pathname.match(/^\/clusters\/([^/]+)\/resources\/([^/]+)\/([^/]+)\/([^/]+)\/related$/);
  if (!match) return null;
  const namespace = decodePathPart(match[3], "namespace");
  return {
    clusterId: validateIdentifier(decodePathPart(match[1], "cluster_id"), "cluster_id", 128),
    resource: validateIdentifier(decodePathPart(match[2], "resource"), "resource", 128).toLocaleLowerCase(),
    namespace: namespace === "_cluster" ? namespace : validateIdentifier(namespace, "namespace"),
    name: validateIdentifier(decodePathPart(match[4], "name"), "name"),
  };
}

interface ResourceCatalog {
  available: string[];
  clusterScoped: Set<string>;
}

const EMPTY_CATALOG: ResourceCatalog = { available: [], clusterScoped: new Set() };

// Discovery tells the engine which route CRDs exist and which of them are
// cluster scoped. A cluster that cannot be discovered still works: it just
// falls back to the built-in resources.
async function loadResourceCatalog(configStore: ConfigStore, runner: KubectlRunner, clusterId: string): Promise<ResourceCatalog> {
  try {
    const { stdout } = await getApiResourcesOutput(configStore, runner, clusterId);
    const available: string[] = [];
    const clusterScoped = new Set<string>();
    for (const definition of parseApiResources(stdout)) {
      const qualified = definition.apiGroup ? `${definition.name}.${definition.apiGroup}` : definition.name;
      available.push(qualified);
      if (!definition.namespaced) {
        clusterScoped.add(qualified);
        clusterScoped.add(definition.name);
      }
    }
    return { available, clusterScoped };
  } catch {
    return EMPTY_CATALOG;
  }
}

function isClusterScoped(resource: string, catalog: ResourceCatalog): boolean {
  return CLUSTER_SCOPED_RESOURCES.has(resource) || catalog.clusterScoped.has(resource);
}

function targetArgs(target: RelatedTarget, catalog: ResourceCatalog): string[] {
  const args = ["get", target.resource, target.name];
  if (target.namespace !== "_cluster" && !isClusterScoped(target.resource, catalog)) {
    args.push("-n", target.namespace);
  }
  args.push("-o", "json");
  return args;
}

function sourceArgs(resource: string, namespace: string, catalog: ResourceCatalog): string[] {
  const args = ["get", resource];
  if (!isClusterScoped(resource, catalog)) {
    if (namespace === "all") args.push("-A");
    else if (namespace && namespace !== "_cluster") args.push("-n", namespace);
  }
  args.push("-o", "json");
  return args;
}

export async function buildRelatedResourcesResponse(
  configStore: ConfigStore,
  runner: KubectlRunner,
  target: RelatedTarget,
): Promise<{
  items: RelatedLink[];
  sources: Record<string, number>;
  errors: Array<Record<string, unknown>>;
}> {
  const config = configStore.load();
  configStore.getCluster(target.clusterId, config);
  // The caller already resolves cluster-scoped resources to namespace "_cluster"
  // before requesting related resources (it has its own discovery), so the
  // target fetch never actually depends on this route's own catalog lookup in
  // practice; building its args from the static set lets it run alongside the
  // catalog fetch instead of waiting on it.
  const [catalog, targetRaw] = await Promise.all([
    loadResourceCatalog(configStore, runner, target.clusterId),
    runner.runJson(clusterCommand(configStore, target.clusterId, targetArgs(target, EMPTY_CATALOG), TARGET_TIMEOUT_SECONDS, TARGET_MAX_OUTPUT_BYTES)).then(asRecord),
  ]);
  const result = await buildRelatedResources({
    resource: target.resource,
    namespace: target.namespace,
    targetRaw,
    availableResources: catalog.available,
    loadItems: async (resource, namespace) => {
      const data = await runner.runJson(clusterCommand(configStore, target.clusterId, sourceArgs(resource, namespace, catalog), SOURCE_TIMEOUT_SECONDS, SOURCE_MAX_OUTPUT_BYTES));
      return asItems(data);
    },
  });
  return {
    items: result.items.slice(0, MAX_RELATED_ITEMS),
    sources: result.sources,
    errors: result.errors,
  };
}

export function handleRelatedResourcesRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  runner: KubectlRunner,
  log: (message: string) => void,
): boolean {
  try {
    const target = matchRelatedResourcesRoute(request.method, pathname);
    if (!target) return false;
    void buildRelatedResourcesResponse(configStore, runner, target)
      .then((body) => writeJson(response, body))
      .catch((error) =>
        writeRouteError(response, error, log, { label: "related resources", fallbackCode: "RELATED_RESOURCES_FAILED", fallbackMessage: "Unable to load related Kubernetes resources" }),
      );
    return true;
  } catch (error) {
    writeRouteError(response, error, log, { label: "related resources", fallbackCode: "RELATED_RESOURCES_FAILED", fallbackMessage: "Unable to load related Kubernetes resources" });
    return true;
  }
}
