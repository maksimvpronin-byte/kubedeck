// Overview and Problems both answer by walking the cluster: nine and five
// cluster-wide `kubectl get` calls, and five of the kinds are the same in both.
// Switching between the two panels, or pressing Refresh twice, used to repeat
// every one of those calls.
//
// This holds what kubectl answered for one list, briefly. The window is
// deliberately far below the shortest auto-refresh interval (10s): the point is
// to collapse readers that arrive within a moment of each other, never to make a
// panel show data older than its own refresh promises.
const AGGREGATE_SOURCE_TTL_MS = 5_000;

interface CacheEntry {
  clusterId: string;
  expiresAt: number;
  items: unknown[];
}

const entries = new Map<string, CacheEntry>();
// Bumped by every clear, so a load that started before a mutation or a
// kubeconfig change cannot store its now-stale answer after the clear.
let generation = 0;

function cacheKey(clusterId: string, resource: string, namespace: string): string {
  return `${clusterId}\u0000${namespace}\u0000${resource.toLowerCase()}`;
}

function sweep(now: number): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
}

// The items are handed out as they were parsed, so a caller must treat them as
// read-only - both routes normalize into fresh rows and never write back into
// the raw objects.
export async function loadAggregateSource(clusterId: string, resource: string, namespace: string, load: () => Promise<unknown[]>, now: () => number = Date.now): Promise<unknown[]> {
  const key = cacheKey(clusterId, resource, namespace);
  const entry = entries.get(key);
  if (entry && entry.expiresAt > now()) return entry.items;

  // In-flight requests are deliberately NOT shared: each one carries the abort
  // signal of the client that asked for it, and a joined reader would inherit
  // the cancellation of a request that has nothing to do with it.
  const startedIn = generation;
  const items = await load();
  if (startedIn !== generation) return items;
  const timestamp = now();
  sweep(timestamp);
  entries.set(key, { clusterId, expiresAt: timestamp + AGGREGATE_SOURCE_TTL_MS, items });
  return items;
}

export function clearAggregateSourceCache(clusterId?: string): void {
  generation += 1;
  if (!clusterId) {
    entries.clear();
    return;
  }
  for (const [key, entry] of entries) {
    if (entry.clusterId === clusterId) entries.delete(key);
  }
}
