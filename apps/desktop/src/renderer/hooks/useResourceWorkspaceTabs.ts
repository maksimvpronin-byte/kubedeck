import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MouseEvent as ReactMouseEvent, MutableRefObject, SetStateAction } from "react";
import type { ApiClient } from "../api";
import type { SelectedResourceTarget } from "./useResourceNavigation";
import type { Cluster, ErrorInfo, ResourceRow, Section } from "../types";
import { asErrorInfo } from "../utils/errors";
import {
  closeResourceWorkspaceTab,
  type DrawerTabMemory,
  drawerTabForResource,
  rememberDrawerTab,
  resourceWorkspaceTabId,
  upsertResourceWorkspaceTab,
  type ResourceWorkspaceTab,
} from "../utils/workspaceTabs";

interface Options {
  api: ApiClient | null;
  activeCluster: Cluster | null;
  clusters: Cluster[];
  section: Section;
  selectedPod: ResourceRow | null;
  selectedTarget: SelectedResourceTarget | null;
  currentSelectedTarget: SelectedResourceTarget | null;
  setSelectedTarget: Dispatch<SetStateAction<SelectedResourceTarget | null>>;
  setSection: Dispatch<SetStateAction<Section>>;
  setResourceTab: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
  confirmDrawerNavigation: () => boolean;
  keepCurrentSelection: () => void;
  openCluster: (cluster: Cluster) => Promise<void> | void;
  drawerDirtyRef: MutableRefObject<boolean>;
  pinNextSelectionRef: MutableRefObject<boolean>;
}

export function useResourceWorkspaceTabs({
  api,
  activeCluster,
  clusters,
  section,
  selectedPod,
  selectedTarget,
  currentSelectedTarget,
  setSelectedTarget,
  setSection,
  setResourceTab,
  setError,
  confirmDrawerNavigation,
  keepCurrentSelection,
  openCluster,
  drawerDirtyRef,
  pinNextSelectionRef,
}: Options) {
  const [resourceWorkspaceTabs, setResourceWorkspaceTabs] = useState<ResourceWorkspaceTab[]>([]);
  const [activeResourceTabId, setActiveResourceTabId] = useState<string | null>(null);
  const [drawerTabMemory, setDrawerTabMemory] = useState<DrawerTabMemory>({});
  const resourceActivationRef = useRef(0);

  const activeResourceWorkspaceTab = resourceWorkspaceTabs.find((tab) => tab.id === activeResourceTabId) ?? null;
  const displayedResourceWorkspaceTab: ResourceWorkspaceTab | null =
    activeResourceWorkspaceTab ??
    (activeCluster && currentSelectedTarget
      ? {
          id: resourceWorkspaceTabId(activeCluster.id, currentSelectedTarget.resource, currentSelectedTarget.row),
          clusterId: activeCluster.id,
          clusterName: activeCluster.displayName,
          section,
          resource: currentSelectedTarget.resource,
          namespace: String(currentSelectedTarget.row.namespace || "_cluster"),
          row: currentSelectedTarget.row,
          drawerTab: drawerTabForResource(drawerTabMemory, currentSelectedTarget.resource),
          status: "ready",
        }
      : null);

  useEffect(() => {
    if (!activeCluster || !selectedTarget || selectedTarget.clusterId !== activeCluster.id) return;
    if (!pinNextSelectionRef.current) return;
    pinNextSelectionRef.current = false;
    const id = resourceWorkspaceTabId(activeCluster.id, selectedTarget.resource, selectedTarget.row);
    const candidate: ResourceWorkspaceTab = {
      id,
      clusterId: activeCluster.id,
      clusterName: activeCluster.displayName,
      section,
      resource: selectedTarget.resource,
      namespace: String(selectedTarget.row.namespace || "_cluster"),
      row: selectedTarget.row,
      drawerTab: drawerTabForResource(drawerTabMemory, selectedTarget.resource),
      status: "ready",
    };
    setResourceWorkspaceTabs((current) => {
      const result = upsertResourceWorkspaceTab(current, candidate);
      if (result.limited) {
        setError({ code: "LIMIT_REACHED", message: "Close a resource tab before opening another (10 maximum).", rawStderr: "", commandPreview: "" });
      } else setActiveResourceTabId(result.activeId);
      return result.tabs;
    });
  }, [activeCluster?.id, activeCluster?.displayName, selectedTarget, section]);

  const activateResourceTab = useCallback(
    async (tab: ResourceWorkspaceTab) => {
      if (!confirmDrawerNavigation()) return;
      const cluster = clusters.find((item) => item.id === tab.clusterId);
      if (!cluster || !api) {
        setResourceWorkspaceTabs((current) => current.map((item) => (item.id === tab.id ? { ...item, status: "unavailable" } : item)));
        return;
      }
      drawerDirtyRef.current = false;
      const requestId = ++resourceActivationRef.current;
      setActiveResourceTabId(tab.id);
      setResourceWorkspaceTabs((current) => current.map((item) => (item.id === tab.id ? { ...item, status: "loading" } : item)));
      if (activeCluster?.id !== cluster.id) await openCluster(cluster);
      if (resourceActivationRef.current !== requestId) return;
      keepCurrentSelection();
      setSelectedTarget({ clusterId: tab.clusterId, resource: tab.resource, row: tab.row });
      setSection(tab.section);
      setResourceTab(tab.resource);
      try {
        const response = await api.resources(tab.clusterId, tab.resource, tab.namespace);
        if (resourceActivationRef.current !== requestId) return;
        const row = response.items.find((item) => item.uid === tab.row.uid || (item.name === tab.row.name && String(item.namespace || "_cluster") === tab.namespace));
        setResourceWorkspaceTabs((current) => current.map((item) => (item.id === tab.id ? { ...item, row: row ?? item.row, status: row ? "ready" : "not-found" } : item)));
        setSelectedTarget(row ? { clusterId: tab.clusterId, resource: tab.resource, row } : null);
      } catch (err) {
        if (resourceActivationRef.current !== requestId) return;
        setResourceWorkspaceTabs((current) => current.map((item) => (item.id === tab.id ? { ...item, status: "unavailable" } : item)));
        setError(asErrorInfo(err));
      }
    },
    [api, activeCluster?.id, clusters, confirmDrawerNavigation, keepCurrentSelection, openCluster],
  );

  function closeResourceTab(id: string) {
    const closingActiveTab = id === activeResourceTabId;
    if (closingActiveTab && !confirmDrawerNavigation()) return;
    const result = closeResourceWorkspaceTab(resourceWorkspaceTabs, activeResourceTabId, id);
    setResourceWorkspaceTabs(result.tabs);
    if (!closingActiveTab) return;
    drawerDirtyRef.current = false;
    setActiveResourceTabId(result.activeId);
    const next = result.tabs.find((tab) => tab.id === result.activeId);
    if (next) void activateResourceTab(next);
    else setSelectedTarget(null);
  }

  function closeDisplayedResource() {
    if (activeResourceTabId) {
      closeResourceTab(activeResourceTabId);
      return;
    }
    if (!confirmDrawerNavigation()) return;
    drawerDirtyRef.current = false;
    setSelectedTarget(null);
  }

  function closeTransientDrawerFromBackground(event: ReactMouseEvent<HTMLDivElement>) {
    if (!selectedPod || activeResourceTabId) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("button, a, input, select, textarea, table, [role], [data-tooltip], .drawer, .modal-overlay, .table-footer, .resource-table-header")) return;
    closeDisplayedResource();
  }

  function removeClusterResourceTabs(clusterId: string) {
    const remaining = resourceWorkspaceTabs.filter((tab) => tab.clusterId !== clusterId);
    setResourceWorkspaceTabs(remaining);
    setActiveResourceTabId((current) => (remaining.some((tab) => tab.id === current) ? current : (remaining[0]?.id ?? null)));
  }

  const rememberResourceDrawerTab = useCallback((resource: string, drawerTab: string) => {
    setDrawerTabMemory((current) => rememberDrawerTab(current, resource, drawerTab));
  }, []);

  return {
    resourceWorkspaceTabs,
    setResourceWorkspaceTabs,
    activeResourceTabId,
    setActiveResourceTabId,
    activeResourceWorkspaceTab,
    displayedResourceWorkspaceTab,
    activateResourceTab,
    closeResourceTab,
    closeDisplayedResource,
    closeTransientDrawerFromBackground,
    removeClusterResourceTabs,
    rememberResourceDrawerTab,
  };
}
