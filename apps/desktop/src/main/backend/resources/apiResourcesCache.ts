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
// Discovery that is already running, shared by everyone who asks for the same
// cluster meanwhile. Only finished output used to be kept, so a search typed
// quickly against a cold cache started one `kubectl api-resources` per
// keystroke.
const inFlight = new Map<string, Promise<string>>();

export interface ApiResourcesOutput {
  stdout: string;
  cached: boolean;
}

export class ApiResourcesWaitAbandoned extends Error {
  constructor(readonly reason: "aborted" | "timeout") {
    super(reason === "aborted" ? "api-resources wait was cancelled" : "api-resources discovery did not finish in time");
    this.name = reason === "aborted" ? "AbortError" : "ApiResourcesTimeout";
  }
}

function sharedDiscovery(configStore: ConfigStore, runner: KubectlRunner, clusterId: string, now: () => number): Promise<string> {
  const running = inFlight.get(clusterId);
  if (running) return running;
  const discovery = runner
    .run(clusterCommand(configStore, clusterId, ["api-resources", "--verbs=list", "-o", "wide"], API_RESOURCES_TIMEOUT_SECONDS, API_RESOURCES_MAX_OUTPUT_BYTES))
    .then((result) => {
      // A cache cleared while this ran (cluster edited or removed) must not
      // be refilled with output from before the change.
      if (inFlight.get(clusterId) === discovery) cache.set(clusterId, { expiresAt: now() + API_RESOURCES_CACHE_TTL_MS, stdout: result.stdout });
      return result.stdout;
    })
    .finally(() => {
      if (inFlight.get(clusterId) === discovery) inFlight.delete(clusterId);
    });
  inFlight.set(clusterId, discovery);
  return discovery;
}

// Returns raw stdout, not parsed definitions: callers parse apiGroup differently from each other.
//
// `signal` and `timeoutMs` bound how long this caller waits, not the shared
// discovery: somebody else may still want its result, and a finished one fills
// the cache for the next call.
export async function getApiResourcesOutput(
  configStore: ConfigStore,
  runner: KubectlRunner,
  clusterId: string,
  now: () => number = Date.now,
  wait: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ApiResourcesOutput> {
  const { signal, timeoutMs } = wait;
  // Check before starting shared work or returning a cached result. A caller
  // already gone must neither spawn a process nor leave its rejection unobserved.
  if (signal?.aborted) throw new ApiResourcesWaitAbandoned("aborted");
  const existing = cache.get(clusterId);
  if (existing && existing.expiresAt > now()) {
    return { stdout: existing.stdout, cached: true };
  }

  const discovery = sharedDiscovery(configStore, runner, clusterId, now);
  if (!signal && timeoutMs === undefined) return { stdout: await discovery, cached: false };

  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const abandoned = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new ApiResourcesWaitAbandoned("aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => reject(new ApiResourcesWaitAbandoned("timeout")), Math.max(0, timeoutMs));
      timer.unref?.();
    }
  });
  try {
    return { stdout: await Promise.race([discovery, abandoned]), cached: false };
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

export function clearApiResourcesCache(clusterId?: string): void {
  if (clusterId) {
    cache.delete(clusterId);
    inFlight.delete(clusterId);
  } else {
    cache.clear();
    inFlight.clear();
  }
}
