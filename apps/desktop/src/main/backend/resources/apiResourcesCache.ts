import type { ConfigStore } from "../config/configStore";
import { clusterCommand } from "../kubectl/clusterCommand";
import type { KubectlRunner } from "../kubectl/runner";

const API_RESOURCES_CACHE_TTL_MS = 60_000;
const API_RESOURCES_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const API_RESOURCES_TIMEOUT_SECONDS = 30;

interface ApiResourcesCacheEntry {
  expiresAt: number;
  stdout: string;
}

const cache = new Map<string, ApiResourcesCacheEntry>();

export interface ApiResourcesOutput {
  stdout: string;
  cached: boolean;
}

// Returns raw stdout, not parsed definitions: callers parse apiGroup differently from each other.
export async function getApiResourcesOutput(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, now: () => number = Date.now): Promise<ApiResourcesOutput> {
  const existing = cache.get(clusterId);
  if (existing && existing.expiresAt > now()) {
    return { stdout: existing.stdout, cached: true };
  }

  const result = await runner.run(clusterCommand(configStore, clusterId, ["api-resources", "--verbs=list", "-o", "wide"], API_RESOURCES_TIMEOUT_SECONDS, API_RESOURCES_MAX_OUTPUT_BYTES));
  cache.set(clusterId, { expiresAt: now() + API_RESOURCES_CACHE_TTL_MS, stdout: result.stdout });
  return { stdout: result.stdout, cached: false };
}

export function clearApiResourcesCache(clusterId?: string): void {
  if (clusterId) {
    cache.delete(clusterId);
  } else {
    cache.clear();
  }
}
