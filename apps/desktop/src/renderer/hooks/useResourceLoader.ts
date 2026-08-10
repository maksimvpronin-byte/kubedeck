import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ErrorInfo, ResourceRow } from "../types";
import { asErrorInfo, isAbortError } from "../utils/errors";
import { loadNamespaceResourceBatches, normalizeNamespaceSelection, resourceScopeKey } from "../utils/kubeResources";

const RESOURCE_LOAD_TIMEOUT_MS = 30_000;

function isClusterUnavailableError(info: ErrorInfo) {
  const text = `${info.code ?? ""} ${info.message ?? ""} ${info.rawStderr ?? ""}`.toLowerCase();
  return [
    "connection refused",
    "connectex",
    "i/o timeout",
    "context deadline exceeded",
    "no route to host",
    "network is unreachable",
    "host is unreachable",
    "unable to connect to the server",
    "the connection to the server",
    "tls handshake timeout",
    "dial tcp",
    "temporary failure in name resolution",
    "no such host",
    "server has asked for the client to provide credentials",
    "forbidden: user",
    "unauthorized",
    "certificate signed by unknown authority",
  ].some((needle) => text.includes(needle));
}

interface UseResourceLoaderOptions {
  api: ApiClient | null;
  activeCluster: Cluster | null;
  resource: string;
  namespaces: string[];
  setRows: Dispatch<SetStateAction<Record<string, ResourceRow[]>>>;
  setNamespaces: Dispatch<SetStateAction<string[]>>;
  setActiveCluster: Dispatch<SetStateAction<Cluster | null>>;
  setUnavailableCluster: Dispatch<SetStateAction<Cluster | null>>;
  setSelectedRow: Dispatch<SetStateAction<ResourceRow | null>>;
  clearPendingActions: () => void;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
}

type ResourceLoad = (clusterId?: string, nextResource?: string, nextNamespaces?: string | string[], silent?: boolean) => Promise<boolean>;

export function useResourceLoader({
  api,
  activeCluster,
  resource,
  namespaces,
  setRows,
  setNamespaces,
  setActiveCluster,
  setUnavailableCluster,
  setSelectedRow,
  clearPendingActions,
  setLoading,
  setError,
}: UseResourceLoaderOptions) {
  const abortRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const loadedScopeRef = useRef(new Map<string, string>());
  const inFlightScopeRef = useRef<string | null>(null);
  const pendingSilentRefreshRef = useRef(false);
  const loadRef = useRef<ResourceLoad | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const load = useCallback<ResourceLoad>(
    async (clusterId = activeCluster?.id, nextResource = resource, nextNamespaces: string | string[] = namespaces, silent = false) => {
      if (!api || !clusterId || nextResource === "port-forwards") return false;

      const normalizedNamespaces = normalizeNamespaceSelection(nextNamespaces);
      const scopeKey = resourceScopeKey(clusterId, nextResource, normalizedNamespaces);

      // A silent refresh must never abort a running load of the same scope.
      // Watch events on a busy cluster arrive faster than a wide `kubectl get -A`
      // finishes, so aborting here starved the load and left the table on the
      // rows of the previously selected namespace.
      if (silent && inFlightScopeRef.current === scopeKey) {
        pendingSilentRefreshRef.current = true;
        return false;
      }

      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      inFlightScopeRef.current = scopeKey;
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, RESOURCE_LOAD_TIMEOUT_MS);

      // Rows are dropped before the request is awaited when the scope changes,
      // so an aborted or failing load cannot leave another scope on screen.
      if (loadedScopeRef.current.get(nextResource) !== scopeKey) {
        loadedScopeRef.current.delete(nextResource);
        pendingSilentRefreshRef.current = false;
        setRows((current) => (current[nextResource]?.length ? { ...current, [nextResource]: [] } : current));
        clearPendingActions();
      }

      if (!silent) setLoading(true);
      try {
        const responses = await loadNamespaceResourceBatches(api, clusterId, nextResource, normalizedNamespaces, controller.signal, { useCache: false, forceRefresh: true });
        if (requestSequenceRef.current !== requestId) return false;
        setRows((current) => ({
          ...current,
          [nextResource]: responses.flatMap((response) => response.items),
        }));
        loadedScopeRef.current.set(nextResource, scopeKey);
        setError(null);
        setUnavailableCluster((current) => (current?.id === clusterId ? null : current));
        return true;
      } catch (error) {
        if (requestSequenceRef.current !== requestId) return false;
        if (isAbortError(error)) {
          if (timedOut) {
            setError({
              code: "RESOURCE_LOAD_TIMEOUT",
              message: `${nextResource} refresh did not finish within ${RESOURCE_LOAD_TIMEOUT_MS / 1000} seconds. Try a narrower namespace or refresh again.`,
              rawStderr: "",
              commandPreview: `kubectl get ${nextResource}`,
            });
          }
          return false;
        }

        const info = asErrorInfo(error);
        if (isClusterUnavailableError(info)) {
          void api.clearResourceCache(clusterId).catch(() => undefined);
          setRows({});
          setNamespaces([]);
          loadedScopeRef.current.clear();
          setUnavailableCluster((current) => current ?? activeCluster ?? null);
          setActiveCluster((current) => (current?.id === clusterId ? null : current));
        } else {
          setRows((current) => ({ ...current, [nextResource]: [] }));
          // An empty table belongs to the scope that failed, so the next refresh
          // of the same scope does not need to clear it again.
          loadedScopeRef.current.set(nextResource, scopeKey);
        }
        setSelectedRow(null);
        clearPendingActions();
        setError(info);
        return false;
      } finally {
        window.clearTimeout(timeoutId);
        if (requestSequenceRef.current === requestId) {
          if (abortRef.current === controller) abortRef.current = null;
          if (inFlightScopeRef.current === scopeKey) inFlightScopeRef.current = null;
          if (!silent) setLoading(false);
          if (pendingSilentRefreshRef.current) {
            pendingSilentRefreshRef.current = false;
            void loadRef.current?.(clusterId, nextResource, normalizedNamespaces, true);
          }
        }
      }
    },
    [api, activeCluster, resource, namespaces, setRows, setNamespaces, setActiveCluster, setUnavailableCluster, setSelectedRow, clearPendingActions, setLoading, setError],
  );
  loadRef.current = load;
  return load;
}
