import type { IncomingMessage, ServerResponse } from "node:http";
import { type ConfigStore } from "../config/configStore";
import { writeJson } from "../http";
import type { UsageHistorySampler } from "../resources/usageHistorySampler";
import { decodePathPart, validateIdentifier } from "../validation";
import { writeRouteError } from "./routeErrors";

interface PodUsageTarget {
  clusterId: string;
  namespace: string;
}

export function matchPodUsageRoute(method: string | undefined, pathname: string, requestUrl: string | undefined): PodUsageTarget | null {
  if (method !== "GET") return null;
  const match = pathname.match(/^\/clusters\/([^/]+)\/pod-usage$/);
  if (!match) return null;

  const url = new URL(requestUrl ?? pathname, "http://127.0.0.1");
  const rawNamespace = url.searchParams.get("namespace")?.trim() || "all";

  return {
    clusterId: validateIdentifier(decodePathPart(match[1], "cluster_id"), "cluster_id", 128),
    namespace: rawNamespace === "all" ? rawNamespace : validateIdentifier(rawNamespace, "namespace"),
  };
}

// The resource list carries usage taken at the moment it was loaded, and a
// table driven by watch events is not reloaded while nothing about the pods
// changes - so a pod metrics-server started reporting after that load keeps
// showing no usage. This route refreshes just those numbers from the samples
// KubeDeck already recorded, so it costs no kubectl call at all.
export function handlePodUsageRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  usageHistory: UsageHistorySampler,
  log: (message: string) => void,
): boolean {
  let target: PodUsageTarget | null;
  try {
    target = matchPodUsageRoute(request.method, pathname, request.url);
    if (!target) return false;
    configStore.getCluster(target.clusterId);
    writeJson(response, { items: usageHistory.currentUsage(target.clusterId, target.namespace) });
    return true;
  } catch (error) {
    writeRouteError(response, error, log, { label: "pod usage", fallbackCode: "POD_USAGE_FAILED", fallbackMessage: "Unable to read recorded pod usage" });
    return true;
  }
}
