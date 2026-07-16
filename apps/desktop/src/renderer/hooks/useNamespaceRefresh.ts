import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api";
import type { ErrorInfo, Settings } from "../types";
import { asErrorInfo, isAbortError } from "../utils/errors";
import { arraysEqual, normalizeNamespaceSelection } from "../utils/kubeResources";
import { getAutoRefreshIntervalSeconds } from "../utils/refresh";

export type ClusterNamespaceSelections = Record<string, string[]>;

export function normalizeClusterNamespaceSelections(value: unknown): ClusterNamespaceSelections {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: ClusterNamespaceSelections = {};
  for (const [clusterId, selection] of Object.entries(value)) {
    if (!clusterId || !Array.isArray(selection)) continue;
    const normalized = normalizeNamespaceSelection(selection).filter((item) => item !== "_cluster");
    if (normalized.length) result[clusterId] = normalized;
  }
  return result;
}

export function rememberedNamespacesForCluster(selections: ClusterNamespaceSelections, clusterId?: string) {
  if (!clusterId) return ["all"];
  const selection = normalizeNamespaceSelection(selections[clusterId] ?? []).filter((item) => item !== "_cluster");
  return selection.length ? selection : ["all"];
}

export function reconcileClusterNamespaceSelection(selection: string[], availableNamespaces: string[]) {
  const normalized = normalizeNamespaceSelection(selection).filter((item) => item !== "_cluster");
  if (!normalized.length || normalized.includes("all")) return ["all"];
  // An empty response can be transient while a cluster reconnects. Keep the
  // remembered scope until an authoritative non-empty list is available.
  if (!availableNamespaces.length) return normalized;
  const existing = normalized.filter((item) => availableNamespaces.includes(item));
  return existing.length ? existing : ["all"];
}

interface UseNamespaceRefreshOptions {
  api: ApiClient | null;
  activeClusterId?: string;
  settings?: Settings;
  initialSelectedNamespaces: string[];
  initialSelectedNamespacesByClusterId?: unknown;
  onError: (error: ErrorInfo) => void;
}

export function useNamespaceRefresh({ api, activeClusterId, settings, initialSelectedNamespaces, initialSelectedNamespacesByClusterId, onError }: UseNamespaceRefreshOptions) {
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>(initialSelectedNamespaces);
  const [selectedNamespacesByClusterId, setSelectedNamespacesByClusterId] = useState<ClusterNamespaceSelections>(() => normalizeClusterNamespaceSelections(initialSelectedNamespacesByClusterId));
  const selectionsRef = useRef(selectedNamespacesByClusterId);
  const namespaceLoadAbortRef = useRef<AbortController | null>(null);
  const namespaceLoadSeqRef = useRef(0);

  useEffect(() => {
    selectionsRef.current = selectedNamespacesByClusterId;
  }, [selectedNamespacesByClusterId]);

  const rememberClusterSelection = useCallback((clusterId: string, selection: string[]) => {
    const normalized = normalizeNamespaceSelection(selection).filter((item) => item !== "_cluster");
    const nextSelection = normalized.length ? normalized : ["all"];
    const current = selectionsRef.current;
    if (arraysEqual(current[clusterId] ?? [], nextSelection)) return nextSelection;
    const next = { ...current, [clusterId]: nextSelection };
    selectionsRef.current = next;
    setSelectedNamespacesByClusterId(next);
    return nextSelection;
  }, []);

  const activateClusterNamespaces = useCallback(
    (clusterId: string, availableNamespaces: string[]) => {
      const sortedNamespaces = Array.from(new Set(availableNamespaces.filter(Boolean))).sort((left, right) => left.localeCompare(right));
      const remembered = rememberedNamespacesForCluster(selectionsRef.current, clusterId);
      const reconciled = reconcileClusterNamespaceSelection(remembered, sortedNamespaces);
      setNamespaces((current) => (arraysEqual(current, sortedNamespaces) ? current : sortedNamespaces));
      setSelectedNamespaces(reconciled);
      rememberClusterSelection(clusterId, reconciled);
      return reconciled;
    },
    [rememberClusterSelection],
  );

  const forgetClusterNamespaces = useCallback((clusterId: string) => {
    const current = selectionsRef.current;
    if (!(clusterId in current)) return;
    const next = { ...current };
    delete next[clusterId];
    selectionsRef.current = next;
    setSelectedNamespacesByClusterId(next);
  }, []);

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
        const nextNamespaces = Array.from(new Set((result.items ?? []).map((item) => item.metadata?.name).filter((name): name is string => Boolean(name)))).sort((left, right) =>
          left.localeCompare(right),
        );

        setNamespaces((current) => (arraysEqual(current, nextNamespaces) ? current : nextNamespaces));
        const remembered = rememberedNamespacesForCluster(selectionsRef.current, clusterId);
        const reconciled = reconcileClusterNamespaceSelection(remembered, nextNamespaces);
        rememberClusterSelection(clusterId, reconciled);
        setSelectedNamespaces((current) => {
          if (clusterId !== activeClusterId || current.includes("_cluster")) return current;
          const normalized = normalizeNamespaceSelection(current);
          if (normalized.includes("all") || normalized.includes("_cluster")) return current;

          // Namespace refresh must never widen an explicit user selection to "all".
          // During pod restart/delete flows the namespace list can be temporarily stale or empty,
          // and falling back to all namespaces makes the resource table suddenly show every pod.
          if (!nextNamespaces.length) return current;

          return arraysEqual(normalized, reconciled) ? current : reconciled;
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
    [api, activeClusterId, onError, rememberClusterSelection],
  );

  const setNamespaceSelection = useCallback(
    (next: string | string[]) => {
      const normalized = normalizeNamespaceSelection(next);
      const selection = normalized.length ? normalized : ["all"];
      setSelectedNamespaces(selection);
      if (activeClusterId && !selection.includes("_cluster")) rememberClusterSelection(activeClusterId, selection);
    },
    [activeClusterId, rememberClusterSelection],
  );

  const restoreNamespacedSelection = useCallback(
    (clusterId = activeClusterId) => {
      const remembered = rememberedNamespacesForCluster(selectionsRef.current, clusterId);
      setSelectedNamespaces(remembered);
      return remembered;
    },
    [activeClusterId],
  );

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
    selectedNamespacesByClusterId,
    setSelectedNamespaces,
    setNamespaceSelection,
    activateClusterNamespaces,
    forgetClusterNamespaces,
    restoreNamespacedSelection,
    loadNamespaces,
  };
}
