// Where the API server lists a resource named `<plural>.<group>` - a custom
// resource, or a built-in one spelled with its group - for `kubectl get --raw`.
//
// `kubectl get applications.argoproj.io -o json` goes through discovery and
// then re-encodes and pretty-prints every object. Argo CD Applications carry
// their whole resource tree and sync history in `status`, so a few hundred of
// them made the table give up after 30 seconds where the same list read raw
// takes a fraction of that.
//
// The served version and scope come from two small discovery reads of that one
// group, kept for a while per cluster, instead of a full `api-resources`. When
// they fail, the caller lists through `kubectl get` the way it always did.

import type { ConfigStore } from "../config/configStore";
import { clusterCommand } from "../kubectl/clusterCommand";
import type { KubectlRunner } from "../kubectl/runner";

const ENDPOINT_CACHE_TTL_MS = 10 * 60_000;
const DISCOVERY_TIMEOUT_SECONDS = 15;
const DISCOVERY_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface CustomListEndpoint {
  // "/apis/<group>/<version>"
  prefix: string;
  plural: string;
  namespaced: boolean;
}

interface CacheEntry {
  expiresAt: number;
  endpoint: CustomListEndpoint | null;
}

const cache = new Map<string, CacheEntry>();

const GROUP_RESOURCE = /^([a-z0-9]([-a-z0-9]*[a-z0-9])?)\.([a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)+)$/;

// `applications.argoproj.io` -> plural and group, or null for anything that is
// not spelled that way (a bare plural, a short name, a Kind).
export function splitGroupResource(resource: string): { plural: string; group: string } | null {
  const match = GROUP_RESOURCE.exec(resource);
  return match ? { plural: match[1], group: match[3] } : null;
}

function cacheKey(clusterId: string, resource: string): string {
  return `${clusterId}\u0000${resource}`;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The list path, or null when it cannot be known from the endpoint alone and
// kubectl has to resolve it: a namespaced type with no namespace means the
// kubeconfig context's default.
export function customListPath(endpoint: CustomListEndpoint, namespace: string): string | null {
  if (!endpoint.namespaced || namespace === "all") return `${endpoint.prefix}/${endpoint.plural}`;
  if (namespace === "_cluster" || !namespace) return null;
  return `${endpoint.prefix}/namespaces/${encodeURIComponent(namespace)}/${endpoint.plural}`;
}

async function discoverEndpoint(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, plural: string, group: string, signal?: AbortSignal): Promise<CustomListEndpoint | null> {
  const read = (path: string) => runner.runJson(clusterCommand(configStore, clusterId, ["get", "--raw", path], DISCOVERY_TIMEOUT_SECONDS, DISCOVERY_MAX_OUTPUT_BYTES), signal);
  const apiGroup = await read(`/apis/${group}`);
  const preferred = apiGroup.preferredVersion as Record<string, unknown> | undefined;
  const version = readString(preferred?.version);
  if (!version) return null;
  const resources = (await read(`/apis/${group}/${version}`)).resources;
  if (!Array.isArray(resources)) return null;
  const found = resources.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).name === plural) as Record<string, unknown> | undefined;
  if (!found) return null;
  const verbs = Array.isArray(found.verbs) ? found.verbs : [];
  if (!verbs.includes("list")) return null;
  return { prefix: `/apis/${group}/${version}`, plural, namespaced: found.namespaced === true };
}

export async function resolveCustomListEndpoint(
  configStore: ConfigStore,
  runner: KubectlRunner,
  clusterId: string,
  resource: string,
  signal?: AbortSignal,
  now: () => number = Date.now,
): Promise<CustomListEndpoint | null> {
  const parts = splitGroupResource(resource);
  if (!parts) return null;
  const key = cacheKey(clusterId, resource);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now()) return cached.endpoint;
  const endpoint = await discoverEndpoint(configStore, runner, clusterId, parts.plural, parts.group, signal);
  cache.set(key, { expiresAt: now() + ENDPOINT_CACHE_TTL_MS, endpoint });
  return endpoint;
}

// Called when a raw list at the resolved path was not found: the CRD changed
// its served version, or was removed.
export function forgetCustomListEndpoint(clusterId: string, resource: string): void {
  cache.delete(cacheKey(clusterId, resource));
}

export function clearCustomListEndpoints(clusterId?: string): void {
  if (!clusterId) {
    cache.clear();
    return;
  }
  const prefix = `${clusterId}\u0000`;
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}
