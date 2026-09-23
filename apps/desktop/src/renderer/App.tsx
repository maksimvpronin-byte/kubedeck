import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from "react";
import { AppCommandPalette } from "./components/AppCommandPalette";
import { clusterAccentHue, ClusterRail, clusterRailLabels } from "./components/ClusterRail";
import type { ClusterMenuActions, ClusterMenuLabels } from "./components/ClusterMenu";
import { SidebarClusterHeader } from "./components/SidebarClusterHeader";
import { LazyKubeconfigEditor } from "./components/LazyKubeconfigEditor";
import { BulkActionModals } from "./components/BulkActionModals";
import { ErrorPanel } from "./components/ErrorPanel";
import { LazySurface } from "./components/LazySurface";
import { AppResourceWorkspace } from "./components/AppResourceWorkspace";
import { AppSectionRouter } from "./components/AppSectionRouter";
import { AppSidebar } from "./components/AppSidebar";
import { AppTopbar } from "./components/AppTopbar";
import { DisconnectClusterModal } from "./components/DisconnectClusterModal";
import { RenameClusterModal } from "./components/RenameClusterModal";
import { useGlobalSearch } from "./hooks/useGlobalSearch";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useBulkResourceActions } from "./hooks/useBulkResourceActions";
import { useClusterController } from "./hooks/useClusterController";
import { usePersistUiState } from "./hooks/usePersistUiState";
import { usePodUsageRefresh } from "./hooks/usePodUsageRefresh";
import { useResourceLoader } from "./hooks/useResourceLoader";
import type { ResourceLoadFailure } from "./hooks/useResourceLoader";
import { currentSelectedResourceTarget, useResourceNavigation } from "./hooks/useResourceNavigation";
import type { SelectedResourceTarget } from "./hooks/useResourceNavigation";
import { useResourceWatch } from "./hooks/useResourceWatch";
import { useBottomTerminals } from "./hooks/useBottomTerminals";
import { useCommandPaletteItems } from "./hooks/useCommandPaletteItems";
import { useCrdDefinitions } from "./hooks/useCrdDefinitions";
import { useNodeDiskUsage } from "./hooks/useNodeDiskUsage";
import { useResourceWorkspaceTabs } from "./hooks/useResourceWorkspaceTabs";
import { useSectionNavigation } from "./hooks/useSectionNavigation";
import { buildResourceTableColumns } from "./utils/resourceTableColumns";
import { createTranslator } from "./i18n";
import { isPlaceholderSection, normalizeStoredSection, resourceLabel, sectionForResource, visibleTabs } from "./navigation";
import { findResourceDefinition, groupCrds } from "./utils/kubeResources";
import type { ApiKeyUpdate, Cluster, ErrorInfo, ResourceRow, Section, Settings } from "./types";
import { loadUiState } from "./uiState";
import { asErrorInfo } from "./utils/errors";
import { getAutoRefreshIntervalSeconds, shouldPollResources } from "./utils/refresh";
import { normalizeSettingsSsh, saveStoredSshDefaults } from "./utils/sshDefaults";

// One shared empty array: `rows[tab] ?? []` handed the table a new identity on
// every render, which re-ran its filter and sort memos for nothing.
const NO_ROWS: ResourceRow[] = [];

const initialUiState = typeof window !== "undefined" ? loadUiState() : {};
const initialSection = normalizeStoredSection(initialUiState.section);
const initialResourceTab = initialUiState.section === "overview" || initialSection === "nodes" ? "nodes" : (initialUiState.resourceTab ?? "pods");
const initialSelectedNamespaces = initialSection === "nodes" ? ["_cluster"] : ["all"];

const BottomTerminalPanel = lazy(() => import("./components/BottomTerminalPanel").then((module) => ({ default: module.BottomTerminalPanel })));

export function App() {
  const [section, setSection] = useState<Section>(initialSection);
  const [resourceTab, setResourceTab] = useState(initialResourceTab);
  const [rows, setRows] = useState<Record<string, ResourceRow[]>>({ pods: [], deployments: [], services: [], events: [] });
  const [loading, setLoading] = useState(false);
  const [resourceLoadFailure, setResourceLoadFailure] = useState<ResourceLoadFailure | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<SelectedResourceTarget | null>(null);
  const [drawerWidth, setDrawerWidth] = useState(initialUiState.drawerWidth ?? 520);
  const [sidebarWidth, setSidebarWidth] = useState(initialUiState.sidebarWidth ?? 236);
  const [languagePreview, setLanguagePreview] = useState<Settings["language"] | null>(null);
  const drawerDirtyRef = useRef(false);
  const settingsDirtyRef = useRef(false);
  const pinNextSelectionRef = useRef(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(initialUiState.expandedSections ?? ["namespaces", "rbac", "workloads", "network", "storage", "config", "crd"]));
  const [expandedCrdGroups, setExpandedCrdGroups] = useState<Set<string>>(new Set(initialUiState.expandedCrdGroups ?? []));
  const loadResourcesRef = useRef<number | null>(null);
  const actionReloadRef = useRef<(clusterId: string, resource: string, namespaces: string[]) => Promise<void>>(async () => undefined);
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
  // openCluster puts a failure on screen and rethrows it for callers that wait
  // on the result. A click waits on nothing, and every failed open used to end
  // as an unhandled rejection besides.
  const openClusterFromUi = useCallback(
    (cluster: Cluster) => {
      void openCluster(cluster).catch(() => undefined);
    },
    [openCluster],
  );
  const activeLanguage = languagePreview ?? settings?.language ?? "system";
  const systemLanguageVersion = useAppPreferences(settings, activeLanguage);
  const t = useMemo(() => createTranslator(activeLanguage), [activeLanguage, systemLanguageVersion]);
  const { loadVisibleNodeDisk } = useNodeDiskUsage({ api, activeCluster, resourceTab, setRows });
  const { bottomTerminals, activeBottomTerminalId, setActiveBottomTerminalId, bottomTerminalOpenToken, openBottomTerminal, openBottomNodeSsh, closeBottomTerminal, removeClusterTerminals } =
    useBottomTerminals({
      activeCluster,
      t,
      setError,
    });
  const currentSelectedTarget = currentSelectedResourceTarget(selectedTarget, activeCluster?.id, resourceTab);
  const selectedPod = currentSelectedTarget?.row ?? null;
  const selectedResource = currentSelectedTarget?.resource ?? resourceTab;
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

  // Every way out of what is on screen asks here first: an edited YAML in the
  // drawer, and settings changed but not saved. Settings are asked about only
  // when the move goes to another section - opening a cluster from the rail
  // leaves the settings on screen, and the form with them. The panel reports
  // itself dirty only while it is mounted.
  const confirmDrawerNavigation = useCallback(
    (nextSection?: Section) =>
      (!drawerDirtyRef.current || window.confirm(t("drawer.discardYaml"))) && (!settingsDirtyRef.current || !nextSection || nextSection === "settings" || window.confirm(t("settings.discard"))),
    [t],
  );
  const setSettingsDirty = useCallback((dirty: boolean) => {
    settingsDirtyRef.current = dirty;
  }, []);

  const {
    query: globalSearch,
    setQuery: setGlobalSearch,
    open: commandPaletteOpen,
    setOpen: setCommandPaletteOpen,
    results: globalSearchResults,
    loading: globalSearchLoading,
    notice: globalSearchNotice,
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
    setLoadFailure: setResourceLoadFailure,
  });
  const resourceLoadError =
    resourceLoadFailure && resourceLoadFailure.clusterId === activeCluster?.id && resourceLoadFailure.resource === resourceTab
      ? { message: resourceLoadFailure.error.message, staleSince: resourceLoadFailure.staleSince }
      : null;
  actionReloadRef.current = async (clusterId, resource, targetNamespaces) => {
    await loadResources(clusterId, resource, targetNamespaces);
  };

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

  useCrdDefinitions({ api, clusterId: activeCluster?.id, loaded: (rows.customresourcedefinitions ?? []).length > 0, setRows, onError: setError });

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

  usePodUsageRefresh({ api, activeCluster, connectedClusterIds, resourceTab, selectedNamespaces, setRows });

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

  const { selectSection, selectTreeResource, toggleSection, toggleCrdGroup } = useSectionNavigation({
    selectedNamespaces,
    resourceDefinitions,
    setSection,
    setResourceTab,
    setExpandedSections,
    setExpandedCrdGroups,
    setSelectedTarget,
    setNamespaceSelection,
    restoreNamespacedSelection,
    cancelResourceNavigation,
    confirmDrawerNavigation,
  });

  const clusters = config?.clusters ?? [];
  const clusterAvatars = useMemo(() => clusterRailLabels(clusters), [clusters]);
  // The open cluster as the config lists it, which also carries its API server.
  const headerCluster = activeCluster ? (clusters.find((cluster) => cluster.id === activeCluster.id) ?? activeCluster) : null;
  const [kubeconfigCluster, setKubeconfigCluster] = useState<Cluster | null>(null);
  const activeRows = rows[resourceTab] ?? NO_ROWS;
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
    open: commandPaletteOpen,
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
    openCluster: openClusterFromUi,
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
  // A fresh array here is a fresh identity for the table's filter and sort
  // memos, which re-ran the whole comparison on every App render for CRD and
  // fallback tabs - the two that build their columns inline.
  const columns = useMemo(
    () =>
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
          ]),
    [tableColumns, resourceTab, isCrdInstanceTab, isClusterScoped, t],
  );
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
    const question = t("clusters.removeConfirm").replace("{name}", cluster.displayName).replace("{tabs}", String(resourceCount)).replace("{terminals}", String(terminalCount));
    if (!window.confirm(question)) return;
    // A removal the backend refused used to vanish as an unhandled rejection,
    // leaving the cluster in place with nothing said about why.
    let removed = false;
    try {
      removed = await removeCluster(cluster);
    } catch (error) {
      setError(asErrorInfo(error));
      return;
    }
    if (!removed) return;
    removeClusterResourceTabs(cluster.id);
    removeClusterTerminals(cluster.id);
  }

  // The same menu on the rail and above the resource tree.
  const clusterMenuLabels: ClusterMenuLabels = {
    connect: t("clusters.connect"),
    disconnect: t("clusters.disconnect.action"),
    rename: t("clusters.rename"),
    editKubeconfig: t("clusters.editKubeconfig"),
    settings: t("nav.settings"),
    remove: t("clusters.remove"),
  };
  const clusterMenuActions: Omit<ClusterMenuActions, "onConnect" | "onDisconnect"> = {
    onRename: startRenameCluster,
    onEditKubeconfig: setKubeconfigCluster,
    onOpenSettings: () => selectSection("settings"),
    onRemove: (cluster) => void removeClusterWorkspace(cluster),
  };

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
          if (confirmDrawerNavigation()) openClusterFromUi(cluster);
        }}
        onDisconnect={(cluster) => {
          void disconnectCluster(cluster);
        }}
        onImport={() => {
          void importKubeconfig().catch(() => undefined);
        }}
        menuLabels={clusterMenuLabels}
        menuActions={clusterMenuActions}
      />
      <LazyKubeconfigEditor
        api={api}
        cluster={kubeconfigCluster}
        t={t}
        onClose={() => setKubeconfigCluster(null)}
        onSaved={(cluster) => {
          // The endpoint may have moved, so the open cluster has to be reopened.
          if (cluster.id === activeCluster?.id) openClusterFromUi(cluster);
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
      <AppSidebar
        section={section}
        resourceTab={resourceTab}
        expandedSections={expandedSections}
        expandedCrdGroups={expandedCrdGroups}
        crdGroups={crdGroups}
        t={t}
        onResizeStart={startSidebarResize}
        onSelectSection={selectSection}
        onToggleSection={toggleSection}
        onToggleCrdGroup={toggleCrdGroup}
        onSelectResource={selectTreeResource}
        clusterHeader={
          headerCluster ? (
            <SidebarClusterHeader
              cluster={headerCluster}
              avatar={clusterAvatars.get(headerCluster.id) ?? "?"}
              accentHue={clusterAccentHue(headerCluster.id)}
              connected={connectedClusterIds.includes(headerCluster.id)}
              stateLabel={connectedClusterIds.includes(headerCluster.id) ? t("clusters.connected") : t("clusters.disconnected")}
              labels={clusterMenuLabels}
              actions={{
                ...clusterMenuActions,
                // Offered only while the cluster is disconnected.
                onConnect: (cluster) => {
                  if (confirmDrawerNavigation()) openClusterFromUi(cluster);
                },
                onDisconnect: (cluster) => void disconnectCluster(cluster),
              }}
            />
          ) : undefined
        }
      />
      <main className={resourceTabs.length > 1 ? "workspace" : "workspace workspace-no-tabs"}>
        <AppTopbar
          namespaces={namespaces}
          selectedNamespaces={selectedNamespaces}
          clusterScoped={isClusterScoped}
          namespaceUsage={namespaceUsage}
          globalSearch={globalSearch}
          backendOk={backendOk}
          kubectlVersion={kubectlVersion}
          t={t}
          onNamespaceChange={setNamespaceSelection}
          onGlobalSearchChange={setGlobalSearch}
          onCommandPaletteOpenChange={setCommandPaletteOpen}
        />
        {resourceTabs.length > 1 ? (
          <section className="tabs">
            {resourceTabs.map((tab) => (
              <button
                className={resourceTab === tab ? "active" : ""}
                // The same path as the tree: it also moves the namespace scope to
                // _cluster for ClusterRoles and back, which a hand-kept list of
                // tab-to-section pairs here did not.
                onClick={() => selectTreeResource(sectionForResource(tab) ?? section, tab)}
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
              <ErrorPanel
                error={error}
                title={error?.code === "TIMEOUT" ? t("cluster.unavailable") : undefined}
                copyLabel={t("error.copy")}
                t={t}
                // Retry only when the error is this table's failed load: the same panel
                // also shows errors of searches and actions, which a table reload would not repeat.
                onRetry={error && resourceLoadFailure?.error === error ? () => void loadResources() : undefined}
                onOpenSettings={() => selectSection("settings")}
              />
              <AppSectionRouter
                section={section}
                resourceTab={resourceTab}
                api={api}
                config={config}
                settings={settings}
                clusters={clusters}
                activeCluster={activeCluster}
                activeClusterConnected={activeClusterConnected}
                unavailableCluster={unavailableCluster}
                openingClusterId={openingClusterId}
                reorderingClusters={reorderingClusters}
                backendOk={backendOk}
                kubectlVersion={kubectlVersion}
                selectedNamespaces={selectedNamespaces}
                resourceWorkspaceTabs={resourceWorkspaceTabs}
                bottomTerminals={bottomTerminals}
                error={error}
                rows={activeRows}
                columns={columns}
                loading={loading}
                resourceLoadError={resourceLoadError}
                selectedRow={selectedTarget?.clusterId === activeCluster?.id && selectedTarget?.resource === resourceTab ? selectedTarget.row : null}
                selectedDefinition={selectedDefinition}
                isCrdDefinitionTab={isCrdDefinitionTab}
                t={t}
                onError={setError}
                onSelectSection={selectSection}
                onSelectResource={selectTreeResource}
                onActivateTab={(tab) => void activateResourceTab(tab)}
                onSaveSettings={saveSettings}
                onLanguagePreview={setLanguagePreview}
                onSettingsDirtyChange={setSettingsDirty}
                onImportKubeconfig={() => {
                  // The error is already on screen; the rejection is for callers that wait.
                  void importKubeconfig().catch(() => undefined);
                }}
                onOpenCluster={openClusterFromUi}
                onRenameCluster={startRenameCluster}
                onRemoveCluster={removeClusterWorkspace}
                onReorderClusters={reorderClusters}
                onOpenResourceLocator={openResourceLocator}
                onRefreshResources={() => loadResources()}
                onNodeAction={bulkActions.requestNodeAction}
                onVisibleNodeRows={loadVisibleNodeDisk}
                onSelectRow={(selectedRow, resource) => {
                  if (!activeCluster || !confirmDrawerNavigation()) return;
                  pinNextSelectionRef.current = false;
                  setActiveResourceTabId(null);
                  cancelResourceNavigation();
                  setSelectedTarget({ clusterId: activeCluster.id, resource, row: selectedRow });
                }}
                onPinRow={(selectedRow, resource) => {
                  if (!activeCluster || !confirmDrawerNavigation()) return;
                  pinNextSelectionRef.current = true;
                  cancelResourceNavigation();
                  setSelectedTarget({ clusterId: activeCluster.id, resource, row: selectedRow });
                }}
                onNamespaceClick={(nextNamespace) => setNamespaceSelection(nextNamespace)}
                onBulkDelete={bulkActions.requestBulkDelete}
              />
            </div>
            <AppResourceWorkspace
              api={api}
              clusterId={activeCluster?.id ?? null}
              width={drawerWidth}
              tabs={resourceWorkspaceTabs}
              activeTabId={activeResourceTabId}
              activeTab={activeResourceWorkspaceTab}
              displayedTab={displayedResourceWorkspaceTab}
              row={selectedPod}
              resource={selectedResource}
              settings={settings}
              t={t}
              onActivateTab={(tab) => void activateResourceTab(tab)}
              onCloseTab={closeResourceTab}
              onResize={setDrawerWidth}
              onActionComplete={() => {
                if (activeCluster) loadResources(activeCluster.id, selectedResource, selectedNamespaces);
              }}
              onOpenRelated={openRelatedResource}
              onDeleteRelatedPods={(rows) => bulkActions.requestBulkDelete("pods", rows)}
              onPortForwardStarted={() => {
                setSection("port-forwards");
                setResourceTab("port-forwards");
              }}
              onOpenTerminal={openBottomTerminal}
              onOpenNodeSsh={openBottomNodeSsh}
              onNodeAction={(action, targetRows) => {
                void bulkActions.requestNodeAction(action, targetRows);
              }}
              onDrawerTabChange={(drawerTab) => {
                if (!displayedResourceWorkspaceTab) return;
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
            />
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
        notice={globalSearchNotice}
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
