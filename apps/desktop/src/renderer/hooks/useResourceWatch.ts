import { useEffect, useState } from "react";
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

// A burst of events still has to settle before the list is reloaded, but the
// settle timer alone was both too eager and too patient. A cluster emitting an
// event every 300ms reset it forever, so the refresh never ran at all - and
// polling could not step in, because a live socket reports the watch as
// healthy. A cluster emitting one every 400ms got a full `kubectl get -o json`
// of every namespace at nearly that rate.
export const WATCH_REFRESH_DEBOUNCE_MS = 350;
// The floor: however fast events arrive, two list loads never run closer than
// this.
export const WATCH_REFRESH_MIN_INTERVAL_MS = 1000;
// The ceiling: however long events keep arriving, the table is never left
// unrefreshed for longer than this.
export const WATCH_REFRESH_MAX_WAIT_MS = 3000;

export interface WatchRefreshCoalescer {
  requestRefresh(): void;
  stop(): void;
}

export function createWatchRefreshCoalescer(
  run: () => void,
  schedule: (callback: () => void, delayMs: number) => number,
  cancel: (timer: number) => void,
  now: () => number,
  timings: { debounceMs?: number; minIntervalMs?: number; maxWaitMs?: number } = {},
): WatchRefreshCoalescer {
  const debounceMs = timings.debounceMs ?? WATCH_REFRESH_DEBOUNCE_MS;
  const minIntervalMs = timings.minIntervalMs ?? WATCH_REFRESH_MIN_INTERVAL_MS;
  const maxWaitMs = timings.maxWaitMs ?? WATCH_REFRESH_MAX_WAIT_MS;

  let timer: number | null = null;
  let burstStartedAt: number | null = null;
  let lastRunAt: number | null = null;
  let stopped = false;

  const fire = () => {
    timer = null;
    burstStartedAt = null;
    lastRunAt = now();
    run();
  };

  return {
    requestRefresh() {
      if (stopped) return;
      const current = now();
      if (burstStartedAt === null) burstStartedAt = current;
      const settle = current + debounceMs;
      const ceiling = burstStartedAt + maxWaitMs;
      const floor = lastRunAt === null ? 0 : lastRunAt + minIntervalMs;
      // The floor is applied last because it is the one constraint that must
      // hold: reaching the ceiling is a reason to stop waiting, never a reason
      // to reload twice inside the minimum interval.
      const at = Math.max(Math.min(settle, ceiling), floor);
      if (timer !== null) cancel(timer);
      timer = schedule(fire, Math.max(0, at - current));
    },
    stop() {
      stopped = true;
      if (timer !== null) cancel(timer);
      timer = null;
      burstStartedAt = null;
    },
  };
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

// How long to wait before starting a lost watch again, one step further on
// each failure in a row. A watch that is refused outright - no RBAC for
// `watch`, say - would otherwise spawn a kubectl every couple of seconds for
// as long as the table is open. Polling covers the table while it waits.
export const WATCH_RESTART_DELAYS_MS = [2000, 5000, 15_000, 30_000, 60_000];
// A watch that ran this long before it ended was working: its end is the API
// server closing a long watch, not a failure to back off from.
export const WATCH_STABLE_AFTER_MS = 60_000;

interface WatchRestartController {
  started(): void;
  lost(restart: () => void): void;
  stop(): void;
}

export function createWatchRestartController(
  schedule: (callback: () => void, delayMs: number) => number,
  cancel: (timer: number) => void,
  now: () => number,
  delaysMs: number[] = WATCH_RESTART_DELAYS_MS,
  stableAfterMs = WATCH_STABLE_AFTER_MS,
): WatchRestartController {
  let stopped = false;
  let failures = 0;
  let startedAt: number | null = null;
  let pendingTimer: number | null = null;
  return {
    started() {
      if (pendingTimer !== null) cancel(pendingTimer);
      pendingTimer = null;
      startedAt = now();
    },
    lost(restart) {
      if (stopped || pendingTimer !== null) return;
      if (startedAt !== null && now() - startedAt >= stableAfterMs) failures = 0;
      startedAt = null;
      const delay = delaysMs[Math.min(failures, delaysMs.length - 1)];
      failures += 1;
      pendingTimer = schedule(() => {
        pendingTimer = null;
        if (!stopped) restart();
      }, delay);
    },
    stop() {
      stopped = true;
      if (pendingTimer !== null) cancel(pendingTimer);
      pendingTimer = null;
    },
  };
}

export function useResourceWatch({ api, clusterId, resource, namespaces, clusterScoped, enabled, refresh }: UseResourceWatchOptions) {
  const [watchHealthy, setWatchHealthy] = useState(false);

  useEffect(() => {
    setWatchHealthy(false);
    if (!api || !clusterId || !enabled || resource === "port-forwards") return undefined;
    const watchNamespace = clusterScoped ? "_cluster" : namespaces.length === 1 ? namespaces[0] : "all";
    let socket: WebSocket | null = null;
    let closed = false;
    let backendReady = false;
    let socketReady = false;
    const updateHealth = () => {
      if (!closed) setWatchHealthy(backendReady && socketReady);
    };

    const coalescer = createWatchRefreshCoalescer(
      () => {
        if (!closed) void refresh(clusterId, resource, namespaces, true);
      },
      window.setTimeout,
      window.clearTimeout,
      Date.now,
    );

    // Healthy means a kubectl watch is running behind the socket, not only that
    // the socket is open. The watch is (re)started here, and asked for again
    // whenever the socket (re)opens: an end announced while no socket was
    // listening is otherwise never heard of. The backend shares one watch per
    // scope, so asking for a running one costs a request and starts nothing.
    const restarts = createWatchRestartController(window.setTimeout, window.clearTimeout, Date.now);
    let watchId: string | null = null;
    let starting = false;
    let verifyAfterStart = false;
    const endedDuringStart = new Set<string>();
    // The table missed whatever happened between losing the watch and getting
    // it back (it is `--watch-only`, so a new one does not replay the list).
    let reloadWhenBack = false;
    const ensureWatch = (verifySocket = false) => {
      if (closed) return;
      if (starting) {
        // A request begun before the socket opened can describe a watch whose
        // end had no subscriber. Confirm it once the socket is listening.
        if (verifySocket) verifyAfterStart = true;
        return;
      }
      starting = true;
      endedDuringStart.clear();
      void api
        .startWatch(clusterId, resource, watchNamespace)
        .then((started) => {
          starting = false;
          if (closed) return;
          if (started.status !== "running" || endedDuringStart.has(started.id)) {
            verifyAfterStart = false;
            watchLost();
            return;
          }
          if (verifyAfterStart) {
            verifyAfterStart = false;
            ensureWatch();
            return;
          }
          if (started.id !== watchId) restarts.started();
          watchId = started.id;
          backendReady = true;
          updateHealth();
          if (reloadWhenBack && socketReady) {
            reloadWhenBack = false;
            coalescer.requestRefresh();
          }
        })
        .catch(() => {
          starting = false;
          if (closed) return;
          verifyAfterStart = false;
          watchId = null;
          backendReady = false;
          updateHealth();
          restarts.lost(ensureWatch);
        });
    };
    const watchLost = () => {
      watchId = null;
      backendReady = false;
      reloadWhenBack = true;
      updateHealth();
      coalescer.requestRefresh();
      restarts.lost(ensureWatch);
    };
    ensureWatch();

    const reconnectController = createWatchReconnectController(window.setTimeout, window.clearTimeout);
    const connectSocket = () => {
      if (closed) return;
      try {
        const nextSocket = new WebSocket(api.resourceWatchEventsUrl(clusterId, resource, watchNamespace));
        socket = nextSocket;
        socketReady = false;
        updateHealth();
        const generation = reconnectController.connectionStarted();
        nextSocket.onopen = () => {
          if (socket !== nextSocket || closed) return;
          socketReady = true;
          backendReady = false;
          updateHealth();
          ensureWatch(true);
        };
        nextSocket.onmessage = (event) => {
          if (socket !== nextSocket || closed) return;
          const payload = api.parseResourceWatchEvent(String(event.data ?? ""));
          if (payload?.type === "resource.changed") coalescer.requestRefresh();
          if (starting && payload?.type === "watch.ended" && payload.watchId) endedDuringStart.add(payload.watchId);
          // An end of a watch that was already replaced is old news.
          if (payload?.type === "watch.ended" && (!watchId || !payload.watchId || payload.watchId === watchId)) watchLost();
        };
        nextSocket.onerror = () => {
          if (socket !== nextSocket || closed) return;
          socketReady = false;
          reloadWhenBack = true;
          updateHealth();
        };
        nextSocket.onclose = () => {
          if (socket === nextSocket) {
            socket = null;
            socketReady = false;
            backendReady = false;
            reloadWhenBack = true;
            updateHealth();
          }
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
      setWatchHealthy(false);
      reconnectController.stop();
      restarts.stop();
      coalescer.stop();
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
    };
  }, [api, clusterId, resource, namespaces, clusterScoped, enabled, refresh]);

  return watchHealthy;
}
