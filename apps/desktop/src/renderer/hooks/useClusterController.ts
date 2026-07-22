import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ApiClient } from "../api";
import type { AppConfig, Cluster, ErrorInfo, ResourceDefinition, ResourceRow } from "../types";
import { asErrorInfo } from "../utils/errors";
import { normalizeSettingsSsh } from "../utils/sshDefaults";
import { useNamespaceRefresh } from "./useNamespaceRefresh";

interface Options {
  initialSelectedNamespaces: string[];
  initialSelectedNamespacesByClusterId?: unknown;
  setRows: Dispatch<SetStateAction<Record<string, ResourceRow[]>>>;
  setSelectedRow: Dispatch<SetStateAction<ResourceRow | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
}

function normalizeConfig(config: AppConfig): AppConfig {
  return { ...config, settings: normalizeSettingsSsh(config.settings) };
}

export function isActiveClusterConfigured(config: AppConfig | null, activeCluster: Cluster | null) {
  return !config || !activeCluster || config.clusters.some((cluster) => cluster.id === activeCluster.id);
}

export function useClusterController({ initialSelectedNamespaces, initialSelectedNamespacesByClusterId, setRows, setSelectedRow, setLoading, setError }: Options) {
  const [api, setApi] = useState<ApiClient | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [backendOk, setBackendOk] = useState(false);
  const [kubectlVersion, setKubectlVersion] = useState("");
  const [activeCluster, setActiveCluster] = useState<Cluster | null>(null);
  const [unavailableCluster, setUnavailableCluster] = useState<Cluster | null>(null);
  const [openingClusterId, setOpeningClusterId] = useState<string | null>(null);
  const [resourceDefinitions, setResourceDefinitions] = useState<ResourceDefinition[]>([]);
  const [runtimeError, setRuntimeError] = useState("");
  const [renameTarget, setRenameTarget] = useState<Cluster | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [reorderingClusters, setReorderingClusters] = useState(false);
  const clusterOpenSequenceRef = useRef(0);

  const settings = config?.settings;
  const namespaceController = useNamespaceRefresh({
    api,
    activeClusterId: activeCluster?.id,
    settings,
    initialSelectedNamespaces,
    initialSelectedNamespacesByClusterId,
    onError: setError,
  });

  const reloadConfig = useCallback(async () => {
    if (!api) return;
    setConfig(normalizeConfig(await api.config()));
  }, [api]);

  useEffect(() => {
    if (!window.kubedeck) {
      setRuntimeError("KubeDeck requires the Electron desktop runtime.");
      return;
    }
    let cancelled = false;
    void window.kubedeck
      .getBackendAuth()
      .then(({ baseUrl, token }) => {
        if (cancelled) return;
        const client = new ApiClient(baseUrl, token);
        setApi(client);
        void client
          .health()
          .then(() => setBackendOk(true))
          .catch((error) => setError(asErrorInfo(error)));
        void client
          .config()
          .then((next) => setConfig(normalizeConfig(next)))
          .catch((error) => setError(asErrorInfo(error)));
        void client
          .kubectlStatus()
          .then((status) => setKubectlVersion(status.version.gitVersion ?? "ok"))
          .catch((error) => setError(asErrorInfo(error)));
        const requestId = clusterOpenSequenceRef.current + 1;
        clusterOpenSequenceRef.current = requestId;
        void client
          .openLastCluster()
          .then(async (result) => {
            if (cancelled || clusterOpenSequenceRef.current !== requestId || !result.cluster) return;
            const definitions = await client.resourceDefinitions(result.cluster.id);
            if (cancelled || clusterOpenSequenceRef.current !== requestId) return;
            namespaceController.activateClusterNamespaces(
              result.cluster.id,
              (result.namespaces ?? []).map((item) => item.metadata.name),
            );
            setActiveCluster(result.cluster);
            setUnavailableCluster(null);
            setResourceDefinitions(definitions.items);
          })
          .catch((error) => {
            if (!cancelled && clusterOpenSequenceRef.current === requestId) setError(asErrorInfo(error));
          });
      })
      .catch((error) => setError(asErrorInfo(error)));
    return () => {
      cancelled = true;
    };
  }, [setError, namespaceController.activateClusterNamespaces]);

  useEffect(() => {
    if (!config || !activeCluster) return;
    if (isActiveClusterConfigured(config, activeCluster)) return;
    setActiveCluster(null);
    setUnavailableCluster(null);
    namespaceController.setNamespaces([]);
    namespaceController.forgetClusterNamespaces(activeCluster.id);
    setRows({});
    setSelectedRow(null);
  }, [config, activeCluster, namespaceController.setNamespaces, namespaceController.forgetClusterNamespaces, setRows, setSelectedRow]);

  const importKubeconfig = useCallback(async () => {
    if (!api) return;
    const source = await window.kubedeck.selectKubeconfig();
    if (!source) return;
    try {
      await api.importCluster(source);
      await reloadConfig();
      setError(null);
    } catch (error) {
      setError(asErrorInfo(error));
      throw error;
    }
  }, [api, reloadConfig, setError]);

  const openCluster = useCallback(
    async (cluster: Cluster, silent = false) => {
      if (!api) return;
      const requestId = clusterOpenSequenceRef.current + 1;
      clusterOpenSequenceRef.current = requestId;
      if (!silent) setLoading(true);
      setOpeningClusterId(cluster.id);
      try {
        await api.clearResourceCache(cluster.id).catch(() => undefined);
        const result = await api.openCluster(cluster.id);
        if (clusterOpenSequenceRef.current !== requestId) return;
        const definitions = await api.resourceDefinitions(result.cluster.id);
        if (clusterOpenSequenceRef.current !== requestId) return;
        namespaceController.activateClusterNamespaces(
          result.cluster.id,
          result.namespaces.map((item) => item.metadata.name),
        );
        setActiveCluster(result.cluster);
        setUnavailableCluster(null);
        setResourceDefinitions(definitions.items);
        setError(null);
        await reloadConfig();
      } catch (error) {
        if (clusterOpenSequenceRef.current !== requestId) return;
        if (!silent && clusterOpenSequenceRef.current === requestId) {
          setActiveCluster(null);
          setUnavailableCluster(cluster);
          namespaceController.setNamespaces([]);
          setRows({});
          setError(asErrorInfo(error));
        }
        throw error;
      } finally {
        if (!silent && clusterOpenSequenceRef.current === requestId) setLoading(false);
        setOpeningClusterId((current) => (current === cluster.id ? null : current));
      }
    },
    [api, namespaceController.activateClusterNamespaces, namespaceController.setNamespaces, reloadConfig, setError, setLoading, setRows],
  );

  useEffect(() => {
    if (!api || !unavailableCluster || openingClusterId) return;
    let cancelled = false;
    let running = false;
    const retry = async () => {
      if (running) return;
      running = true;
      try {
        await openCluster(unavailableCluster, true);
      } catch {
        // The retry screen stays visible until the cluster becomes available.
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => {
      if (!cancelled) void retry();
    }, 10_000);
    void retry();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, unavailableCluster, openingClusterId, openCluster]);

  const startRenameCluster = useCallback((cluster: Cluster) => {
    setRenameTarget(cluster);
    setRenameDraft(cluster.displayName);
  }, []);

  const cancelRenameCluster = useCallback(() => {
    if (renaming) return;
    setRenameTarget(null);
    setRenameDraft("");
  }, [renaming]);

  const confirmRenameCluster = useCallback(async () => {
    if (!api || !renameTarget) return;
    const name = renameDraft.trim();
    if (!name) return;
    setRenaming(true);
    try {
      const renamed = await api.renameCluster(renameTarget.id, name);
      setActiveCluster((current) => (current?.id === renamed.id ? renamed : current));
      setUnavailableCluster((current) => (current?.id === renamed.id ? renamed : current));
      await reloadConfig();
      setRenameTarget(null);
      setRenameDraft("");
      setError(null);
    } catch (error) {
      setError(asErrorInfo(error));
    } finally {
      setRenaming(false);
    }
  }, [api, renameTarget, renameDraft, reloadConfig, setError]);

  const removeCluster = useCallback(
    async (cluster: Cluster, confirmed = false) => {
      if (!api || (!confirmed && !window.confirm(`Remove ${cluster.displayName}?`))) return false;
      await api.removeCluster(cluster.id);
      setActiveCluster((current) => (current?.id === cluster.id ? null : current));
      setUnavailableCluster((current) => (current?.id === cluster.id ? null : current));
      namespaceController.forgetClusterNamespaces(cluster.id);
      await reloadConfig();
      return true;
    },
    [api, namespaceController.forgetClusterNamespaces, reloadConfig],
  );

  const reorderClusters = useCallback(
    async (orderedClusters: Cluster[]) => {
      if (!api || !config || reorderingClusters) return;
      const previousClusters = config.clusters;
      setReorderingClusters(true);
      setConfig((current) => (current ? { ...current, clusters: orderedClusters } : current));
      try {
        const result = await api.reorderClusters(orderedClusters.map((cluster) => cluster.id));
        setConfig((current) => (current ? { ...current, clusters: result.clusters } : current));
        setError(null);
      } catch (error) {
        setConfig((current) => (current ? { ...current, clusters: previousClusters } : current));
        setError(asErrorInfo(error));
      } finally {
        setReorderingClusters(false);
      }
    },
    [api, config, reorderingClusters, setError],
  );

  return {
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
    setResourceDefinitions,
    runtimeError,
    renameTarget,
    renameDraft,
    setRenameDraft,
    renaming,
    reorderingClusters,
    reloadConfig,
    importKubeconfig,
    openCluster,
    startRenameCluster,
    cancelRenameCluster,
    confirmRenameCluster,
    removeCluster,
    reorderClusters,
    ...namespaceController,
  };
}
