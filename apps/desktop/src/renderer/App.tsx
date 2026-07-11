import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { CommandPalette, type CommandPaletteItem } from "./components/CommandPalette";
import { BulkActionModals } from "./components/BulkActionModals";
import { ErrorPanel } from "./components/ErrorPanel";
import { NamespaceSelector } from "./components/NamespaceSelector";
import { LazyPanelBoundary } from "./components/LazyPanelBoundary";
import { ResourceTable } from "./components/ResourceTable";
import { PlaceholderSection } from "./components/PlaceholderSection";
import { RenameClusterModal } from "./components/RenameClusterModal";
import { useGlobalSearch } from "./hooks/useGlobalSearch";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useBulkResourceActions } from "./hooks/useBulkResourceActions";
import { useClusterController } from "./hooks/useClusterController";
import { usePersistUiState } from "./hooks/usePersistUiState";
import { useResourceLoader } from "./hooks/useResourceLoader";
import { useResourceNavigation } from "./hooks/useResourceNavigation";
import { useResourceWatch } from "./hooks/useResourceWatch";
import { createTranslator } from "./i18n";
import { brandIcon as Database, isPlaceholderSection, normalizeStoredSection, resourceLabel, resourceTree, sectionTitle, sections, visibleTabs } from "./navigation";
import { canDeleteResource, findResourceDefinition, groupCrds } from "./utils/kubeResources";
import type { ErrorInfo, GlobalSearchItem, ResourceRow, Section, Settings } from "./types";
import { loadUiState } from "./uiState";
import { asErrorInfo } from "./utils/errors";
import { getAutoRefreshIntervalSeconds } from "./utils/refresh";
import { normalizeSettingsSsh, saveStoredSshDefaults } from "./utils/sshDefaults";
import { eventInvolvedLocator } from "./utils/eventResourceLocator";

const initialUiState = typeof window !== "undefined" ? loadUiState() : {};
const initialSection = normalizeStoredSection(initialUiState.section);
const initialResourceTab = initialUiState.section === "overview" || initialSection === "nodes" ? "nodes" : (initialUiState.resourceTab ?? "pods");
const initialSelectedNamespaces = initialSection === "nodes" ? ["_cluster"] : (initialUiState.selectedNamespaces ?? [initialUiState.namespace ?? "all"]);

const AboutPanel = lazy(() => import("./components/AboutPanel").then((module) => ({ default: module.AboutPanel })));
const AuditPanel = lazy(() => import("./components/AuditPanel").then((module) => ({ default: module.AuditPanel })));
const HelpPanel = lazy(() => import("./components/HelpPanel").then((module) => ({ default: module.HelpPanel })));
const PortForwardsPanel = lazy(() => import("./components/PortForwardsPanel").then((module) => ({ default: module.PortForwardsPanel })));
const ProblemsPanel = lazy(() => import("./components/ProblemsPanel").then((module) => ({ default: module.ProblemsPanel })));
const PodDrawer = lazy(() => import("./components/PodDrawer").then((module) => ({ default: module.PodDrawer })));
const SettingsPanel = lazy(() => import("./components/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));

export function App() {
  const [section, setSection] = useState<Section>(initialSection);
  const [resourceTab, setResourceTab] = useState(initialResourceTab);
  const [rows, setRows] = useState<Record<string, ResourceRow[]>>({ pods: [], deployments: [], services: [], events: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [selectedPod, setSelectedPod] = useState<ResourceRow | null>(null);
  const [selectedResource, setSelectedResource] = useState("pods");
  const [drawerWidth, setDrawerWidth] = useState(initialUiState.drawerWidth ?? 520);
  const [sidebarWidth, setSidebarWidth] = useState(initialUiState.sidebarWidth ?? 236);
  const [languagePreview, setLanguagePreview] = useState<Settings["language"] | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(initialUiState.expandedSections ?? ["namespaces", "rbac", "workloads", "network", "storage", "config", "crd"]));
  const [expandedCrdGroups, setExpandedCrdGroups] = useState<Set<string>>(new Set(initialUiState.expandedCrdGroups ?? []));
  const loadResourcesRef = useRef<number | null>(null);
  const actionReloadRef = useRef<(clusterId: string, resource: string, namespaces: string[]) => Promise<void>>(async () => undefined);
  const crdLoadedClusterRef = useRef<string | null>(null);

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
    namespaces,
    setNamespaces,
    selectedNamespaces,
    setNamespaceSelection,
    importKubeconfig,
    openCluster,
    startRenameCluster,
    cancelRenameCluster,
    confirmRenameCluster,
    removeCluster,
  } = useClusterController({
    initialSelectedNamespaces,
    setRows,
    setSelectedRow: setSelectedPod,
    setLoading,
    setError,
  });
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
    if (isPlaceholderSection(section) || section === "settings" || section === "help" || section === "port-forwards" || section === "problems") return undefined;
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
  const { openResourceLocator, openRelatedResource, consumeKeepSelection, keepCurrentSelection, restoreNamespacedSelection } = useResourceNavigation({
    api,
    activeCluster,
    resourceTab,
    selectedResource,
    namespace,
    selectedNamespaces,
    resourceDefinitions,
    rows,
    selectedRow: selectedPod,
    setRows,
    setSelectedRow: setSelectedPod,
    setSelectedResource,
    setResourceTab,
    setSection,
    setExpandedSections,
    setNamespaceSelection,
    setError,
  });

  useEffect(() => {
    if (activeCluster) debouncedLoadResources(activeCluster.id, resourceTab, selectedNamespaces);
    if (consumeKeepSelection()) return;
    setSelectedPod(null);
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
    if (!activeCluster || !api || isPlaceholderSection(section) || section === "settings" || section === "help" || section === "port-forwards" || section === "problems") return;
    const intervalSeconds = getAutoRefreshIntervalSeconds(settings);
    if (intervalSeconds <= 0) return;
    const timer = window.setInterval(() => {
      loadResources(activeCluster.id, resourceTab, selectedNamespaces, true);
    }, intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [api, activeCluster?.id, resourceTab, selectedNamespaces, section, settings?.refreshIntervalSeconds, loadResources]);

  async function saveSettings(next: Settings) {
    if (!api) return;
    try {
      const normalized = normalizeSettingsSsh(next);
      saveStoredSshDefaults(normalized.ssh);
      const updated = await api.updateSettings(normalized);
      setConfig({ ...updated, settings: normalizeSettingsSsh(updated.settings) });
      setLanguagePreview(null);
      setError(null);
    } catch (err) {
      setError(asErrorInfo(err));
    }
  }

  function selectSection(next: Section) {
    setSection(next);

    if (resourceTree[next]) {
      setExpandedSections((current) => new Set(current).add(next));
    }

    if (next === "nodes") {
      setResourceTab("nodes");
      setNamespaceSelection("_cluster");
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
    if (resource === "port-forwards") {
      setSection("port-forwards");
      setResourceTab("port-forwards");
      setSelectedPod(null);
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

  function openGlobalSearchResult(result: GlobalSearchItem) {
    void openResourceLocator(result);
  }

  const clusters = config?.clusters ?? [];
  const activeRows = rows[resourceTab] ?? [];
  const selectedDefinition = findResourceDefinition(resourceDefinitions, resourceTab);
  const isCrdDefinitionTab = resourceTab === "customresourcedefinitions" || resourceTab === "customresourcedefinitions.apiextensions.k8s.io";
  const isCrdInstanceTab = section === "crd" && !isCrdDefinitionTab;
  const isClusterScoped = selectedDefinition?.namespaced === false || namespace === "_cluster";
  const crdGroups = useMemo(() => groupCrds(rows.customresourcedefinitions ?? []), [rows.customresourcedefinitions]);
  const commandItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [];

    for (const item of sections) {
      items.push({
        id: `section:${item.id}`,
        title: t(item.label),
        subtitle: t("command.openSection"),
        category: t("command.category.navigation"),
        keywords: `${item.id} ${t(item.label)}`,
        run: () => selectSection(item.id),
      });
    }

    for (const [sectionId, resources] of Object.entries(resourceTree)) {
      for (const resource of resources) {
        items.push({
          id: `resource:${sectionId}:${resource}`,
          title: resourceLabel(resource),
          subtitle: `${t("command.open")} ${t(`nav.${sectionId}`)}`,
          category: t("command.category.resource"),
          keywords: `${sectionId} ${resource} ${resourceLabel(resource)}`,
          run: () => selectTreeResource(sectionId as Section, resource),
        });
      }
    }

    for (const group of crdGroups) {
      for (const crd of group.items) {
        items.push({
          id: `crd:${crd.resource}`,
          title: crd.kind || crd.plural || crd.resource,
          subtitle: `CRD Р’В· ${group.group}`,
          category: t("nav.crd"),
          keywords: `${crd.kind} ${crd.plural} ${crd.resource} ${group.group}`,
          run: () => selectTreeResource("crd", crd.resource),
        });
      }
    }

    for (const cluster of clusters) {
      items.push({
        id: `cluster:${cluster.id}`,
        title: cluster.displayName,
        subtitle: cluster.id === activeCluster?.id ? t("command.currentCluster") : t("command.openCluster"),
        category: t("command.category.cluster"),
        keywords: `${cluster.displayName} ${cluster.kubeconfigPath}`,
        run: () => {
          void openCluster(cluster);
        },
      });
    }

    for (const row of activeRows.slice(0, 500)) {
      const rowName = String(row.name ?? "");
      if (!rowName) continue;
      const rowNamespace = String(row.namespace ?? "");
      items.push({
        id: `row:${resourceTab}:${rowNamespace}:${rowName}:${String(row.uid ?? rowName)}`,
        title: rowName,
        subtitle: `${resourceLabel(resourceTab)}${rowNamespace ? ` Р’В· ${rowNamespace}` : ""}`,
        category: t("command.category.open"),
        keywords: `${resourceTab} ${rowName} ${rowNamespace} ${String(row.kind ?? "")} ${String(row.status ?? "")} ${String(row.phase ?? "")}`,
        run: () => {
          keepCurrentSelection();
          setSelectedResource(resourceTab);
          setSelectedPod(row);
          if (rowNamespace && rowNamespace !== "_cluster" && namespace !== "_cluster") setNamespaceSelection(rowNamespace);
        },
      });
    }

    for (const result of globalSearchResults) {
      const resource = String(result.resource || "");
      const resultNamespace = String(result.namespace || "");
      const matchedFields = Array.isArray(result.matchedFields) && result.matchedFields.length ? ` Р’В· match: ${result.matchedFields.join(", ")}` : "";
      items.push({
        id: `global:${resource}:${resultNamespace}:${result.name}:${result.uid}`,
        title: String(result.title || result.name || resource),
        subtitle: `${resourceLabel(resource)}${resultNamespace && resultNamespace !== "_cluster" ? ` Р’В· ${resultNamespace}` : ""}${matchedFields}`,
        category: t("command.category.clusterSearch"),
        keywords: `${resource} ${result.name ?? ""} ${resultNamespace} ${result.kind ?? ""} ${result.status ?? ""} ${result.phase ?? ""} ${(result.matchedFields ?? []).join(" ")}`,
        run: () => openGlobalSearchResult(result),
      });
    }

    return items;
  }, [activeRows, activeCluster?.id, clusters, crdGroups, globalSearchResults, namespace, resourceDefinitions, resourceTab, t]);
  const resourceTabs = visibleTabs(section, resourceTab);
  const tableColumns: Record<string, Array<{ key: string; label: string }>> = {
    nodes: [
      { key: "name", label: t("col.name") },
      { key: "status", label: t("col.status") },
      { key: "kubeletVersion", label: t("col.kubernetes") },
      { key: "createdAt", label: t("col.age") },
    ],
    namespaces: [
      { key: "name", label: t("col.name") },
      { key: "status", label: t("col.status") },
      { key: "namespaceResources", label: "CPU/RAM" },
      { key: "createdAt", label: t("col.age") },
    ],
    pods: [
      { key: "namespace", label: t("col.namespace") },
      { key: "name", label: t("col.name") },
      { key: "phase", label: t("col.phase") },
      { key: "ready", label: t("col.ready") },
      { key: "containers", label: t("col.containers") },
      { key: "restarts", label: t("col.restarts") },
      { key: "cpuUsage", label: t("col.cpu") },
      { key: "memoryUsage", label: t("col.memory") },
      { key: "node", label: t("col.node") },
      { key: "createdAt", label: t("col.age") },
    ],
    deployments: [
      { key: "namespace", label: t("col.namespace") },
      { key: "name", label: t("col.name") },
      { key: "ready", label: t("col.ready") },
      { key: "updated", label: t("col.updated") },
      { key: "available", label: t("col.available") },
      { key: "createdAt", label: t("col.age") },
    ],
    services: [
      { key: "namespace", label: t("col.namespace") },
      { key: "name", label: t("col.name") },
      { key: "type", label: t("col.type") },
      { key: "clusterIp", label: t("col.clusterIp") },
      { key: "ports", label: t("col.ports") },
      { key: "createdAt", label: t("col.age") },
    ],
    events: [
      { key: "namespace", label: t("col.namespace") },
      { key: "type", label: t("col.type") },
      { key: "reason", label: t("col.reason") },
      { key: "object", label: t("col.object") },
      { key: "message", label: t("col.message") },
      { key: "createdAt", label: t("col.age") },
    ],
    customresourcedefinitions: [
      { key: "group", label: t("col.group") },
      { key: "kind", label: t("col.kind") },
      { key: "plural", label: t("col.plural") },
      { key: "scope", label: t("col.scope") },
      { key: "versions", label: t("col.versions") },
      { key: "createdAt", label: t("col.age") },
    ],
  };
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
  const isResourceTableView = !["help", "about", "settings", "problems", "audit", "port-forwards"].includes(section) && !isPlaceholderSection(section);

  useResourceWatch({
    api,
    clusterId: activeCluster?.id,
    resource: resourceTab,
    namespaces: selectedNamespaces,
    clusterScoped: isClusterScoped,
    enabled: isResourceTableView,
    refresh: loadResources,
  });

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

  return (
    <div className="app-shell" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <LazyPanelBoundary resetKey={`${section}:${resourceTab}:${selectedPod?.uid ?? "none"}`}>
        <Suspense
          fallback={
            <div className="panel-loading" role="status">
              Loading…
            </div>
          }
        >
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
              <select
                value={activeCluster?.id ?? ""}
                onChange={(event) => {
                  const cluster = clusters.find((item) => item.id === event.target.value);
                  if (cluster) openCluster(cluster);
                }}
                disabled={!clusters.length || Boolean(openingClusterId)}
              >
                {!clusters.length ? <option value="">{t("clusters.none")}</option> : null}
                {clusters.map((cluster) => (
                  <option value={cluster.id} key={cluster.id}>
                    {cluster.displayName}
                  </option>
                ))}
              </select>
              <NamespaceSelector
                namespaces={namespaces}
                selected={isClusterScoped ? ["_cluster"] : selectedNamespaces}
                disabled={isClusterScoped}
                allLabel={t("resources.allNamespaces")}
                clusterScopedLabel={t("resources.clusterScoped")}
                searchLabel={t("resources.namespaceSearch")}
                emptySearchLabel={t("resources.namespaceSearchEmpty")}
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
            <section className="content">
              <div className={isResourceTableView ? "main-panel main-panel-resource" : "main-panel"}>
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
                {bulkActions.message ? (
                  <section className="action-status-panel">
                    <span>{bulkActions.message}</span>
                    <button type="button" onClick={bulkActions.clearMessage}>
                      {t("common.close")}
                    </button>
                  </section>
                ) : null}
                {section === "help" ? (
                  <HelpPanel t={t} />
                ) : section === "about" ? (
                  <AboutPanel api={api} config={config} activeCluster={activeCluster} backendOk={backendOk} kubectlVersion={kubectlVersion} t={t} onError={setError} />
                ) : section === "settings" && config ? (
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
                    removeCluster={removeCluster}
                    onError={setError}
                  />
                ) : section === "problems" ? (
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
                ) : section === "audit" ? (
                  <AuditPanel api={api} copyLabel={t("error.copy")} t={t} onError={setError} />
                ) : section === "port-forwards" ? (
                  <PortForwardsPanel api={api} cluster={activeCluster} copyLabel={t("error.copy")} t={t} onError={setError} />
                ) : isPlaceholderSection(section) ? (
                  <PlaceholderSection section={section} t={t} />
                ) : (
                  <>
                    {unavailableCluster && error ? (
                      <section className="unavailable-panel">
                        <h2>{t("cluster.unavailable")}</h2>
                        <p>{unavailableCluster.displayName}</p>
                        <div className="row-actions">
                          <button className="primary" disabled={openingClusterId === unavailableCluster.id} onClick={() => openCluster(unavailableCluster)}>
                            {openingClusterId === unavailableCluster.id ? t("clusters.opening") : t("common.retry")}
                          </button>
                          <button onClick={() => removeCluster(unavailableCluster)}>{t("clusters.remove")}</button>
                        </div>
                      </section>
                    ) : null}
                    {activeCluster ? (
                      <ResourceTable
                        title={sectionTitle(section, resourceTab, t)}
                        rows={activeRows}
                        columns={columns}
                        loading={loading}
                        onRefresh={() => loadResources()}
                        onBulkCordon={
                          resourceTab === "nodes"
                            ? (selectedRows) => {
                                void bulkActions.requestNodeAction("cordon", selectedRows);
                              }
                            : undefined
                        }
                        onBulkUncordon={
                          resourceTab === "nodes"
                            ? (selectedRows) => {
                                void bulkActions.requestNodeAction("uncordon", selectedRows);
                              }
                            : undefined
                        }
                        onBulkDrain={
                          resourceTab === "nodes"
                            ? (selectedRows) => {
                                void bulkActions.requestNodeAction("drain", selectedRows);
                              }
                            : undefined
                        }
                        onOpen={(row) => {
                          if (resourceTab === "events") {
                            const involved = eventInvolvedLocator(row);
                            if (involved) {
                              void openResourceLocator(involved);
                              return;
                            }
                          }
                          setSelectedPod(row);
                          setSelectedResource(resourceTab);
                        }}
                        selectedRow={selectedResource === resourceTab ? selectedPod : null}
                        onNamespaceClick={(nextNamespace) => setNamespaceSelection(nextNamespace)}
                        onBulkDelete={!isCrdDefinitionTab && canDeleteResource(selectedDefinition) ? (selectedRows) => bulkActions.requestBulkDelete(resourceTab, selectedRows) : undefined}
                        filterLabel={t("resources.filter")}
                        refreshLabel={t("resources.refresh")}
                        labels={{
                          shownOf: t("resources.shownOf"),
                          page: t("resources.page"),
                          deleteSelected: t("resources.deleteSelected"),
                          rows: t("resources.rows"),
                          of: t("resources.of"),
                          pageSize: t("resources.pageSize"),
                          first: t("pagination.first"),
                          prev: t("pagination.prev"),
                          next: t("pagination.next"),
                          last: t("pagination.last"),
                          emptyTitle: t("resources.emptyTitle"),
                          emptyText: t("resources.emptyText"),
                          emptyFilteredTitle: t("resources.emptyFilteredTitle"),
                          emptyFilteredText: t("resources.emptyFilteredText"),
                          clearFilter: t("resources.clearFilter"),
                          columns: t("resources.columns"),
                          resetColumns: t("resources.resetColumns"),
                        }}
                        stateKey={resourceTab}
                      />
                    ) : null}
                  </>
                )}
              </div>
              {api && activeCluster ? (
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
                  onPortForwardStarted={() => {
                    setSection("port-forwards");
                    setResourceTab("port-forwards");
                  }}
                  onClose={() => setSelectedPod(null)}
                  copyLabel={t("error.copy")}
                  settings={settings}
                  t={t}
                  labels={{ summary: t("drawer.summary"), yaml: t("drawer.yaml"), describe: t("drawer.describe"), logs: t("drawer.logs") }}
                />
              ) : null}
            </section>
          </main>
          <RenameClusterModal
            open={Boolean(renameTarget)}
            draft={renameDraft}
            renaming={renaming}
            t={t}
            onDraftChange={setRenameDraft}
            onCancel={cancelRenameCluster}
            onConfirm={confirmRenameCluster}
          />
          {commandPaletteOpen ? (
            <CommandPalette
              query={globalSearch}
              items={commandItems}
              loading={globalSearchLoading}
              placeholder={t("app.search")}
              onQueryChange={setGlobalSearch}
              t={t}
              onClose={() => setCommandPaletteOpen(false)}
              onRun={(item) => {
                setCommandPaletteOpen(false);
                setGlobalSearch("");
                void item.run();
              }}
            />
          ) : null}
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
        </Suspense>
      </LazyPanelBoundary>
    </div>
  );
}
