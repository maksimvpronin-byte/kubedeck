import type { ResourceRow } from "../resources/normalizers";

export const RESOURCE_LIST_CACHE_TTL_SECONDS = 15;

export interface ResourceListResponse {
  items: ResourceRow[];
  rawCount: number;
  cached: boolean;
  cacheTtlSeconds: number;
  kind?: string;
}

interface CacheEntry {
  clusterId: string;
  resource: string;
  namespace: string;
  value: ResourceListResponse;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  hits: number;
}

interface Invalidation {
  reason: string;
  at: number;
  clusterId?: string;
  cleared: number;
}

function cacheKey(clusterId: string, resource: string, namespace: string): string {
  return `${clusterId}\u0000${namespace}\u0000${resource.toLowerCase()}`;
}

function cloneResponse(value: ResourceListResponse): ResourceListResponse {
  return {
    ...value,
    items: value.items.map((item) => structuredClone(item)),
  };
}

export class ResourceSnapshotCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly invalidations: Invalidation[] = [];

  constructor(
    private readonly ttlSeconds = RESOURCE_LIST_CACHE_TTL_SECONDS,
    private readonly now: () => number = Date.now,
  ) {}

  get(
    clusterId: string,
    resource: string,
    namespace: string,
  ): ResourceListResponse | null {
    const key = cacheKey(clusterId, resource, namespace);
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }

    entry.hits += 1;
    return {
      ...cloneResponse(entry.value),
      cached: true,
      cacheTtlSeconds: this.ttlSeconds,
    };
  }

  set(
    clusterId: string,
    resource: string,
    namespace: string,
    response: Omit<ResourceListResponse, "cached" | "cacheTtlSeconds"> &
      Partial<Pick<ResourceListResponse, "cached" | "cacheTtlSeconds">>,
  ): ResourceListResponse {
    const now = this.now();
    const value: ResourceListResponse = {
      ...response,
      items: response.items.map((item) => structuredClone(item)),
      rawCount: response.rawCount,
      cached: false,
      cacheTtlSeconds: this.ttlSeconds,
    };

    this.entries.set(cacheKey(clusterId, resource, namespace), {
      clusterId,
      resource: resource.toLowerCase(),
      namespace,
      value,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.ttlSeconds * 1000,
      hits: 0,
    });

    return cloneResponse(value);
  }

  clear(clusterId?: string, reason = "manual.clear"): number {
    let cleared = 0;

    for (const [key, entry] of this.entries) {
      if (!clusterId || entry.clusterId === clusterId) {
        this.entries.delete(key);
        cleared += 1;
      }
    }

    this.invalidations.push({
      reason,
      at: this.now() / 1000,
      ...(clusterId ? { clusterId } : {}),
      cleared,
    });
    if (this.invalidations.length > 50) {
      this.invalidations.splice(0, this.invalidations.length - 50);
    }

    return cleared;
  }

  status() {
    const now = this.now();
    const items = [];

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        continue;
      }

      items.push({
        clusterId: entry.clusterId,
        resource: entry.resource,
        namespace: entry.namespace,
        items: entry.value.items.length,
        rawCount: entry.value.rawCount,
        ageSeconds: Math.max(0, (now - entry.updatedAt) / 1000),
        ttlSeconds: this.ttlSeconds,
        hits: entry.hits,
      });
    }

    return {
      enabled: true,
      mode: "node-resource-list",
      entries: items.length,
      items,
      resourcePollingEnabled: true,
      discoveryCacheEnabled: true,
      resourceListCacheEnabled: true,
      resourceListTtlSeconds: this.ttlSeconds,
      lastInvalidations: this.invalidations.slice(-10),
      note:
        "Node resource-list snapshots use a 15-second read-through cache. " +
        "Cached reads verify cluster readiness before returning data.",
    };
  }
}
