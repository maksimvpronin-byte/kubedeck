import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { ApiClient } from "./api";
import { CommandPalette, type CommandPaletteItem } from "./components/CommandPalette";
import { ErrorPanel } from "./components/ErrorPanel";
import { NamespaceSelector } from "./components/NamespaceSelector";
import { LazyPanelBoundary } from "./components/LazyPanelBoundary";
import { ResourceTable } from "./components/ResourceTable";
import { useGlobalSearch } from "./hooks/useGlobalSearch";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useNamespaceRefresh } from "./hooks/useNamespaceRefresh";
import { usePersistUiState } from "./hooks/usePersistUiState";
import { useResourceLoader } from "./hooks/useResourceLoader";
import { useResourceWatch } from "./hooks/useResourceWatch";
import { createTranslator } from "./i18n";
import { brandIcon as Database, isPlaceholderSection, normalizeStoredSection, resourceLabel, resourceTree, sectionForResource, sectionTitle, sections, visibleTabs } from "./navigation";
import { canDeleteResource, findResourceDefinition, groupCrds, sameResourceIdentity } from "./utils/kubeResources";
import type { AppConfig, Cluster, ErrorInfo, GlobalSearchItem, ResourceDefinition, ResourceRow, Section, Settings } from "./types";
import { loadUiState } from "./uiState";
import { asErrorInfo } from "./utils/errors";
import { getAutoRefreshIntervalSeconds } from "./utils/refresh";
import { normalizeSettingsSsh, saveStoredSshDefaults } from "./utils/sshDefaults";

const initialUiState = typeof window !== "undefined" ? loadUiState() : {};
const initialSection = normalizeStoredSection(initialUiState.section);
const initialResourceTab = initialUiState.section === "overview" || initialSection === "nodes"
  ? "nodes"
  : initialUiState.resourceTab ?? "pods";
const initialSelectedNamespaces = initialSection === "nodes"
  ? ["_cluster"]
  : initialUiState.selectedNamespaces ?? [initialUiState.namespace ?? "all"];

const AboutPanel = lazy(() => import("./components/AboutPanel").then((module) => ({ default: module.AboutPanel })));
const AuditPanel = lazy(() => import("./components/AuditPanel").then((module) => ({ default: module.AuditPanel })));
const HelpPanel = lazy(() => import("./components/HelpPanel").then((module) => ({ default: module.HelpPanel })));
const PortForwardsPanel = lazy(() => import("./components/PortForwardsPanel").then((module) => ({ default: module.PortForwardsPanel })));
const ProblemsPanel = lazy(() => import("./components/ProblemsPanel").then((module) => ({ default: module.ProblemsPanel })));
const PodDrawer = lazy(() => import("./components/PodDrawer").then((module) => ({ default: module.PodDrawer })));
const SettingsPanel = lazy(() => import("./components/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));

function normalizeConfigSsh(config: AppConfig): AppConfig {
  return {
    ...config,
    settings: normalizeSettingsSsh(config.settings),
  };
}

type BulkDeleteFailure = {
  row: ResourceRow;
  message: string;
};
type NodeActionKind = "cordon" | "uncordon" | "drain";
type NodeActionConfirmation = { action: NodeActionKind; rows: ResourceRow[]; commandPreview: string; affectedPods?: ResourceRow[]; previewLoading?: boolean; previewError?: string; };


export function App() {
  const [api, setApi] = useState<ApiClient | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [backendOk, setBackendOk] = useState(false);
  const [kubectlVersion, setKubectlVersion] = useState("");
  const [activeCluster, setActiveCluster] = useState<Cluster | null>(null);
  const [unavailableCluster, setUnavailableCluster] = useState<Cluster | null>(null);
  const [section, setSection] = useState<Section>(initialSection);
  const [resourceTab, setResourceTab] = useState(initialResourceTab);
  const [resourceDefinitions, setResourceDefinitions] = useState<ResourceDefinition[]>([]);
  const [rows, setRows] = useState<Record<string, ResourceRow[]>>({ pods: [], deployments: [], services: [], events: [] });
  const [loading, setLoading] = useState(false);
  const [openingClusterId, setOpeningClusterId] = useState<string | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [selectedPod, setSelectedPod] = useState<ResourceRow | null>(null);
  const [selectedResource, setSelectedResource] = useState("pods");
  const [drawerWidth, setDrawerWidth] = useState(initialUiState.drawerWidth ?? 520);
  const [sidebarWidth, setSidebarWidth] = useState(initialUiState.sidebarWidth ?? 236);
  const [bulkDelete, setBulkDelete] = useState<{ resource: string; rows: ResourceRow[] } | null>(null); const [nodeActionConfirmation, setNodeActionConfirmation] = useState<NodeActionConfirmation | null>(null); 
  const [bulkActionMessage, setBulkActionMessage] = useState("");
  const [renameTarget, setRenameTarget] = useState<Cluster | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");
  const [languagePreview, setLanguagePreview] = useState<Settings["language"] | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(initialUiState.expandedSections ?? ["namespaces", "rbac", "workloads", "network", "storage", "config", "crd"]));
  const [expandedCrdGroups, setExpandedCrdGroups] = useState<Set<string>>(new Set(initialUiState.expandedCrdGroups ?? []));
  const keepDrawerSelection = useRef(false);
  const lastNamespacedSelectionRef = useRef<string[]>(
    initialSelectedNamespaces.length > 0 && !initialSelectedNamespaces.includes("_cluster")
      ? initialSelectedNamespaces
      : ["all"],
  );
  const loadResourcesRef = useRef<number | null>(null);
  const crdLoadedClusterRef = useRef<string | null>(null);

  const settings = config?.settings;
  const activeLanguage = languagePreview ?? settings?.language ?? "system";
  const systemLanguageVersion = useAppPreferences(settings, activeLanguage);
  const t = useMemo(() => createTranslator(activeLanguage), [activeLanguage, systemLanguageVersion]);
  const {
    namespaces,
    setNamespaces,
    selectedNamespaces,
    setNamespaceSelection,
  } = useNamespaceRefresh({
    api,
    activeClusterId: activeCluster?.id,
    settings,
    initialSelectedNamespaces,
    onError: setError,
  });
  const namespace = selectedNamespaces.length === 1 ? selectedNamespaces[0] : selectedNamespaces.join(",");

  useEffect(() => {
    if (selectedNamespaces.length > 0 && !selectedNamespaces.includes("_cluster")) {
      lastNamespacedSelectionRef.current = selectedNamespaces;
    }
  }, [selectedNamespaces]);

  function restoreLastNamespacedSelection() {
    const remembered = lastNamespacedSelectionRef.current.length > 0
      ? lastNamespacedSelectionRef.current
      : ["all"];
    setNamespaceSelection(remembered);
  }
  const {
    query: globalSearch,
    setQuery: setGlobalSearch,
    open: commandPaletteOpen,
    setOpen: setCommandPaletteOpen,
    results: globalSearchResults,
    loading: globalSearchLoading,
  } = useGlobalSearch({ api, activeClusterId: activeCluster?.id, namespace, onError: setError });

  useEffect(() => {
    if (!window.kubedeck) {
      setRuntimeError(t("app.electronRequired"));
      return;
    }
    window.kubedeck.getBackendAuth().then(({ baseUrl, token }) => {
      const client = new ApiClient(baseUrl, token);
      setApi(client);
      client
        .health()
        .then(() => setBackendOk(true))
        .catch((err) => setError(asErrorInfo(err)));
      client
        .config()
        .then((next) => setConfig(normalizeConfigSsh(next)))
        .catch((err) => setError(asErrorInfo(err)));
      client
        .kubectlStatus()
        .then((status) => setKubectlVersion(status.version.gitVersion ?? "ok"))
        .catch((err) => setError(asErrorInfo(err)));
      client
        .openLastCluster()
        .then((result) => {
          if (result.cluster) {
            setActiveCluster(result.cluster);
            setUnavailableCluster(null);
            setNamespaces((result.namespaces ?? []).map((item) => item.metadata.name));
            client.resourceDefinitions(result.cluster.id).then((defs) => setResourceDefinitions(defs.items)).catch(() => setResourceDefinitions([]));
          }
        })
        .catch((err) => setError(asErrorInfo(err)));
    });
  }, []);

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

  useEffect(() => {
    if (!config || !activeCluster) return;
    if (!config.clusters.some((cluster) => cluster.id === activeCluster.id)) {
      setActiveCluster(null);
      setUnavailableCluster(null);
      setNamespaces([]);
      setRows({});
      setSelectedPod(null);
    }
  }, [config, activeCluster?.id]);

  async function reloadConfig() {
    if (!api) return;
    setConfig(normalizeConfigSsh(await api.config()));
  }

  async function importKubeconfig() {
    if (!api) return;
    const source = await window.kubedeck.selectKubeconfig();
    if (!source) return;
    try {
      await api.importCluster(source);
      await reloadConfig();
      setError(null);
    } catch (err) {
      setError(asErrorInfo(err));
      throw err;
    }
  }

  async function openCluster(cluster: Cluster) {
    if (!api) return;
    setLoading(true);
    setOpeningClusterId(cluster.id); try { await api.clearResourceCache(cluster.id).catch(() => undefined);
      const result = await api.openCluster(cluster.id);
      setActiveCluster(result.cluster);
      setUnavailableCluster(null);
      setNamespaces(result.namespaces.map((item) => item.metadata.name));
      setError(null);
      setResourceDefinitions((await api.resourceDefinitions(result.cluster.id)).items);
      await loadResources(result.cluster.id, resourceTab, selectedNamespaces);
      await reloadConfig();
    } catch (err) {
      setActiveCluster(null);
      setUnavailableCluster(cluster);
      setNamespaces([]);
      setRows({});
      setError(asErrorInfo(err));
    } finally {
      setLoading(false);
      setOpeningClusterId(null);
    }
  }

  function startRenameCluster(cluster: Cluster) {
    setRenameTarget(cluster);
    setRenameDraft(cluster.displayName);
  }

  async function confirmRenameCluster() {
    if (!api || !renameTarget) return;
    const name = renameDraft.trim();
    if (!name) return;
    setRenaming(true);
    try {
      const renamed = await api.renameCluster(renameTarget.id, name);
      if (activeCluster?.id === renamed.id) setActiveCluster(renamed);
      if (unavailableCluster?.id === renamed.id) setUnavailableCluster(renamed);
      await reloadConfig();
      setRenameTarget(null);
      setRenameDraft("");
      setError(null);
    } catch (err) {
      setError(asErrorInfo(err));
    } finally {
      setRenaming(false);
    }
  }

  async function removeCluster(cluster: Cluster) {
    if (!api || !window.confirm(`Remove ${cluster.displayName}?`)) return;
    await api.removeCluster(cluster.id);
    if (activeCluster?.id === cluster.id) setActiveCluster(null);
    if (unavailableCluster?.id === cluster.id) setUnavailableCluster(null);
    await reloadConfig();
  }

  const clearPendingResourceActions = useCallback(() => {
    setBulkDelete(null);
    setNodeActionConfirmation(null);
  }, []);
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
    clearPendingActions: clearPendingResourceActions,
    setLoading,
    setError,
  });

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
    [loadResources, activeCluster?.id, resourceTab, selectedNamespaces]
  );

    useEffect(() => {
    if (!api || !unavailableCluster || openingClusterId) return;
    let cancelled = false;
    let running = false;
    const retryUnavailableCluster = async () => {
      if (running) return;
      running = true;
      try {
        const result = await api.openCluster(unavailableCluster.id);
        if (cancelled) return;
        setActiveCluster(result.cluster);
        setUnavailableCluster(null);
        setNamespaces((result.namespaces ?? []).map((item) => item.metadata.name));
        setError(null);
        api.resourceDefinitions(result.cluster.id)
          .then((defs) => setResourceDefinitions(defs.items))
          .catch(() => setResourceDefinitions([]));
        await loadResources(result.cluster.id, resourceTab, selectedNamespaces, true);
        void reloadConfig();
      } catch {
        // The cluster is still unavailable. Keep the retry screen visible and retry later.
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => { void retryUnavailableCluster(); }, 10000);
    void retryUnavailableCluster();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, unavailableCluster?.id, openingClusterId, resourceTab, selectedNamespaces, loadResources]);
useEffect(() => {
    if (activeCluster) debouncedLoadResources(activeCluster.id, resourceTab, selectedNamespaces);
    if (keepDrawerSelection.current) {
      keepDrawerSelection.current = false;
      return;
    }
    setSelectedPod(null);
  }, [resourceTab, selectedNamespaces, activeCluster?.id, debouncedLoadResources]);

  useEffect(() => {
    if (!activeCluster || !api) return;
    if (crdLoadedClusterRef.current === activeCluster.id && (rows.customresourcedefinitions ?? []).length > 0) return;
    crdLoadedClusterRef.current = activeCluster.id;
    api.resources(activeCluster.id, "customresourcedefinitions", "_cluster")
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

  useEffect(() => {
    if (!selectedPod) return;
    const latest = (rows[selectedResource] ?? []).find((row) =>
      row.uid === selectedPod.uid ||
      (row.name === selectedPod.name && String(row.namespace ?? "") === String(selectedPod.namespace ?? ""))
    );
    if (latest && latest !== selectedPod) setSelectedPod(latest);
  }, [rows, selectedResource, selectedPod?.uid]);

  async function openResourceLocator(locator: ResourceRow) {
    if (!api || !activeCluster) {
      setSelectedPod(locator);
      return;
    }
    const resource = String(locator.resource || selectedResource || resourceTab);
    if (!resource) return;
    const definition = findResourceDefinition(resourceDefinitions, resource);
    const nextSection = sectionForResource(resource) ?? (locator.crdInstance ? "crd" : "workloads");
    const locatorNamespace = String(locator.namespace || "");
    const nextNamespace = definition && !definition.namespaced
    ? "_cluster"
    : locatorNamespace && locatorNamespace !== "_cluster"
      ? locatorNamespace
      : namespace === "_cluster"
        ? (lastNamespacedSelectionRef.current.length === 1 ? lastNamespacedSelectionRef.current[0] : "all")
        : namespace || "all";

    setSection(nextSection);
    if (resourceTree[nextSection]) {
      setExpandedSections((current) => new Set(current).add(nextSection));
    }
    keepDrawerSelection.current = true;
    setResourceTab(resource);
    setSelectedResource(resource);
    setSelectedPod(locator);
    if (definition && !definition.namespaced) {
    setNamespaceSelection("_cluster");
  } else if (nextNamespace && nextNamespace !== "all") {
    setNamespaceSelection(nextNamespace);
  } else if (selectedNamespaces.includes("_cluster")) {
    restoreLastNamespacedSelection();
  }

    try {
      const response = await api.resources(activeCluster.id, resource, nextNamespace);
      const found = response.items.find((item) => sameResourceIdentity(locator, item));
      setRows((current) => ({ ...current, [resource]: response.items }));
      if (found) {
        setSelectedPod(found);
        setError(null);
        return;
      }
      setError({
        code: "PARTIAL_RESULT",
        message: `${resource}/${String(locator.name || "unknown")} was opened from search data, but the live resource list did not contain it. It may have been deleted or filtered by namespace.`,
        rawStderr: "",
        commandPreview: "",
      });
    } catch (err) {
      setError(asErrorInfo(err));
    }
  }

  async function openRelatedResource(resource: string, relatedNamespace: string, name: string) {
    await openResourceLocator({
      uid: `${resource}:${relatedNamespace || "_cluster"}:${name}`,
      resource,
      namespace: relatedNamespace || "_cluster",
      name,
    });
  }

  async function confirmBulkDelete() {
    if (!api || !activeCluster || !bulkDelete) return;
    const target = bulkDelete;

    // Close the confirmation dialog immediately. Bulk deletes can wait for
    // Kubernetes graceful termination on every selected object, so keeping the
    // modal open makes the UI look stuck even though the request was accepted.
    setBulkDelete(null);
    setBulkActionMessage(`${t("bulkDelete.requested")}: ${target.rows.length} ${target.resource}`);
    setError(null);

    const deletingKeys = new Set(target.rows.map(resourceIdentityLabel));
    setRows((current) => {
      const existingRows = current[target.resource];
      if (!existingRows) return current;
      return {
        ...current,
        [target.resource]: existingRows.map((row) => deletingKeys.has(resourceIdentityLabel(row)) ? markDeletingRow(target.resource, row) : row),
      };
    });
    if (selectedResource === target.resource && selectedPod && deletingKeys.has(resourceIdentityLabel(selectedPod))) {
      setSelectedPod(markDeletingRow(target.resource, selectedPod));
    }

    const deletedRows: ResourceRow[] = [];
    const failures: BulkDeleteFailure[] = [];
    try {
      for (const row of target.rows) {
        try {
          await api.resourceAction(activeCluster.id, target.resource, namespaceForAction(target.resource, row), row.name, "delete");
          deletedRows.push(row);
        } catch (err) {
          const info = asErrorInfo(err);
          failures.push({ row, message: info.message || info.code || "Delete failed" });
        }
      }

      if (deletedRows.length > 0) {
        const deletedKeys = new Set(deletedRows.map((row) => `${row.namespace ?? "_cluster"}/${row.name}`));
        if (selectedResource === target.resource && selectedPod && deletedKeys.has(`${selectedPod.namespace ?? "_cluster"}/${selectedPod.name}`)) {
          setSelectedPod(null);
        }
        try {
          await loadResources(activeCluster.id, target.resource, selectedNamespaces);
        } catch (err) {
          setError(asErrorInfo(err));
        }
      }

      if (failures.length > 0) {
        const message = `${t("bulkDelete.partialResult")}. ${t("bulkDelete.deleted")}: ${deletedRows.length}. ${t("bulkDelete.failed")}: ${failures.length}.`;
        setBulkActionMessage(message);
        setError({
          code: "PARTIAL_RESULT",
          message,
          rawStderr: failures.map((item) => `${target.resource} ${resourceIdentityLabel(item.row)} РІР‚вЂќ ${item.message}`).join("\n"),
          commandPreview: "",
        });
        return;
      }

      setBulkActionMessage(`${t("bulkDelete.completed")}. ${t("bulkDelete.deleted")}: ${deletedRows.length}.`);
      setError(null);
    } catch (err) {
      setBulkActionMessage(t("bulkDelete.failedMessage"));
      setError(asErrorInfo(err));
    }
  }  async function runBulkNodeAction(action: NodeActionKind, selectedRows: ResourceRow[]) {
    if (!api || !activeCluster || selectedRows.length === 0) return;

    const commandPreview = selectedRows
      .map((row) =>
        action === "drain"
          ? `kubectl drain ${row.name} --ignore-daemonsets --delete-emptydir-data --timeout=300s`
          : `kubectl ${action} ${row.name}`,
      )
      .join("\n");

    if (action !== "drain") {
      setNodeActionConfirmation({ action, rows: selectedRows, commandPreview });
      return;
    }

    const nodeNames = new Set(selectedRows.map((row) => String(row.name)));
    setNodeActionConfirmation({ action, rows: selectedRows, commandPreview, affectedPods: [], previewLoading: true });

    try {
      const response = await api.resources(activeCluster.id, "pods", "all", undefined, { useCache: false, forceRefresh: true });
      const affectedPods = response.items
        .filter((pod) => nodeNames.has(String(pod.node ?? "")))
        .sort((a, b) => `${a.namespace ?? ""}/${a.name}`.localeCompare(`${b.namespace ?? ""}/${b.name}`, undefined, { numeric: true }));
      setNodeActionConfirmation({ action, rows: selectedRows, commandPreview, affectedPods, previewLoading: false });
    } catch (err) {
      const info = asErrorInfo(err);
      setNodeActionConfirmation({
        action,
        rows: selectedRows,
        commandPreview,
        affectedPods: [],
        previewLoading: false,
        previewError: info.message || info.code || "Failed to load affected pods preview",
      });
    }
  }



  async function confirmBulkNodeAction() {
    if (!api || !activeCluster || !nodeActionConfirmation) return;

    const target = nodeActionConfirmation;
    const action = target.action;
    const actionLabel = nodeActionLabel(action);
    const commandPreview = target.commandPreview;

    setNodeActionConfirmation(null);
    setBulkActionMessage(`${actionLabel} requested: ${target.rows.length} node(s)`);
    setError(null);

    const completedRows: ResourceRow[] = [];
    const failures: BulkDeleteFailure[] = [];

    for (const row of target.rows) {
      try {
        await api.resourceAction(activeCluster.id, "nodes", "_cluster", row.name, action);
        completedRows.push(row);
      } catch (err) {
        const info = asErrorInfo(err);
        failures.push({ row, message: info.message || info.code || `${actionLabel} failed` });
      }
    }

    try {
      await loadResources(activeCluster.id, "nodes", ["_cluster"]);
    } catch (err) {
      setError(asErrorInfo(err));
    }

    if (failures.length > 0) {
      const message = `${actionLabel} partial result. Completed: ${completedRows.length}. Failed: ${failures.length}.`;
      setBulkActionMessage(message);
      setError({
        code: "PARTIAL_RESULT",
        message,
        rawStderr: failures.map((item) => `nodes ${resourceIdentityLabel(item.row)} - ${item.message}`).join("\n"),
        commandPreview,
      });
      return;
    }

    setBulkActionMessage(`${actionLabel} completed. Nodes: ${completedRows.length}.`);
    setError(null);
  }

  function closeNodeActionConfirmation() {
    setNodeActionConfirmation(null);
  }

  function nodeActionLabel(action: NodeActionKind) {
    if (action === "cordon") return "Cordon";
    if (action === "uncordon") return "Uncordon";
    return "Drain";
  }

  function nodeActionTitle(action: NodeActionKind) {
    if (action === "cordon") return "Cordon selected nodes";
    if (action === "uncordon") return "Uncordon selected nodes";
    return "Drain selected nodes";
  }



async function copyBulkDeleteList() {
    if (!bulkDelete || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(bulkDeleteListText(bulkDelete.resource, bulkDelete.rows));
    } catch (err) {
      setError(asErrorInfo(err));
    }
  }

  function closeBulkDeleteModal() {
    setBulkDelete(null);
  }

  function namespaceForAction(resource: string, row: ResourceRow) {
    const definition = findResourceDefinition(resourceDefinitions, resource);
    if (definition && !definition.namespaced) return "_cluster";
    return String(row.namespace || "_cluster");
  }

  async function saveSettings(next: Settings) {
    if (!api) return;
    try {
      const normalized = normalizeSettingsSsh(next);
      saveStoredSshDefaults(normalized.ssh);
      setConfig(normalizeConfigSsh(await api.updateSettings(normalized)));
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
    if (selectedNamespaces.includes("_cluster")) restoreLastNamespacedSelection();
    return;
  }

  if (next === "workloads") {
    setResourceTab("pods");
    if (selectedNamespaces.includes("_cluster")) restoreLastNamespacedSelection();
    return;
  }

  if (next === "network") {
    setResourceTab("services");
    if (selectedNamespaces.includes("_cluster")) restoreLastNamespacedSelection();
    return;
  }

  if (next === "storage") {
    setResourceTab("persistentvolumeclaims");
    if (selectedNamespaces.includes("_cluster")) restoreLastNamespacedSelection();
    return;
  }

  if (next === "config") {
    setResourceTab("configmaps");
    if (selectedNamespaces.includes("_cluster")) restoreLastNamespacedSelection();
    return;
  }

  if (next === "events") {
    setResourceTab("events");
    if (selectedNamespaces.includes("_cluster")) restoreLastNamespacedSelection();
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
    restoreLastNamespacedSelection();
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
        run: () => { void openCluster(cluster); },
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
          keepDrawerSelection.current = true;
          setSelectedResource(resourceTab);
          setSelectedPod(row);
          if (rowNamespace && rowNamespace !== "_cluster" && namespace !== "_cluster") setNamespaceSelection(rowNamespace);
        },
      });
    }

    for (const result of globalSearchResults) {
      const resource = String(result.resource || "");
      const resultNamespace = String(result.namespace || "");
      const matchedFields = Array.isArray(result.matchedFields) && result.matchedFields.length
        ? ` Р’В· match: ${result.matchedFields.join(", ")}`
        : "";
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
    namespaces: [ { key: "name", label: t("col.name") }, { key: "status", label: t("col.status") }, { key: "namespaceResources", label: "CPU/RAM" }, { key: "createdAt", label: t("col.age") }, ],
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
  const columns = tableColumns[resourceTab] ?? (isCrdInstanceTab ? [
    ...(isClusterScoped ? [] : [{ key: "namespace", label: t("col.namespace") }]),
    { key: "kind", label: t("col.kind") },
    { key: "name", label: t("col.name") },
    { key: "apiVersion", label: "API Version" },
    { key: "status", label: t("col.status") },
    { key: "createdAt", label: t("col.age") },
  ] : [
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
      <LazyPanelBoundary>
      <Suspense fallback={<div className="panel-loading" role="status">Loading…</div>}>
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
                  onClick={() => children.length ? toggleSection(item.id) : selectSection(item.id)}
                  aria-expanded={children.length ? expanded : undefined}
                >
                  <Icon size={17} />
                  {t(item.label)}
                  {children.length ? (
                    <span className="nav-expander">
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                  ) : null}
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
            <span>{t("status.backend")}: {backendOk ? t("common.ok") : "..."}</span>
            <span>{t("status.kubectl")}: {kubectlVersion || "..."}</span>
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
            {bulkActionMessage ? (
              <section className="action-status-panel">
                <span>{bulkActionMessage}</span>
                <button type="button" onClick={() => setBulkActionMessage("")}>{t("common.close")}</button>
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
                    onRefresh={() => loadResources()} onBulkCordon={resourceTab === "nodes" ? (selectedRows) => { void runBulkNodeAction("cordon", selectedRows); } : undefined} onBulkUncordon={resourceTab === "nodes" ? (selectedRows) => { void runBulkNodeAction("uncordon", selectedRows); } : undefined} onBulkDrain={resourceTab === "nodes" ? (selectedRows) => { void runBulkNodeAction("drain", selectedRows); } : undefined}
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
                    onBulkDelete={!isCrdDefinitionTab && canDeleteResource(selectedDefinition) ? (selectedRows) => { setBulkActionMessage(""); setBulkDelete({ resource: resourceTab, rows: selectedRows }); } : undefined}
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
      {renameTarget ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="rename-cluster-title">
            <header>
              <h2 id="rename-cluster-title">{t("clusters.renameTitle")}</h2>
              <button className="icon-button" onClick={() => setRenameTarget(null)} disabled={renaming} title={t("common.close")}>
                <X size={16} />
              </button>
            </header>
            <div className="confirm-body">
              <label className="confirm-field">
                {t("clusters.name")}
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") confirmRenameCluster();
                    if (event.key === "Escape") setRenameTarget(null);
                  }}
                />
              </label>
            </div>
            <footer>
              <button onClick={() => setRenameTarget(null)} disabled={renaming}>{t("common.cancel")}</button>
              <button className="primary" onClick={confirmRenameCluster} disabled={renaming || !renameDraft.trim()}>
                {renaming ? t("common.renaming") : t("common.rename")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
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
      {nodeActionConfirmation ? (
        <div
          className="node-action-confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeNodeActionConfirmation();
          }}
        >
          <div
            className="node-action-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="node-action-confirm-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="node-action-confirm-header">
              <div>
                <div className="node-action-confirm-kicker">Node action</div>
                <h2 id="node-action-confirm-title">
                  {nodeActionTitle(nodeActionConfirmation.action)}
                </h2>
                <p>
                  {nodeActionConfirmation.rows.length} node(s) selected. Review the command preview before confirming.
                </p>
              </div>
              <button className="icon-button" type="button" aria-label="Close" onClick={closeNodeActionConfirmation}>
                <X size={16} />
              </button>
            </div>

            <div className="node-action-confirm-section">
              <div className="node-action-confirm-label">Affected nodes</div>
              <div className="node-action-confirm-node-list">
                {nodeActionConfirmation.rows.map((row) => (
                  <code key={resourceIdentityLabel(row)}>{String(row.name)}</code>
                ))}
              </div>
            </div>

            {nodeActionConfirmation.action === "drain" ? (
              <div className="node-action-confirm-section">
                <div className="node-action-confirm-label">Affected pods preview</div>
                {nodeActionConfirmation.previewLoading ? (
                  <p className="node-drain-preview-muted">Loading pods on selected nodes...</p>
                ) : nodeActionConfirmation.previewError ? (
                  <pre className="node-action-confirm-command node-drain-preview-error">{nodeActionConfirmation.previewError}</pre>
                ) : nodeActionConfirmation.affectedPods && nodeActionConfirmation.affectedPods.length > 0 ? (
                  <div className="node-drain-pod-list">
                    {nodeActionConfirmation.affectedPods.map((pod) => (
                      <div className="node-drain-pod-row" key={resourceIdentityLabel(pod)}>
                        <code>{String(pod.namespace ?? "_cluster")}/{String(pod.name)}</code>
                        <span>{String(pod.node ?? "")}</span>
                        <span>{String(pod.status ?? pod.phase ?? "")}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="node-drain-preview-muted">No pods were found on the selected node(s).</p>
                )}
              </div>
            ) : null}

            <div className="node-action-confirm-section">
              <div className="node-action-confirm-label">Command preview</div>
              <pre className="node-action-confirm-command">{nodeActionConfirmation.commandPreview}</pre>
            </div>

            <div className="node-action-confirm-actions">
              <button className="secondary" type="button" onClick={closeNodeActionConfirmation}>
                Cancel
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => {
                  void confirmBulkNodeAction();
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null} {bulkDelete ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal bulk-delete-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-title">
            <header>
              <h2 id="bulk-delete-title">{t("bulkDelete.title")}</h2>
              <button className="icon-button" onClick={closeBulkDeleteModal} title={t("common.close")}>
                <X size={16} />
              </button>
            </header>
            <div className="confirm-body">
              <p>{t("bulkDelete.text")} <strong>{bulkDelete.rows.length}</strong>. {t("bulkDelete.warning")}</p>
              <div className="bulk-delete-meta" aria-label="Bulk delete scope">
                <span>{t("bulkDelete.resource")}: <strong>{bulkDelete.resource}</strong></span>
                <span>{t("bulkDelete.namespaces")}: <strong>{bulkDeleteNamespaceSummary(bulkDelete.rows)}</strong></span>
              </div>
              <div className="bulk-delete-list-header">
                <span>{t("bulkDelete.resources")}</span>
                <button type="button" onClick={() => void copyBulkDeleteList()}>{t("bulkDelete.copyList")}</button>
              </div>
              <pre className="bulk-delete-list">{bulkDeleteListText(bulkDelete.resource, bulkDelete.rows)}</pre>
            </div>
            <footer>
              <button onClick={closeBulkDeleteModal}>
                {t("common.cancel")}
              </button>
              <button className="danger" onClick={confirmBulkDelete}>
                {t("common.delete")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      </Suspense>
      </LazyPanelBoundary>
    </div>
  );
}


function resourceIdentityLabel(row: ResourceRow) {
  return `${row.namespace || "_cluster"}/${row.name}`;
}

function markDeletingRow(resource: string, row: ResourceRow): ResourceRow {
  const next: ResourceRow = {
    ...row,
    deletionTimestamp: typeof row.deletionTimestamp === "string" && row.deletionTimestamp ? row.deletionTimestamp : new Date().toISOString(),
    status: "Terminating",
  };
  if (resource === "pods" || resource === "pod") {
    next.phase = "Terminating";
  }
  return next;
}

function bulkDeleteListText(resource: string, rows: ResourceRow[]) {
  return rows.map((row) => `${resource} ${resourceIdentityLabel(row)}`).join("\n");
}

function bulkDeleteNamespaceSummary(rows: ResourceRow[]) {
  const namespaces = Array.from(new Set(rows.map((row) => row.namespace || "_cluster"))).sort();
  if (namespaces.length <= 3) return namespaces.join(", ");
  return `${namespaces.slice(0, 3).join(", ")} +${namespaces.length - 3}`;
}

function eventInvolvedLocator(row: ResourceRow): ResourceRow | null {
  const objectText = readRowString(row, "object") || readRowString(row, "involvedObject");
  const parsed = parseKindName(objectText);
  const kind = readRowString(row, "involvedKind") || parsed.kind;
  const name = readRowString(row, "involvedName") || parsed.name;
  const resource = resourceForKubernetesKind(kind);
  if (!resource || !name) return null;
  return {
    uid: `${resource}:${readRowString(row, "involvedNamespace") || readRowString(row, "namespace") || "_cluster"}:${name}`,
    resource,
    kind,
    name,
    namespace: readRowString(row, "involvedNamespace") || readRowString(row, "namespace") || "_cluster",
  };
}

function parseKindName(value: string) {
  const [kind = "", ...nameParts] = value.split("/");
  return { kind, name: nameParts.join("/") };
}

function readRowString(row: ResourceRow, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

function resourceForKubernetesKind(kind: string) {
  const map: Record<string, string> = {
    Pod: "pods",
    ReplicaSet: "replicasets",
    Deployment: "deployments",
    StatefulSet: "statefulsets",
    DaemonSet: "daemonsets",
    Job: "jobs",
    CronJob: "cronjobs",
    Service: "services",
    ConfigMap: "configmaps",
    Secret: "secrets",
    ServiceAccount: "serviceaccounts",
    Role: "roles",
    RoleBinding: "rolebindings",
    ClusterRole: "clusterroles",
    ClusterRoleBinding: "clusterrolebindings",
    Node: "nodes",
    Ingress: "ingresses",
    Endpoints: "endpoints",
    EndpointSlice: "endpointslices",
    PersistentVolumeClaim: "persistentvolumeclaims",
    PersistentVolume: "persistentvolumes",
    StorageClass: "storageclasses",
    Namespace: "namespaces",
  };
  return map[kind];
}

function PlaceholderSection({ section, t }: { section: Section; t: (key: string) => string }) {
  const notes: Record<string, string> = {
    problems: "Problems engine placeholder. Live diagnostics will be added in the next stage.",
    terminal: "Pod terminal is planned for a later stage.",
  };
  return (
    <section className="placeholder-page">
      <h2>{t(`nav.${section}`)}</h2>
      <p>{notes[section]}</p>
    </section>
  );
}
