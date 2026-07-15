import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ErrorInfo, ResourceRow } from "../types";
import { asErrorInfo, isAbortError } from "../utils/errors";
import { loadNamespaceResourceBatches, normalizeNamespaceSelection } from "../utils/kubeResources";

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

  useEffect(() => () => abortRef.current?.abort(), []);

  return useCallback(
    async (clusterId = activeCluster?.id, nextResource = resource, nextNamespaces: string | string[] = namespaces, silent = false) => {
      if (!api || !clusterId || nextResource === "port-forwards") return false;

      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, RESOURCE_LOAD_TIMEOUT_MS);

      if (!silent) setLoading(true);
      try {
        const normalizedNamespaces = normalizeNamespaceSelection(nextNamespaces);
        const responses = await loadNamespaceResourceBatches(api, clusterId, nextResource, normalizedNamespaces, controller.signal, { useCache: false, forceRefresh: true });
        if (requestSequenceRef.current !== requestId) return false;
        setRows((current) => ({
          ...current,
          [nextResource]: responses.flatMap((response) => response.items),
        }));
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
          setUnavailableCluster((current) => current ?? activeCluster ?? null);
          setActiveCluster((current) => (current?.id === clusterId ? null : current));
        } else {
          setRows((current) => ({ ...current, [nextResource]: [] }));
        }
        setSelectedRow(null);
        clearPendingActions();
        setError(info);
        return false;
      } finally {
        window.clearTimeout(timeoutId);
        if (requestSequenceRef.current === requestId) {
          if (abortRef.current === controller) abortRef.current = null;
          if (!silent) setLoading(false);
        }
      }
    },
    [api, activeCluster, resource, namespaces, setRows, setNamespaces, setActiveCluster, setUnavailableCluster, setSelectedRow, clearPendingActions, setLoading, setError],
  );
}
