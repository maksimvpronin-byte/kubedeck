import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ApiClient } from "../api";
import { resourceTree, sectionForResource } from "../navigation";
import type { Cluster, ErrorInfo, ResourceDefinition, ResourceRow, Section } from "../types";
import { asErrorInfo } from "../utils/errors";
import { findResourceDefinition, sameResourceIdentity } from "../utils/kubeResources";

export interface ResourceNavigationTarget {
  resource: string;
  section: Section;
  namespace: string;
  clusterScoped: boolean;
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
        ? (rememberedNamespaces.length === 1 ? rememberedNamespaces[0] : "all")
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
  selectedResource: string;
  namespace: string;
  selectedNamespaces: string[];
  resourceDefinitions: ResourceDefinition[];
  rows: Record<string, ResourceRow[]>;
  selectedRow: ResourceRow | null;
  setRows: Dispatch<SetStateAction<Record<string, ResourceRow[]>>>;
  setSelectedRow: Dispatch<SetStateAction<ResourceRow | null>>;
  setSelectedResource: Dispatch<SetStateAction<string>>;
  setResourceTab: Dispatch<SetStateAction<string>>;
  setSection: Dispatch<SetStateAction<Section>>;
  setExpandedSections: Dispatch<SetStateAction<Set<string>>>;
  setNamespaceSelection: (next: string | string[]) => void;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
}

export function useResourceNavigation(options: Options) {
  const {
    api, activeCluster, resourceTab, selectedResource, namespace, selectedNamespaces,
    resourceDefinitions, rows, selectedRow, setRows, setSelectedRow, setSelectedResource,
    setResourceTab, setSection, setExpandedSections, setNamespaceSelection, setError,
  } = options;
  const keepSelectionRef = useRef(false);
  const lastNamespacedSelectionRef = useRef<string[]>(
    selectedNamespaces.length > 0 && !selectedNamespaces.includes("_cluster") ? selectedNamespaces : ["all"],
  );

  useEffect(() => {
    if (selectedNamespaces.length > 0 && !selectedNamespaces.includes("_cluster")) {
      lastNamespacedSelectionRef.current = selectedNamespaces;
    }
  }, [selectedNamespaces]);

  useEffect(() => {
    if (!selectedRow) return;
    const latest = (rows[selectedResource] ?? []).find((row) =>
      row.uid === selectedRow.uid ||
      (row.name === selectedRow.name && String(row.namespace ?? "") === String(selectedRow.namespace ?? ""))
    );
    if (latest && latest !== selectedRow) setSelectedRow(latest);
  }, [rows, selectedResource, selectedRow, setSelectedRow]);

  const openResourceLocator = useCallback(async (locator: ResourceRow) => {
    if (!api || !activeCluster) {
      setSelectedRow(locator);
      return;
    }
    const target = resolveResourceNavigationTarget(
      locator,
      selectedResource,
      resourceTab,
      namespace,
      lastNamespacedSelectionRef.current,
      resourceDefinitions,
    );
    if (!target) return;

    setSection(target.section);
    if (resourceTree[target.section]) setExpandedSections((current) => new Set(current).add(target.section));
    keepSelectionRef.current = true;
    setResourceTab(target.resource);
    setSelectedResource(target.resource);
    setSelectedRow(locator);
    if (target.clusterScoped) {
      setNamespaceSelection("_cluster");
    } else if (target.namespace !== "all") {
      setNamespaceSelection(target.namespace);
    } else if (selectedNamespaces.includes("_cluster")) {
      setNamespaceSelection(lastNamespacedSelectionRef.current.length ? lastNamespacedSelectionRef.current : ["all"]);
    }

    try {
      const response = await api.resources(activeCluster.id, target.resource, target.namespace);
      const found = response.items.find((item) => sameResourceIdentity(locator, item));
      setRows((current) => ({ ...current, [target.resource]: response.items }));
      if (found) {
        setSelectedRow(found);
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
      setError(asErrorInfo(error));
    }
  }, [
    api, activeCluster, selectedResource, resourceTab, namespace, resourceDefinitions,
    selectedNamespaces, setSection, setExpandedSections, setResourceTab, setSelectedResource,
    setSelectedRow, setNamespaceSelection, setRows, setError,
  ]);

  const openRelatedResource = useCallback(async (resource: string, relatedNamespace: string, name: string) => {
    await openResourceLocator({
      uid: `${resource}:${relatedNamespace || "_cluster"}:${name}`,
      resource,
      namespace: relatedNamespace || "_cluster",
      name,
    });
  }, [openResourceLocator]);

  const consumeKeepSelection = useCallback(() => {
    const value = keepSelectionRef.current;
    keepSelectionRef.current = false;
    return value;
  }, []);

  const keepCurrentSelection = useCallback(() => {
    keepSelectionRef.current = true;
  }, []);

  const restoreNamespacedSelection = useCallback(() => {
    setNamespaceSelection(lastNamespacedSelectionRef.current.length ? lastNamespacedSelectionRef.current : ["all"]);
  }, [setNamespaceSelection]);

  return {
    openResourceLocator,
    openRelatedResource,
    consumeKeepSelection,
    keepCurrentSelection,
    restoreNamespacedSelection,
  };
}
