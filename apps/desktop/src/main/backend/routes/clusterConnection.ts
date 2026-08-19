import type { IncomingMessage, ServerResponse } from "node:http";
import type { ConfigStore } from "../config/configStore";
import { writeJson } from "../http";
import { decodePathPart, parseBooleanQuery, validateIdentifier } from "../validation";
import { writeRouteError } from "./routeErrors";

export interface ClusterLiveSessions {
  watches: number;
  portForwards: number;
  terminals: number;
  sshSessions: number;
}

interface DisconnectTarget {
  clusterId: string;
  force: boolean;
}

export function matchClusterDisconnectRoute(method: string | undefined, pathname: string, requestUrl: string | undefined): DisconnectTarget | null {
  if (method !== "POST") return null;
  const match = pathname.match(/^\/clusters\/([^/]+)\/disconnect$/);
  if (!match) return null;

  const url = new URL(requestUrl ?? pathname, "http://127.0.0.1");
  return {
    clusterId: validateIdentifier(decodePathPart(match[1], "cluster_id"), "cluster_id", 128),
    force: parseBooleanQuery(url.searchParams.get("force"), "force", false),
  };
}

// Watches are background work: any table being viewed has them, so counting
// them here would put a confirmation in front of every single disconnect. They
// are still reported, because seeing what stops is useful - they just do not
// stand in the way. What does are the sessions a person is holding open.
export function liveSessionTotal(sessions: ClusterLiveSessions): number {
  return sessions.portForwards + sessions.terminals + sessions.sshSessions;
}

// Disconnecting stops background polling, which nobody needs warning about, but
// it also tears down port-forwards, pod terminals and node SSH - connections
// someone may be actively using from another application. Those are only closed
// when the caller has seen what they are and said so, which is what `force`
// means here. The check and the teardown happen in one request so nothing can
// start in between.
export function handleClusterDisconnectRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  deps: {
    countSessions: (clusterId: string) => ClusterLiveSessions;
    release: (clusterId: string) => Promise<void>;
  },
  log: (message: string) => void,
): boolean {
  let target: DisconnectTarget | null;
  try {
    target = matchClusterDisconnectRoute(request.method, pathname, request.url);
    if (!target) return false;
    configStore.getCluster(target.clusterId);
  } catch (error) {
    writeRouteError(response, error, log, { label: "cluster disconnect", fallbackCode: "CLUSTER_DISCONNECT_FAILED", fallbackMessage: "Unable to disconnect cluster" });
    return true;
  }

  const clusterId = target.clusterId;
  const sessions = deps.countSessions(clusterId);

  if (!target.force && liveSessionTotal(sessions) > 0) {
    response.statusCode = 409;
    writeJson(response, {
      error: {
        code: "CLUSTER_HAS_LIVE_SESSIONS",
        message: "Disconnecting this cluster would close sessions that are still open.",
      },
      sessions,
    });
    return true;
  }

  deps
    .release(clusterId)
    .then(() => writeJson(response, { ok: true, clusterId, stopped: sessions }))
    .catch((error) => {
      writeRouteError(response, error, log, { label: "cluster disconnect", fallbackCode: "CLUSTER_DISCONNECT_FAILED", fallbackMessage: "Unable to disconnect cluster" });
    });
  return true;
}
