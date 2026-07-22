import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ApiClient } from "../api";
import { resourceTree, sectionForResource } from "../navigation";
import type { Cluster, ErrorInfo, ResourceDefinition, ResourceRow, Section } from "../types";
import { asErrorInfo, isAbortError } from "../utils/errors";
import { findResourceDefinition, sameResourceIdentity } from "../utils/kubeResources";

export interface ResourceNavigationTarget {
  resource: string;
  section: Section;
  namespace: string;
  clusterScoped: boolean;
}

export interface SelectedResourceTarget {
  clusterId: string;
  resource: string;
  row: ResourceRow;
}

export function currentSelectedResourceTarget(target: SelectedResourceTarget | null, clusterId: string | undefined, resource: string) {
  return target && target.clusterId === clusterId && target.resource === resource ? target : null;
}

export function resolveResourceNavigationTarget(
  locator: ResourceRow,
  selectedResource: string,
  resourceTab: string,
  namespace: string,
  rememberedNamespaces: string[],
  definitions: ResourceDefinition[],
): ResourceNavigationTarget | null {
  const resource = String(locator.resource || selectedResource || resourceTab);
  if (!resource) return null;
  const definition = findResourceDefinition(definitions, resource);
  const clusterScoped = definition?.namespaced === false;
  const locatorNamespace = String(locator.namespace || "");
  const nextNamespace = clusterScoped
    ? "_cluster"
    : locatorNamespace && locatorNamespace !== "_cluster"
      ? locatorNamespace
      : namespace === "_cluster"
        ? rememberedNamespaces.length === 1
          ? rememberedNamespaces[0]
          : "all"
        : namespace || "all";
  return {
    resource,
    section: sectionForResource(resource) ?? (locator.crdInstance ? "crd" : "workloads"),
    namespace: nextNamespace,
    clusterScoped,
  };
}

interface Options {
  api: ApiClient | null;
  activeCluster: Cluster | null;
  resourceTab: string;
  selectedTarget: SelectedResourceTarget | null;
  namespace: string;
  selectedNamespaces: string[];
  rememberedNamespaces: string[];
  resourceDefinitions: ResourceDefinition[];
  rows: Record<string, ResourceRow[]>;
  setRows: Dispatch<SetStateAction<Record<string, ResourceRow[]>>>;
  setSelectedTarget: Dispatch<SetStateAction<SelectedResourceTarget | null>>;
  setResourceTab: Dispatch<SetStateAction<string>>;
  setSection: Dispatch<SetStateAction<Section>>;
  setExpandedSections: Dispatch<SetStateAction<Set<string>>>;
  setNamespaceSelection: (next: string | string[]) => void;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
  canNavigate?: () => boolean;
}

export function useResourceNavigation(options: Options) {
  const {
    api,
    activeCluster,
    resourceTab,
    selectedTarget,
    namespace,
    selectedNamespaces,
    rememberedNamespaces,
    resourceDefinitions,
    rows,
    setRows,
    setSelectedTarget,
    setResourceTab,
    setSection,
    setExpandedSections,
    setNamespaceSelection,
    setError,
    canNavigate,
  } = options;
  const keepSelectionRef = useRef(false);
  const navigationRequestRef = useRef(0);
  const navigationAbortRef = useRef<AbortController | null>(null);

  const cancelResourceNavigation = useCallback(() => {
    navigationRequestRef.current += 1;
    navigationAbortRef.current?.abort();
    navigationAbortRef.current = null;
  }, []);

  useEffect(() => () => cancelResourceNavigation(), [cancelResourceNavigation]);
  useEffect(() => {
    if (!selectedTarget || selectedTarget.clusterId !== activeCluster?.id) return;
    const latest = (rows[selectedTarget.resource] ?? []).find(
      (row) => row.uid === selectedTarget.row.uid || (row.name === selectedTarget.row.name && String(row.namespace ?? "") === String(selectedTarget.row.namespace ?? "")),
    );
    if (latest && latest !== selectedTarget.row) {
      setSelectedTarget((current) => {
        if (!current || current.clusterId !== selectedTarget.clusterId || current.resource !== selectedTarget.resource || !sameResourceIdentity(current.row, selectedTarget.row)) return current;
        return { ...current, row: latest };
      });
    }
  }, [activeCluster?.id, rows, selectedTarget, setSelectedTarget]);

  const openResourceLocator = useCallback(
    async (locator: ResourceRow) => {
      if (canNavigate && !canNavigate()) return;
      if (!api || !activeCluster) {
        setSelectedTarget(null);
        return;
      }
      const target = resolveResourceNavigationTarget(locator, selectedTarget?.resource ?? resourceTab, resourceTab, namespace, rememberedNamespaces, resourceDefinitions);
      if (!target) return;
      const requestId = navigationRequestRef.current + 1;
      navigationRequestRef.current = requestId;
      navigationAbortRef.current?.abort();
      const controller = new AbortController();
      navigationAbortRef.current = controller;

      setSection(target.section);
      if (resourceTree[target.section]) setExpandedSections((current) => new Set(current).add(target.section));
      keepSelectionRef.current = true;
      setResourceTab(target.resource);
      setSelectedTarget({ clusterId: activeCluster.id, resource: target.resource, row: locator });
      if (target.clusterScoped) {
        setNamespaceSelection("_cluster");
      } else if (target.namespace !== "all") {
        setNamespaceSelection(target.namespace);
      } else if (selectedNamespaces.includes("_cluster")) {
        setNamespaceSelection(rememberedNamespaces.length ? rememberedNamespaces : ["all"]);
      }

      try {
        const response = await api.resources(activeCluster.id, target.resource, target.namespace, controller.signal);
        if (controller.signal.aborted || navigationRequestRef.current !== requestId) return;
        const found = response.items.find((item) => sameResourceIdentity(locator, item));
        setRows((current) => ({ ...current, [target.resource]: response.items }));
        if (found) {
          setSelectedTarget((current) => {
            if (!current || current.clusterId !== activeCluster.id || current.resource !== target.resource || !sameResourceIdentity(current.row, locator)) return current;
            return { ...current, row: found };
          });
          setError(null);
          return;
        }
        setError({
          code: "PARTIAL_RESULT",
          message: `${target.resource}/${String(locator.name || "unknown")} was opened from search data, but the live resource list did not contain it. It may have been deleted or filtered by namespace.`,
          rawStderr: "",
          commandPreview: "",
        });
      } catch (error) {
        if (controller.signal.aborted || navigationRequestRef.current !== requestId || isAbortError(error)) return;
        setError(asErrorInfo(error));
      } finally {
        if (navigationRequestRef.current === requestId && navigationAbortRef.current === controller) navigationAbortRef.current = null;
      }
    },
    [
      api,
      activeCluster,
      selectedTarget,
      resourceTab,
      namespace,
      rememberedNamespaces,
      resourceDefinitions,
      selectedNamespaces,
      setSection,
      setExpandedSections,
      setResourceTab,
      setSelectedTarget,
      setNamespaceSelection,
      setRows,
      setError,
      canNavigate,
    ],
  );

  const openRelatedResource = useCallback(
    async (resource: string, relatedNamespace: string, name: string) => {
      await openResourceLocator({
        uid: `${resource}:${relatedNamespace || "_cluster"}:${name}`,
        resource,
        namespace: relatedNamespace || "_cluster",
        name,
      });
    },
    [openResourceLocator],
  );

  const consumeKeepSelection = useCallback(() => {
    const value = keepSelectionRef.current;
    keepSelectionRef.current = false;
    return value;
  }, []);

  const keepCurrentSelection = useCallback(() => {
    keepSelectionRef.current = true;
  }, []);

  return {
    openResourceLocator,
    openRelatedResource,
    consumeKeepSelection,
    keepCurrentSelection,
    cancelResourceNavigation,
  };
}
