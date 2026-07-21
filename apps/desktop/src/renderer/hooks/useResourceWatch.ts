import { useEffect, useRef } from "react";
import type { ApiClient } from "../api";

interface UseResourceWatchOptions {
  api: ApiClient | null;
  clusterId?: string;
  resource: string;
  namespaces: string[];
  clusterScoped: boolean;
  enabled: boolean;
  refresh: (clusterId: string, resource: string, namespaces: string[], silent: boolean) => Promise<unknown>;
}

interface WatchReconnectController {
  connectionStarted(): number;
  connectionClosed(generation: number, reconnect: () => void): void;
  stop(): void;
}

export function createWatchReconnectController(schedule: (callback: () => void, delayMs: number) => number, cancel: (timer: number) => void, delayMs = 1000): WatchReconnectController {
  let stopped = false;
  let generation = 0;
  let pendingTimer: number | null = null;
  return {
    connectionStarted() {
      generation += 1;
      return generation;
    },
    connectionClosed(candidate, reconnect) {
      if (stopped || candidate !== generation || pendingTimer !== null) return;
      pendingTimer = schedule(() => {
        pendingTimer = null;
        if (!stopped) reconnect();
      }, delayMs);
    },
    stop() {
      stopped = true;
      generation += 1;
      if (pendingTimer !== null) cancel(pendingTimer);
      pendingTimer = null;
    },
  };
}

export function useResourceWatch({ api, clusterId, resource, namespaces, clusterScoped, enabled, refresh }: UseResourceWatchOptions) {
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!api || !clusterId || !enabled || resource === "port-forwards") return undefined;
    const watchNamespace = clusterScoped ? "_cluster" : namespaces.length === 1 ? namespaces[0] : "all";
    let socket: WebSocket | null = null;
    let closed = false;

    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        if (!closed) void refresh(clusterId, resource, namespaces, true);
      }, 350);
    };

    void api.startWatch(clusterId, resource, watchNamespace).catch(() => undefined);

    const reconnectController = createWatchReconnectController(window.setTimeout, window.clearTimeout);
    const connectSocket = () => {
      if (closed) return;
      try {
        const nextSocket = new WebSocket(api.resourceWatchEventsUrl(clusterId, resource, watchNamespace));
        socket = nextSocket;
        const generation = reconnectController.connectionStarted();
        nextSocket.onmessage = (event) => {
          const payload = api.parseResourceWatchEvent(String(event.data ?? ""));
          if (payload?.type === "resource.changed") scheduleRefresh();
        };
        nextSocket.onerror = () => undefined;
        nextSocket.onclose = () => {
          if (socket === nextSocket) socket = null;
          reconnectController.connectionClosed(generation, connectSocket);
        };
      } catch {
        const generation = reconnectController.connectionStarted();
        reconnectController.connectionClosed(generation, connectSocket);
      }
    };
    connectSocket();

    return () => {
      closed = true;
      reconnectController.stop();
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
    };
  }, [api, clusterId, resource, namespaces, clusterScoped, enabled, refresh]);
}
