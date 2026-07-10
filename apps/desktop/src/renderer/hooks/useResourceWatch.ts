import { useEffect, useRef } from "react";
import type { ApiClient } from "../api";

interface UseResourceWatchOptions {
  api: ApiClient | null;
  clusterId?: string;
  resource: string;
  namespaces: string[];
  clusterScoped: boolean;
  enabled: boolean;
  refresh: (clusterId: string, resource: string, namespaces: string[], silent: boolean) => Promise<void>;
}

export function useResourceWatch({ api, clusterId, resource, namespaces, clusterScoped, enabled, refresh }: UseResourceWatchOptions) {
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!api || !clusterId || !enabled || resource === "port-forwards") return undefined;
    const watchNamespace = clusterScoped ? "_cluster" : (namespaces.length === 1 ? namespaces[0] : "all");
    let socket: WebSocket | null = null;
    let autoStartedWatchId: string | null = null;
    let closed = false;

    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        if (!closed) void refresh(clusterId, resource, namespaces, true);
      }, 350);
    };

    void api.startWatch(clusterId, resource, watchNamespace)
      .then((watch) => {
        if (closed) {
          if (!watch.alreadyRunning) void api.stopWatch(watch.id).catch(() => undefined);
          return;
        }
        if (!watch.alreadyRunning) autoStartedWatchId = watch.id;
      })
      .catch(() => undefined);

    try {
      socket = new WebSocket(api.resourceWatchEventsUrl(clusterId, resource, watchNamespace));
      socket.onmessage = (event) => {
        const payload = api.parseResourceWatchEvent(String(event.data ?? ""));
        if (payload?.type === "resource.changed") scheduleRefresh();
      };
      socket.onerror = () => undefined;
    } catch {
      socket = null;
    }

    return () => {
      closed = true;
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
      if (autoStartedWatchId) void api.stopWatch(autoStartedWatchId).catch(() => undefined);
    };
  }, [api, clusterId, resource, namespaces, clusterScoped, enabled, refresh]);
}
