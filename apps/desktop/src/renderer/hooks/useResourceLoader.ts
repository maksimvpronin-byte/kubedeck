import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ApiClient } from "../api";
import { beginBootStage, completeBootStage, failBootStage } from "../bootProgress";
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
    "unauthorized",
    "certificate signed by unknown authority",
  ].some((needle) => text.includes(needle));
}

// A load that failed for the table on screen. The table needs it to tell
// "this scope has no such resources" from "the list could not be read"; the
// shared error panel alone cannot, since any other request may have set it.
export interface ResourceLoadFailure {
  clusterId: string;
  resource: string;
  error: ErrorInfo;
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
  setLoadFailure?: Dispatch<SetStateAction<ResourceLoadFailure | null>>;
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
  setLoadFailure,
}: UseResourceLoaderOptions) {
  const abortRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const loadedScopeRef = useRef(new Map<string, string>());
  const inFlightScopeRef = useRef<string | null>(null);
  const pendingSilentRefreshRef = useRef(false);
  const loadRef = useRef<ResourceLoad | null>(null);
  // The request that turned the loading flag on is the one that turns it off.
  // Clearing it by request sequence alone left it on for good whenever a
  // silent refresh superseded an explicit load: the explicit one was no
  // longer current, and the silent one never touches the flag.
  const loadingOwnerRef = useRef<number | null>(null);

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
        setLoadFailure?.((current) => (current?.resource === nextResource ? null : current));
        clearPendingActions();
      }

      // While the boot screen is still up this is the stage it ends on: a
      // window handed over before its first table has rows looks like it is
      // still starting, which is exactly what it was doing before.
      beginBootStage("resources", nextResource);
      // A silent load that takes over from an explicit one keeps the flag on:
      // the table is still waiting for its rows.
      if (!silent || loadingOwnerRef.current !== null) {
        loadingOwnerRef.current = requestId;
        setLoading(true);
      }
      try {
        const responses = await loadNamespaceResourceBatches(api, clusterId, nextResource, normalizedNamespaces, controller.signal, { useCache: false, forceRefresh: true });
        if (requestSequenceRef.current !== requestId) return false;
        setRows((current) => ({
          ...current,
          [nextResource]: responses.flatMap((response) => response.items),
        }));
        loadedScopeRef.current.set(nextResource, scopeKey);
        setLoadFailure?.((current) => (current?.resource === nextResource ? null : current));
        setError(null);
        setUnavailableCluster((current) => (current?.id === clusterId ? null : current));
        return true;
      } catch (error) {
        if (requestSequenceRef.current !== requestId) return false;
        if (isAbortError(error)) {
          if (timedOut) {
            const timeout: ErrorInfo = {
              code: "RESOURCE_LOAD_TIMEOUT",
              message: `${nextResource} refresh did not finish within ${RESOURCE_LOAD_TIMEOUT_MS / 1000} seconds. Try a narrower namespace or refresh again.`,
              rawStderr: "",
              commandPreview: `kubectl get ${nextResource}`,
            };
            setLoadFailure?.({ clusterId, resource: nextResource, error: timeout });
            setError(timeout);
          }
          return false;
        }

        const info = asErrorInfo(error);
        failBootStage("resources", info.message);
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
          setLoadFailure?.({ clusterId, resource: nextResource, error: info });
        }
        setSelectedRow(null);
        clearPendingActions();
        setError(info);
        return false;
      } finally {
        completeBootStage("resources");
        window.clearTimeout(timeoutId);
        if (loadingOwnerRef.current === requestId) {
          loadingOwnerRef.current = null;
          setLoading(false);
        }
        if (requestSequenceRef.current === requestId) {
          if (abortRef.current === controller) abortRef.current = null;
          if (inFlightScopeRef.current === scopeKey) inFlightScopeRef.current = null;
          if (pendingSilentRefreshRef.current) {
            pendingSilentRefreshRef.current = false;
            void loadRef.current?.(clusterId, nextResource, normalizedNamespaces, true);
          }
        }
      }
    },
    [api, activeCluster, resource, namespaces, setRows, setNamespaces, setActiveCluster, setUnavailableCluster, setSelectedRow, clearPendingActions, setLoading, setError, setLoadFailure],
  );
  loadRef.current = load;
  return load;
}
