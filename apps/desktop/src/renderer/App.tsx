import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, MouseEvent as ReactMouseEvent, ReactNode, SetStateAction } from "react";
import { AppCommandPalette } from "./components/AppCommandPalette";
import { ClusterRail } from "./components/ClusterRail";
import { UnavailableClusterPanel } from "./components/UnavailableClusterPanel";
import { BulkActionModals } from "./components/BulkActionModals";
import { ErrorPanel } from "./components/ErrorPanel";
import { NamespaceSelector } from "./components/NamespaceSelector";
import { LazyPanelBoundary } from "./components/LazyPanelBoundary";
import { AppResourceTable } from "./components/AppResourceTable";
import { ResourceWorkspaceTabs } from "./components/ResourceWorkspaceTabs";
import type { DrawerTab } from "./components/PodDrawerChrome";
import { PlaceholderSection } from "./components/PlaceholderSection";
import { DisconnectClusterModal } from "./components/DisconnectClusterModal";
import { DisconnectedClusterPanel } from "./components/DisconnectedClusterPanel";
import { RenameClusterModal } from "./components/RenameClusterModal";
import { useGlobalSearch } from "./hooks/useGlobalSearch";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useBulkResourceActions } from "./hooks/useBulkResourceActions";
import { useClusterController } from "./hooks/useClusterController";
import { usePersistUiState } from "./hooks/usePersistUiState";
import { useResourceLoader } from "./hooks/useResourceLoader";
import { currentSelectedResourceTarget, useResourceNavigation } from "./hooks/useResourceNavigation";
import type { SelectedResourceTarget } from "./hooks/useResourceNavigation";
import { useResourceWatch } from "./hooks/useResourceWatch";
import { useBottomTerminals } from "./hooks/useBottomTerminals";
import { useCommandPaletteItems } from "./hooks/useCommandPaletteItems";
import { useNodeDiskUsage } from "./hooks/useNodeDiskUsage";
import { useResourceWorkspaceTabs } from "./hooks/useResourceWorkspaceTabs";
import { buildResourceTableColumns } from "./utils/resourceTableColumns";
import { createTranslator } from "./i18n";
import { brandIcon as Database, isPlaceholderSection, normalizeStoredSection, resourceLabel, resourceTree, sectionTitle, sections, visibleTabs } from "./navigation";
import { canDeleteResource, findResourceDefinition, groupCrds, normalizeNamespaceSelection } from "./utils/kubeResources";
import { applyPodUsage } from "./utils/podUsagePatch";
import type { ApiKeyUpdate, ErrorInfo, ResourceRow, Section, Settings } from "./types";
import { loadUiState } from "./uiState";
import { setAlignedInterval } from "./utils/alignedInterval";
import { asErrorInfo } from "./utils/errors";
import { getAutoRefreshIntervalSeconds, shouldPollResources } from "./utils/refresh";
import { normalizeSettingsSsh, saveStoredSshDefaults } from "./utils/sshDefaults";

// Matches the sampling interval: the table cannot show anything newer than the
// samples behind it.
const POD_USAGE_REFRESH_MS = 15_000;

function isPodResourceTab(resource: string): boolean {
  return ["pods", "pod", "po"].includes(resource);
}

const initialUiState = typeof window !== "undefined" ? loadUiState() : {};
const initialSection = normalizeStoredSection(initialUiState.section);
const initialResourceTab = initialUiState.section === "overview" || initialSection === "nodes" ? "nodes" : (initialUiState.resourceTab ?? "pods");
const initialSelectedNamespaces = initialSection === "nodes" ? ["_cluster"] : ["all"];

const AboutPanel = lazy(() => import("./components/AboutPanel").then((module) => ({ default: module.AboutPanel })));
const OverviewPanel = lazy(() => import("./components/OverviewPanel").then((module) => ({ default: module.OverviewPanel })));
const BottomTerminalPanel = lazy(() => import("./components/BottomTerminalPanel").then((module) => ({ default: module.BottomTerminalPanel })));
const HelpPanel = lazy(() => import("./components/HelpPanel").then((module) => ({ default: module.HelpPanel })));
const PortForwardsPanel = lazy(() => import("./components/PortForwardsPanel").then((module) => ({ default: module.PortForwardsPanel })));
const ProblemsPanel = lazy(() => import("./components/ProblemsPanel").then((module) => ({ default: module.ProblemsPanel })));
const PodDrawer = lazy(() => import("./components/PodDrawer").then((module) => ({ default: module.PodDrawer })));
const SettingsPanel = lazy(() => import("./components/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));

function LazySurface({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  return (
    <LazyPanelBoundary resetKey={resetKey}>
      <Suspense
        fallback={
          <div className="panel-loading" role="status">
            Loading…
          </div>
        }
      >
        {children}
      </Suspense>
    </LazyPanelBoundary>
  );
}

export function App() {
  const [section, setSection] = useState<Section>(initialSection);
  const [resourceTab, setResourceTab] = useState(initialResourceTab);
  const [rows, setRows] = useState<Record<string, ResourceRow[]>>({ pods: [], deployments: [], services: [], events: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<SelectedResourceTarget | null>(null);
  const [drawerWidth, setDrawerWidth] = useState(initialUiState.drawerWidth ?? 520);
  const [sidebarWidth, setSidebarWidth] = useState(initialUiState.sidebarWidth ?? 236);
  const [languagePreview, setLanguagePreview] = useState<Settings["language"] | null>(null);
  const drawerDirtyRef = useRef(false);
  const pinNextSelectionRef = useRef(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(initialUiState.expandedSections ?? ["namespaces", "rbac", "workloads", "network", "storage", "config", "crd"]));
  const [expandedCrdGroups, setExpandedCrdGroups] = useState<Set<string>>(new Set(initialUiState.expandedCrdGroups ?? []));
  const loadResourcesRef = useRef<number | null>(null);
  const actionReloadRef = useRef<(clusterId: string, resource: string, namespaces: string[]) => Promise<void>>(async () => undefined);
  const crdLoadedClusterRef = useRef<string | null>(null);
  const setSelectedPod = useCallback<Dispatch<SetStateAction<ResourceRow | null>>>(
    (next) => {
      setSelectedTarget((current) => {
        const currentRow = current?.row ?? null;
        const row = typeof next === "function" ? next(currentRow) : next;
        if (!row) return null;
        if (!current) return null;
        return { ...current, row };
      });
    },
    [resourceTab],
  );

  const {
    api,
    config,
    setConfig,
    settings,
    backendOk,
    kubectlVersion,
    activeCluster,
    setActiveCluster,
    unavailableCluster,
    setUnavailableCluster,
    openingClusterId,
    resourceDefinitions,
    runtimeError,
    renameTarget,
    renameDraft,
    setRenameDraft,
    renaming,
    reorderingClusters,
    namespaces,
    setNamespaces,
    selectedNamespaces,
    selectedNamespacesByClusterId,
    namespaceUsage,
    setNamespaceSelection,
    restoreNamespacedSelection,
    importKubeconfig,
    openCluster,
    startRenameCluster,
    cancelRenameCluster,
    confirmRenameCluster,
    removeCluster,
    reorderClusters,
    connectedClusterIds,
    disconnectCluster,
    disconnectTarget,
    disconnecting,
    cancelDisconnectCluster,
  } = useClusterController({
    initialSelectedNamespaces,
    initialSelectedNamespacesByClusterId: initialUiState.namespaceSelectionVersion === 2 ? initialUiState.selectedNamespacesByClusterId : undefined,
    setRows,
    setSelectedRow: setSelectedPod,
    setLoading,
    setError,
  });
  const { loadVisibleNodeDisk } = useNodeDiskUsage({ api, activeCluster, resourceTab, setRows });
  const { bottomTerminals, activeBottomTerminalId, setActiveBottomTerminalId, bottomTerminalOpenToken, openBottomTerminal, openBottomNodeSsh, closeBottomTerminal, removeClusterTerminals } =
    useBottomTerminals({
      activeCluster,
      setError,
    });
  const currentSelectedTarget = currentSelectedResourceTarget(selectedTarget, activeCluster?.id, resourceTab);
  const selectedPod = currentSelectedTarget?.row ?? null;
  const selectedResource = currentSelectedTarget?.resource ?? resourceTab;
  const activeLanguage = languagePreview ?? settings?.language ?? "system";
  const systemLanguageVersion = useAppPreferences(settings, activeLanguage);
  const t = useMemo(() => createTranslator(activeLanguage), [activeLanguage, systemLanguageVersion]);
  const reloadActionResources = useCallback((clusterId: string, resource: string, targetNamespaces: string[]) => actionReloadRef.current(clusterId, resource, targetNamespaces), []);
  const bulkActions = useBulkResourceActions({
    api,
    activeCluster,
    resourceDefinitions,
    selectedResource,
    selectedRow: selectedPod,
    selectedNamespaces,
    setRows,
    setSelectedRow: setSelectedPod,
    setError,
    reloadResources: reloadActionResources,
    t,
  });
  const namespace = selectedNamespaces.length === 1 ? selectedNamespaces[0] : selectedNamespaces.join(",");

  const confirmDrawerNavigation = useCallback(() => !drawerDirtyRef.current || window.confirm("Discard unsaved YAML changes?"), []);

  const {
    query: globalSearch,
    setQuery: setGlobalSearch,
    open: commandPaletteOpen,
    setOpen: setCommandPaletteOpen,
    results: globalSearchResults,
    loading: globalSearchLoading,
  } = useGlobalSearch({ api, activeClusterId: activeCluster?.id, namespace, onError: setError });

  useEffect(() => {
    return () => {
      if (loadResourcesRef.current !== null) window.clearTimeout(loadResourcesRef.current);
    };
  }, []);

  usePersistUiState({
    drawerWidth,
    sidebarWidth,
    expandedSections,
    expandedCrdGroups,
    section,
    resourceTab,
    namespace,
    selectedNamespaces,
    selectedNamespacesByClusterId,
  });

  const loadResources = useResourceLoader({
    api,
    activeCluster,
    resource: resourceTab,
    namespaces: selectedNamespaces,
    setRows,
    setNamespaces,
    setActiveCluster,
    setUnavailableCluster,
    setSelectedRow: setSelectedPod,
    clearPendingActions: bulkActions.clearPendingActions,
    setLoading,
    setError,
  });
  actionReloadRef.current = async (clusterId, resource, targetNamespaces) => {
    await loadResources(clusterId, resource, targetNamespaces);
  };

  // KubeDeck 1.0.5 loading guard: if data is already visible, do not let a stale
  // global loading flag keep table actions and Refresh disabled after startup or
  // temporary cluster unavailability.
  useEffect(() => {
    if (!loading) return undefined;
    if (isPlaceholderSection(section) || section === "overview" || section === "settings" || section === "help" || section === "port-forwards" || section === "problems") return undefined;
    const currentRows = rows[resourceTab] ?? [];
    if (currentRows.length === 0) return undefined;
    const timer = window.setTimeout(() => {
      setLoading(false);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [loading, rows, resourceTab, section]);
  const debouncedLoadResources = useCallback(
    (clusterId = activeCluster?.id, resource = resourceTab, ns: string | string[] = selectedNamespaces, silent = false) => {
      if (loadResourcesRef.current !== null) window.clearTimeout(loadResourcesRef.current);
      loadResourcesRef.current = window.setTimeout(() => {
        loadResources(clusterId, resource, ns, silent);
      }, 100);
    },
    [loadResources, activeCluster?.id, resourceTab, selectedNamespaces],
  );
  const selectedDefinition = findResourceDefinition(resourceDefinitions, resourceTab);
  const isClusterScoped = selectedDefinition?.namespaced === false || namespace === "_cluster";
  const isResourceTableView = !["overview", "help", "about", "settings", "problems", "audit", "port-forwards"].includes(section) && !isPlaceholderSection(section);
  const activeClusterConnected = Boolean(activeCluster && connectedClusterIds.includes(activeCluster.id));
  const watchHealthy = useResourceWatch({
    api,
    clusterId: activeCluster?.id,
    resource: resourceTab,
    namespaces: selectedNamespaces,
    clusterScoped: isClusterScoped,
    // A watch is a long-lived kubectl process, so a disconnected cluster must
    // not have one opened for it - and the backend refuses anyway.
    enabled: isResourceTableView && activeClusterConnected,
    refresh: loadResources,
  });
  const { openResourceLocator, openRelatedResource, consumeKeepSelection, keepCurrentSelection, cancelResourceNavigation } = useResourceNavigation({
    api,
    activeCluster,
    resourceTab,
    selectedTarget,
    namespace,
    selectedNamespaces,
    resourceDefinitions,
    rows,
    setRows,
    setSelectedTarget,
    setResourceTab,
    setSection,
    setExpandedSections,
    setNamespaceSelection,
    rememberedNamespaces: activeCluster ? (selectedNamespacesByClusterId[activeCluster.id] ?? ["all"]) : ["all"],
    setError,
    canNavigate: confirmDrawerNavigation,
  });

  useEffect(() => {
    if (activeCluster) debouncedLoadResources(activeCluster.id, resourceTab, selectedNamespaces);
    if (consumeKeepSelection()) return;
    setSelectedTarget(null);
  }, [resourceTab, selectedNamespaces, activeCluster?.id, debouncedLoadResources, consumeKeepSelection]);

  useEffect(() => {
    if (!activeCluster || !api) return;
    if (crdLoadedClusterRef.current === activeCluster.id && (rows.customresourcedefinitions ?? []).length > 0) return;
    crdLoadedClusterRef.current = activeCluster.id;
    api
      .resources(activeCluster.id, "customresourcedefinitions", "_cluster")
      .then((response) => {
        setRows((current) => ({ ...current, customresourcedefinitions: response.items }));
      })
      .catch((err) => {
        crdLoadedClusterRef.current = null;
        setError(asErrorInfo(err));
      });
  }, [api, activeCluster?.id]);

  useEffect(() => {
    if (!activeCluster || !api || isPlaceholderSection(section) || section === "overview" || section === "settings" || section === "help" || section === "port-forwards" || section === "problems")
      return;
    if (!connectedClusterIds.includes(activeCluster.id)) return;
    const intervalSeconds = getAutoRefreshIntervalSeconds(settings);
    if (!shouldPollResources(intervalSeconds, watchHealthy)) return;
    const timer = window.setInterval(() => {
      loadResources(activeCluster.id, resourceTab, selectedNamespaces, true);
    }, intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [api, activeCluster?.id, resourceTab, selectedNamespaces, section, settings?.refreshIntervalSeconds, loadResources, watchHealthy, connectedClusterIds]);

  // A pods table driven by watch events is not reloaded while nothing about
  // the pods changes, so its usage column would keep whatever the last list
  // load happened to catch - N/A for a pod metrics-server had not reported
  // yet. This refreshes only the usage, from samples KubeDeck already
  // recorded, so it costs no kubectl call.
  useEffect(() => {
    // A disconnected cluster has no samples left to read, so this would poll
    // the store for an empty answer every tick.
    if (!api || !activeCluster || !isPodResourceTab(resourceTab) || !connectedClusterIds.includes(activeCluster.id)) return;
    const namespace = normalizeNamespaceSelection(selectedNamespaces).join(",") || "all";
    let cancelled = false;

    const refresh = async () => {
      try {
        const response = await api.podUsage(activeCluster.id, namespace.includes(",") ? "all" : namespace);
        if (cancelled) return;
        setRows((current) => {
          const rows = current[resourceTab];
          if (!rows) return current;
          const next = applyPodUsage(rows, response.items);
          return next === rows ? current : { ...current, [resourceTab]: next };
        });
      } catch {
        // Usage is a refinement of what the table already shows: failing to
        // read it must never disturb the rows or raise an error banner.
      }
    };

    void refresh();
    // Aligned rather than free-running: the drawer's usage panel reads the same
    // recorded samples on the same interval, and two unaligned timers make the
    // table and the drawer disagree about a pod whose usage is moving.
    const stop = setAlignedInterval(() => void refresh(), POD_USAGE_REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [api, activeCluster?.id, resourceTab, selectedNamespaces, connectedClusterIds]);

  async function saveSettings(next: Settings, apiKeyUpdate?: ApiKeyUpdate) {
    if (!api) return;
    try {
      const normalized = normalizeSettingsSsh(next);
      saveStoredSshDefaults(normalized.ssh);
      const updated = await api.updateSettings(normalized, apiKeyUpdate);
      // An absent `connectedClusterIds` means the response did not carry the
      // runtime state, not that nothing is connected. Treating the two the same
      // turned every cluster in the rail grey on save while the backend was
      // still talking to them.
      setConfig((current) => ({
        ...updated,
        settings: normalizeSettingsSsh(updated.settings),
        connectedClusterIds: updated.connectedClusterIds ?? current?.connectedClusterIds ?? [],
      }));
      setLanguagePreview(null);
      setError(null);
    } catch (err) {
      setError(asErrorInfo(err));
    }
  }

  function selectSection(next: Section) {
    if (!confirmDrawerNavigation()) return;
    cancelResourceNavigation();
    setSection(next);

    if (resourceTree[next]) {
      setExpandedSections((current) => new Set(current).add(next));
    }

    if (next === "nodes") {
      setResourceTab("nodes");
      setNamespaceSelection("_cluster");
      return;
    }

    if (next === "overview") {
      if (selectedNamespaces.includes("_cluster")) restoreNamespacedSelection();
      return;
    }

    if (next === "namespaces") {
      setResourceTab("namespaces");
      setNamespaceSelection("_cluster");
      return;
    }

    if (next === "crd") {
      setResourceTab("customresourcedefinitions");
      setNamespaceSelection("_cluster");
      return;
    }

    if (next === "rbac") {
      setResourceTab("serviceaccounts");
      if (selectedNamespaces.includes("_cluster")) restoreNamespacedSelection();
      return;
    }

    if (next === "workloads") {
      setResourceTab("pods");
      if (selectedNamespaces.includes("_cluster")) restoreNamespacedSelection();
      return;
    }

    if (next === "network") {
      setResourceTab("services");
      if (selectedNamespaces.includes("_cluster")) restoreNamespacedSelection();
      return;
    }

    if (next === "storage") {
      setResourceTab("persistentvolumeclaims");
      if (selectedNamespaces.includes("_cluster")) restoreNamespacedSelection();
      return;
    }

    if (next === "config") {
      setResourceTab("configmaps");
      if (selectedNamespaces.includes("_cluster")) restoreNamespacedSelection();
      return;
    }

    if (next === "events") {
      setResourceTab("events");
      if (selectedNamespaces.includes("_cluster")) restoreNamespacedSelection();
    }
  }

  function toggleSection(sectionId: Section) {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function toggleCrdGroup(group: string) {
    setExpandedCrdGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  function selectTreeResource(sectionId: Section, resource: string) {
    if (!confirmDrawerNavigation()) return;
    cancelResourceNavigation();
    if (resource === "port-forwards") {
      setSection("port-forwards");
      setResourceTab("port-forwards");
      setSelectedTarget(null);
      return;
    }
    setSection(sectionId);
    setResourceTab(resource);
    if (resource === "customresourcedefinitions") {
      setNamespaceSelection("_cluster");
      return;
    }
    const definition = findResourceDefinition(resourceDefinitions, resource);
    if (definition && !definition.namespaced) {
      setNamespaceSelection("_cluster");
    } else if (selectedNamespaces.includes("_cluster")) {
      restoreNamespacedSelection();
    }
  }

  const clusters = config?.clusters ?? [];
  const activeRows = rows[resourceTab] ?? [];
  useEffect(() => {
    if (!activeCluster || !selectedDefinition) return;
    if (selectedDefinition.namespaced === false) {
      if (!selectedNamespaces.includes("_cluster")) setNamespaceSelection("_cluster");
      return;
    }
    if (selectedNamespaces.includes("_cluster")) restoreNamespacedSelection(activeCluster.id);
  }, [activeCluster?.id, selectedDefinition?.namespaced, selectedNamespaces, setNamespaceSelection, restoreNamespacedSelection]);
  const isCrdDefinitionTab = resourceTab === "customresourcedefinitions" || resourceTab === "customresourcedefinitions.apiextensions.k8s.io";
  const isCrdInstanceTab = section === "crd" && !isCrdDefinitionTab;
  const crdGroups = useMemo(() => groupCrds(rows.customresourcedefinitions ?? []), [rows.customresourcedefinitions]);
  const {
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
  } = useResourceWorkspaceTabs({
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
  });
  const commandItems = useCommandPaletteItems({
    t,
    clusters,
    activeCluster,
    crdGroups,
    globalSearchResults,
    activeRows,
    resourceTab,
    namespace,
    resourceDefinitions,
    confirmDrawerNavigation,
    openCluster,
    selectSection,
    selectTreeResource,
    keepCurrentSelection,
    cancelResourceNavigation,
    setSelectedTarget,
    setNamespaceSelection,
    openResourceLocator,
  });
  const resourceTabs = visibleTabs(section, resourceTab);
  const tableColumns = useMemo(() => buildResourceTableColumns(t), [t]);
  const columns =
    tableColumns[resourceTab] ??
    (isCrdInstanceTab
      ? [
          ...(isClusterScoped ? [] : [{ key: "namespace", label: t("col.namespace") }]),
          { key: "kind", label: t("col.kind") },
          { key: "name", label: t("col.name") },
          { key: "apiVersion", label: "API Version" },
          { key: "status", label: t("col.status") },
          { key: "createdAt", label: t("col.age") },
        ]
      : [
          { key: "namespace", label: t("col.namespace") },
          { key: "kind", label: t("col.kind") },
          { key: "name", label: t("col.name") },
          { key: "status", label: t("col.status") },
          { key: "type", label: t("col.type") },
          { key: "createdAt", label: t("col.age") },
        ]);
  function startSidebarResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onMove = (moveEvent: MouseEvent) => {
      setSidebarWidth(Math.min(420, Math.max(188, startWidth + moveEvent.clientX - startX)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
  }

  async function removeClusterWorkspace(cluster: (typeof clusters)[number]) {
    const resourceCount = resourceWorkspaceTabs.filter((tab) => tab.clusterId === cluster.id).length;
    const terminalCount = bottomTerminals.filter((target) => target.clusterId === cluster.id).length;
    if (!window.confirm(`Remove ${cluster.displayName}? This also closes ${resourceCount} resource tab(s) and ${terminalCount} terminal/SSH session(s).`)) return;
    const removed = await removeCluster(cluster, true);
    if (!removed) return;
    removeClusterResourceTabs(cluster.id);
    removeClusterTerminals(cluster.id);
  }

  return (
    <div className="app-shell" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <ClusterRail
        clusters={clusters}
        activeClusterId={activeCluster?.id}
        unavailableClusterId={unavailableCluster?.id}
        openingClusterId={openingClusterId}
        connectedClusterIds={connectedClusterIds}
        railLabel={t("clusters.title")}
        importLabel={t("clusters.import")}
        emptyLabel={t("clusters.empty")}
        openingLabel={t("clusters.opening")}
        connectLabel={t("clusters.connect")}
        disconnectLabel={t("clusters.disconnect.action")}
        connectedLabel={t("clusters.connected")}
        disconnectedLabel={t("clusters.disconnected")}
        onSelect={(cluster) => {
          // A cluster can be active and disconnected at once, when it was
          // disconnected while being viewed. Clicking it then reconnects.
          if (cluster.id === activeCluster?.id && connectedClusterIds.includes(cluster.id)) return;
          if (confirmDrawerNavigation()) void openCluster(cluster);
        }}
        onDisconnect={(cluster) => {
          void disconnectCluster(cluster);
        }}
        onImport={() => {
          void importKubeconfig().catch(() => undefined);
        }}
      />
      <DisconnectClusterModal
        target={disconnectTarget}
        disconnecting={disconnecting}
        t={t}
        onCancel={cancelDisconnectCluster}
        onConfirm={() => {
          if (disconnectTarget) void disconnectCluster(disconnectTarget.cluster, true);
        }}
      />
      <aside className="sidebar">
        <div className="sidebar-resize-handle" onMouseDown={startSidebarResize} role="separator" aria-orientation="vertical" aria-label="Resize resource navigation" />
        <div className="brand">
          <Database size={22} />
          <strong>KubeDeck</strong>
        </div>
        <nav>
          {sections.map((item) => {
            const Icon = item.icon;
            const children = resourceTree[item.id] ?? [];
            const expanded = expandedSections.has(item.id);
            return (
              <div className="nav-group" key={item.id}>
                <button
                  className={section === item.id || (item.id === "network" && section === "port-forwards") ? "active" : ""}
                  onClick={() => (children.length ? toggleSection(item.id) : selectSection(item.id))}
                  aria-expanded={children.length ? expanded : undefined}
                >
                  <Icon size={17} />
                  {t(item.label)}
                  {children.length ? <span className="nav-expander">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span> : null}
                </button>
                {item.id === "crd" && expanded ? (
                  <div className="nav-children">
                    <button
                      className={section === "crd" && resourceTab === "customresourcedefinitions" ? "active child" : "child"}
                      onClick={() => selectTreeResource("crd", "customresourcedefinitions")}
                    >
                      {t("crd.definitions")}
                    </button>
                    {crdGroups.map((group) => (
                      <div className="nav-subgroup" key={group.group}>
                        <button className="nav-subgroup-header" onClick={() => toggleCrdGroup(group.group)} title={group.group}>
                          {expandedCrdGroups.has(group.group) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          <span>{group.group}</span>
                        </button>
                        {expandedCrdGroups.has(group.group) ? (
                          <div className="nav-subgroup-items">
                            {group.items.map((crd) => (
                              <button
                                key={crd.resource}
                                className={section === "crd" && resourceTab === crd.resource ? "active child" : "child"}
                                onClick={() => selectTreeResource("crd", crd.resource)}
                                title={`${crd.kind} (${crd.resource})`}
                              >
                                {crd.kind || crd.plural}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : children.length && expanded ? (
                  <div className="nav-children">
                    {children.map((resource) => (
                      <button
                        key={`${item.id}-${resource}`}
                        className={(section === item.id || (item.id === "network" && section === "port-forwards")) && resourceTab === resource ? "active child" : "child"}
                        onClick={() => selectTreeResource(item.id, resource)}
                      >
                        {resourceLabel(resource)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </aside>
      <main className={resourceTabs.length > 1 ? "workspace" : "workspace workspace-no-tabs"}>
        <header className="topbar">
          <NamespaceSelector
            namespaces={namespaces}
            selected={isClusterScoped ? ["_cluster"] : selectedNamespaces}
            disabled={isClusterScoped}
            allLabel={t("resources.allNamespaces")}
            clusterScopedLabel={t("resources.clusterScoped")}
            searchLabel={t("resources.namespaceSearch")}
            emptySearchLabel={t("resources.namespaceSearchEmpty")}
            recentUsage={namespaceUsage}
            onChange={setNamespaceSelection}
          />
          <label className="global-search" title="Ctrl+K">
            <Search size={16} />
            <input
              value={globalSearch}
              placeholder={`${t("app.search")} / Ctrl+K`}
              onFocus={() => setCommandPaletteOpen(true)}
              onChange={(event) => {
                setGlobalSearch(event.target.value);
                setCommandPaletteOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") setCommandPaletteOpen(true);
                if (event.key === "Escape") setCommandPaletteOpen(false);
              }}
            />
          </label>
          <div className="status-line">
            <span>
              {t("status.backend")}: {backendOk ? t("common.ok") : "..."}
            </span>
            <span>
              {t("status.kubectl")}: {kubectlVersion || "..."}
            </span>
          </div>
        </header>
        {resourceTabs.length > 1 ? (
          <section className="tabs">
            {resourceTabs.map((tab) => (
              <button
                className={resourceTab === tab ? "active" : ""}
                onClick={() => {
                  if (!confirmDrawerNavigation()) return;
                  setResourceTab(tab);
                  if (tab === "nodes") setSection("nodes");
                  if (tab === "events") setSection("events");
                  if (tab === "services") setSection("network");
                  if (tab === "namespaces") setSection("namespaces");
                  if (["serviceaccounts", "roles", "rolebindings", "clusterroles", "clusterrolebindings"].includes(tab)) setSection("rbac");
                  if (tab === "pods" || tab === "deployments") setSection("workloads");
                }}
                key={tab}
              >
                {resourceLabel(tab)}
              </button>
            ))}
          </section>
        ) : null}
        <section className={`content ${bottomTerminals.length ? "with-bottom-terminal" : ""}`}>
          <div className="content-upper">
            <div className={isResourceTableView ? "main-panel main-panel-resource" : "main-panel"} onMouseDown={closeTransientDrawerFromBackground}>
              {runtimeError ? (
                <section className="error-panel">
                  <div className="error-header">
                    <div>
                      <strong>{t("app.desktopRuntimeUnavailable")}</strong>
                      <p>{runtimeError}</p>
                    </div>
                  </div>
                </section>
              ) : null}
              <ErrorPanel error={error} title={error?.code === "TIMEOUT" ? t("cluster.unavailable") : undefined} copyLabel={t("error.copy")} />
              {section === "overview" ? (
                <LazySurface resetKey={`overview:${activeCluster?.id ?? "none"}:${selectedNamespaces.join(",")}`}>
                  <OverviewPanel
                    api={api}
                    cluster={activeCluster}
                    namespaces={selectedNamespaces.includes("_cluster") ? ["all"] : selectedNamespaces}
                    settings={settings}
                    recentTabs={resourceWorkspaceTabs.filter((tab) => tab.clusterId === activeCluster?.id)}
                    terminalCount={bottomTerminals.filter((target) => target.clusterId === activeCluster?.id).length}
                    onError={setError}
                    onNavigate={(resource) => {
                      if (resource === "problems") selectSection("problems");
                      else if (resource === "events") selectSection("events");
                      else {
                        const targetSection = resource === "nodes" ? "nodes" : resource === "persistentvolumeclaims" ? "storage" : "workloads";
                        selectTreeResource(targetSection, resource);
                      }
                    }}
                    onOpenTab={(tab) => void activateResourceTab(tab)}
                    t={t}
                  />
                </LazySurface>
              ) : section === "help" ? (
                <LazySurface resetKey="help">
                  <HelpPanel t={t} />
                </LazySurface>
              ) : section === "about" ? (
                <LazySurface resetKey="about">
                  <AboutPanel api={api} config={config} activeCluster={activeCluster} backendOk={backendOk} kubectlVersion={kubectlVersion} t={t} onError={setError} />
                </LazySurface>
              ) : section === "settings" && config ? (
                <LazySurface resetKey="settings">
                  <SettingsPanel
                    api={api}
                    settings={config.settings}
                    save={saveSettings}
                    onLanguagePreview={setLanguagePreview}
                    t={t}
                    clusters={clusters}
                    activeCluster={activeCluster}
                    selectedNamespaces={selectedNamespaces}
                    resourceTab={resourceTab}
                    openingClusterId={openingClusterId}
                    importKubeconfig={importKubeconfig}
                    openCluster={openCluster}
                    renameCluster={startRenameCluster}
                    removeCluster={removeClusterWorkspace}
                    reorderClusters={reorderClusters}
                    reorderingClusters={reorderingClusters}
                    onError={setError}
                  />
                </LazySurface>
              ) : section === "problems" ? (
                <LazySurface resetKey="problems">
                  <ProblemsPanel
                    api={api}
                    cluster={activeCluster}
                    settings={settings}
                    copyLabel={t("error.copy")}
                    t={t}
                    onError={setError}
                    onOpenResource={(row) => {
                      void openResourceLocator(row);
                    }}
                  />
                </LazySurface>
              ) : section === "port-forwards" ? (
                <LazySurface resetKey="port-forwards">
                  <PortForwardsPanel api={api} cluster={activeCluster} copyLabel={t("error.copy")} t={t} onError={setError} />
                </LazySurface>
              ) : isPlaceholderSection(section) ? (
                <PlaceholderSection section={section} t={t} />
              ) : (
                <>
                  <UnavailableClusterPanel
                    visible={Boolean(unavailableCluster && error)}
                    displayName={unavailableCluster?.displayName ?? ""}
                    opening={Boolean(unavailableCluster && openingClusterId === unavailableCluster.id)}
                    t={t}
                    onRetry={() => {
                      if (unavailableCluster) void openCluster(unavailableCluster);
                    }}
                    onRemove={() => {
                      if (unavailableCluster) void removeClusterWorkspace(unavailableCluster);
                    }}
                  />
                  <DisconnectedClusterPanel
                    visible={Boolean(activeCluster) && !activeClusterConnected && !unavailableCluster}
                    displayName={activeCluster?.displayName ?? ""}
                    connecting={Boolean(activeCluster && openingClusterId === activeCluster.id)}
                    t={t}
                    onConnect={() => {
                      if (activeCluster) void openCluster(activeCluster);
                    }}
                  />
                  {activeCluster && activeClusterConnected ? (
                    <AppResourceTable
                      title={sectionTitle(section, resourceTab, t)}
                      rows={activeRows}
                      columns={columns}
                      loading={loading}
                      resource={resourceTab}
                      onRefresh={() => loadResources()}
                      onNodeAction={bulkActions.requestNodeAction}
                      onVisibleNodeRows={loadVisibleNodeDisk}
                      onOpenLocator={openResourceLocator}
                      onSelect={(selectedRow, resource) => {
                        if (!confirmDrawerNavigation()) return;
                        pinNextSelectionRef.current = false;
                        setActiveResourceTabId(null);
                        cancelResourceNavigation();
                        setSelectedTarget({ clusterId: activeCluster.id, resource, row: selectedRow });
                      }}
                      onPin={(selectedRow, resource) => {
                        if (!confirmDrawerNavigation()) return;
                        pinNextSelectionRef.current = true;
                        cancelResourceNavigation();
                        setSelectedTarget({ clusterId: activeCluster.id, resource, row: selectedRow });
                      }}
                      selectedRow={selectedTarget?.clusterId === activeCluster.id && selectedTarget.resource === resourceTab ? selectedTarget.row : null}
                      onNamespaceClick={(nextNamespace) => setNamespaceSelection(nextNamespace)}
                      canBulkDelete={!isCrdDefinitionTab && canDeleteResource(selectedDefinition)}
                      onBulkDelete={bulkActions.requestBulkDelete}
                      t={t}
                    />
                  ) : null}
                </>
              )}
            </div>
            {resourceWorkspaceTabs.length || selectedPod ? (
              <div className="resource-workspace" style={{ width: drawerWidth }}>
                {resourceWorkspaceTabs.length ? (
                  <ResourceWorkspaceTabs tabs={resourceWorkspaceTabs} activeId={activeResourceTabId} onActivate={(tab) => void activateResourceTab(tab)} onClose={closeResourceTab} />
                ) : null}
                {activeResourceWorkspaceTab?.status && activeResourceWorkspaceTab.status !== "ready" && !selectedPod ? (
                  <section className="resource-workspace-status">
                    <strong>{activeResourceWorkspaceTab.row.name}</strong>
                    <span>{activeResourceWorkspaceTab.status}</span>
                    <button type="button" onClick={() => void activateResourceTab(activeResourceWorkspaceTab)}>
                      Retry
                    </button>
                  </section>
                ) : api && activeCluster && selectedPod && displayedResourceWorkspaceTab ? (
                  <LazySurface resetKey={`drawer:${selectedPod.uid ?? selectedPod.name}`}>
                    <PodDrawer
                      api={api}
                      clusterId={activeCluster.id}
                      pod={selectedPod}
                      resource={selectedResource}
                      canLogs={selectedResource === "pods" || selectedResource === "deployments" || selectedResource === "deployments.apps"}
                      width={drawerWidth}
                      onResize={setDrawerWidth}
                      onActionComplete={() => loadResources(activeCluster.id, selectedResource, selectedNamespaces)}
                      onOpenRelated={openRelatedResource}
                      onDeleteRelatedPods={(rows) => bulkActions.requestBulkDelete("pods", rows)}
                      workspaceTabs={resourceWorkspaceTabs}
                      currentWorkspaceTabId={displayedResourceWorkspaceTab.id}
                      onPortForwardStarted={() => {
                        setSection("port-forwards");
                        setResourceTab("port-forwards");
                      }}
                      onOpenTerminal={openBottomTerminal}
                      onOpenNodeSsh={openBottomNodeSsh}
                      onNodeAction={(action, targetRows) => {
                        void bulkActions.requestNodeAction(action, targetRows);
                      }}
                      initialTab={displayedResourceWorkspaceTab.drawerTab as DrawerTab}
                      onTabChange={(drawerTab) => {
                        rememberResourceDrawerTab(displayedResourceWorkspaceTab.resource, drawerTab);
                        setResourceWorkspaceTabs((current) => {
                          const target = current.find((tab) => tab.id === displayedResourceWorkspaceTab.id);
                          return !target || target.drawerTab === drawerTab ? current : current.map((tab) => (tab.id === target.id ? { ...tab, drawerTab } : tab));
                        });
                      }}
                      onDirtyChange={(dirty) => {
                        drawerDirtyRef.current = dirty;
                      }}
                      onClose={closeDisplayedResource}
                      copyLabel={t("error.copy")}
                      settings={settings}
                      t={t}
                      labels={{ summary: t("drawer.summary"), yaml: t("drawer.yaml"), describe: t("drawer.describe"), logs: t("drawer.logs") }}
                    />
                  </LazySurface>
                ) : null}
              </div>
            ) : null}
          </div>
          {api && bottomTerminals.length && activeBottomTerminalId ? (
            <LazySurface resetKey={`terminal:${activeBottomTerminalId}`}>
              <BottomTerminalPanel
                api={api}
                targets={bottomTerminals}
                activeId={activeBottomTerminalId}
                openToken={bottomTerminalOpenToken}
                settings={settings}
                t={t}
                onActivate={setActiveBottomTerminalId}
                onClose={closeBottomTerminal}
              />
            </LazySurface>
          ) : null}
        </section>
      </main>
      <RenameClusterModal open={Boolean(renameTarget)} draft={renameDraft} renaming={renaming} t={t} onDraftChange={setRenameDraft} onCancel={cancelRenameCluster} onConfirm={confirmRenameCluster} />
      <AppCommandPalette
        open={commandPaletteOpen}
        query={globalSearch}
        items={commandItems}
        loading={globalSearchLoading}
        placeholder={t("app.search")}
        t={t}
        onQueryChange={setGlobalSearch}
        onClose={() => setCommandPaletteOpen(false)}
      />
      <BulkActionModals
        bulkDelete={bulkActions.bulkDelete}
        nodeAction={bulkActions.nodeActionConfirmation}
        t={t}
        onCloseBulkDelete={bulkActions.closeBulkDelete}
        onCopyBulkDelete={() => {
          void bulkActions.copyBulkDeleteList();
        }}
        onConfirmBulkDelete={() => {
          void bulkActions.confirmBulkDelete();
        }}
        onCloseNodeAction={bulkActions.closeNodeAction}
        onConfirmNodeAction={() => {
          void bulkActions.confirmNodeAction();
        }}
      />
    </div>
  );
}
