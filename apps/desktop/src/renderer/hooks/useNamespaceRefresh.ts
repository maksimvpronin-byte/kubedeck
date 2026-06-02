import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api";
import type { ErrorInfo, Settings } from "../types";
import { asErrorInfo, isAbortError } from "../utils/errors";
import { arraysEqual, normalizeNamespaceSelection } from "../utils/kubeResources";
import { getAutoRefreshIntervalSeconds } from "../utils/refresh";

interface UseNamespaceRefreshOptions {
  api: ApiClient | null;
  activeClusterId?: string;
  settings?: Settings;
  initialSelectedNamespaces: string[];
  onError: (error: ErrorInfo) => void;
}

export function useNamespaceRefresh({
  api,
  activeClusterId,
  settings,
  initialSelectedNamespaces,
  onError,
}: UseNamespaceRefreshOptions) {
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>(initialSelectedNamespaces);
  const namespaceLoadAbortRef = useRef<AbortController | null>(null);
  const namespaceLoadSeqRef = useRef(0);

  const loadNamespaces = useCallback(
    async (clusterId = activeClusterId, silent = true) => {
      if (!api || !clusterId) return;
      const requestId = namespaceLoadSeqRef.current + 1;
      namespaceLoadSeqRef.current = requestId;
      namespaceLoadAbortRef.current?.abort();
      const controller = new AbortController();
      namespaceLoadAbortRef.current = controller;

      try {
        const result = await api.namespaces(clusterId, controller.signal);
        if (namespaceLoadSeqRef.current !== requestId) return;
        const nextNamespaces = Array.from(
          new Set((result.items ?? []).map((item) => item.metadata?.name).filter((name): name is string => Boolean(name)))
        ).sort((left, right) => left.localeCompare(right));

        setNamespaces((current) => arraysEqual(current, nextNamespaces) ? current : nextNamespaces);
        setSelectedNamespaces((current) => {
          const normalized = normalizeNamespaceSelection(current);
          if (normalized.includes("all") || normalized.includes("_cluster")) return current;

          // Namespace refresh must never widen an explicit user selection to "all".
          // During pod restart/delete flows the namespace list can be temporarily stale or empty,
          // and falling back to all namespaces makes the resource table suddenly show every pod.
          if (!nextNamespaces.length) return current;

          const existing = normalized.filter((item) => nextNamespaces.includes(item));
          if (!existing.length) return current;
          return arraysEqual(normalized, existing) ? current : existing;
        });
      } catch (err) {
        if (isAbortError(err) || namespaceLoadSeqRef.current !== requestId) return;
        if (!silent) onError(asErrorInfo(err));
      } finally {
        if (namespaceLoadSeqRef.current === requestId && namespaceLoadAbortRef.current === controller) {
          namespaceLoadAbortRef.current = null;
        }
      }
    },
    [api, activeClusterId, onError]
  );

  const setNamespaceSelection = useCallback((next: string | string[]) => {
    const normalized = normalizeNamespaceSelection(next);
    setSelectedNamespaces(normalized.length ? normalized : ["all"]);
  }, []);

  useEffect(() => {
    if (!activeClusterId || !api) return;
    loadNamespaces(activeClusterId, true);
    const intervalSeconds = getAutoRefreshIntervalSeconds(settings);
    if (intervalSeconds <= 0) return;
    const timer = window.setInterval(() => {
      loadNamespaces(activeClusterId, true);
    }, intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [api, activeClusterId, settings?.refreshIntervalSeconds, loadNamespaces]);

  useEffect(() => {
    return () => namespaceLoadAbortRef.current?.abort();
  }, []);

  return {
    namespaces,
    setNamespaces,
    selectedNamespaces,
    setSelectedNamespaces,
    setNamespaceSelection,
    loadNamespaces,
  };
}
