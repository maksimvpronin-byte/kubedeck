import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from "react";
import { AppCommandPalette } from "./components/AppCommandPalette";
import { ClusterRail } from "./components/ClusterRail";
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
import { currentSelectedResourceTarget, useResourceNavigation } from "./hooks/useResourceNavigation";
import type { SelectedResourceTarget } from "./hooks/useResourceNavigation";
import { useResourceWatch } from "./hooks/useResourceWatch";
import { useBottomTerminals } from "./hooks/useBottomTerminals";
import { useCommandPaletteItems } from "./hooks/useCommandPaletteItems";
import { useNodeDiskUsage } from "./hooks/useNodeDiskUsage";
import { useResourceWorkspaceTabs } from "./hooks/useResourceWorkspaceTabs";
import { useSectionNavigation } from "./hooks/useSectionNavigation";
import { buildResourceTableColumns } from "./utils/resourceTableColumns";
import { createTranslator } from "./i18n";
import { isPlaceholderSection, normalizeStoredSection, resourceLabel, visibleTabs } from "./navigation";
import { findResourceDefinition, groupCrds } from "./utils/kubeResources";
import type { ApiKeyUpdate, ErrorInfo, ResourceRow, Section, Settings } from "./types";
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
                onImportKubeconfig={importKubeconfig}
                onOpenCluster={openCluster}
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
