import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ApiClient } from "../api";
import type { AppConfig, Cluster, ErrorInfo, ResourceDefinition, ResourceRow } from "../types";
import { asErrorInfo } from "../utils/errors";
import { normalizeSettingsSsh } from "../utils/sshDefaults";
import { useNamespaceRefresh } from "./useNamespaceRefresh";

interface Options {
  initialSelectedNamespaces: string[];
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

export function useClusterController({
  initialSelectedNamespaces,
  setRows,
  setSelectedRow,
  setLoading,
  setError,
}: Options) {
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

  const settings = config?.settings;
  const namespaceController = useNamespaceRefresh({
    api,
    activeClusterId: activeCluster?.id,
    settings,
    initialSelectedNamespaces,
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
    void window.kubedeck.getBackendAuth().then(({ baseUrl, token }) => {
      if (cancelled) return;
      const client = new ApiClient(baseUrl, token);
      setApi(client);
      void client.health().then(() => setBackendOk(true)).catch((error) => setError(asErrorInfo(error)));
      void client.config().then((next) => setConfig(normalizeConfig(next))).catch((error) => setError(asErrorInfo(error)));
      void client.kubectlStatus().then((status) => setKubectlVersion(status.version.gitVersion ?? "ok")).catch((error) => setError(asErrorInfo(error)));
      void client.openLastCluster().then((result) => {
        if (cancelled || !result.cluster) return;
        setActiveCluster(result.cluster);
        setUnavailableCluster(null);
        namespaceController.setNamespaces((result.namespaces ?? []).map((item) => item.metadata.name));
        void client.resourceDefinitions(result.cluster.id)
          .then((definitions) => setResourceDefinitions(definitions.items))
          .catch(() => setResourceDefinitions([]));
      }).catch((error) => setError(asErrorInfo(error)));
    }).catch((error) => setError(asErrorInfo(error)));
    return () => { cancelled = true; };
  }, [setError, namespaceController.setNamespaces]);

  useEffect(() => {
    if (!config || !activeCluster) return;
    if (isActiveClusterConfigured(config, activeCluster)) return;
    setActiveCluster(null);
    setUnavailableCluster(null);
    namespaceController.setNamespaces([]);
    setRows({});
    setSelectedRow(null);
  }, [config, activeCluster, namespaceController.setNamespaces, setRows, setSelectedRow]);

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

  const openCluster = useCallback(async (cluster: Cluster, silent = false) => {
    if (!api) return;
    if (!silent) setLoading(true);
    setOpeningClusterId(cluster.id);
    try {
      await api.clearResourceCache(cluster.id).catch(() => undefined);
      const result = await api.openCluster(cluster.id);
      setActiveCluster(result.cluster);
      setUnavailableCluster(null);
      namespaceController.setNamespaces(result.namespaces.map((item) => item.metadata.name));
      setResourceDefinitions((await api.resourceDefinitions(result.cluster.id)).items);
      setError(null);
      await reloadConfig();
    } catch (error) {
      if (!silent) {
        setActiveCluster(null);
        setUnavailableCluster(cluster);
        namespaceController.setNamespaces([]);
        setRows({});
        setError(asErrorInfo(error));
      }
      throw error;
    } finally {
      if (!silent) setLoading(false);
      setOpeningClusterId(null);
    }
  }, [api, namespaceController.setNamespaces, reloadConfig, setError, setLoading, setRows]);

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
    const timer = window.setInterval(() => { if (!cancelled) void retry(); }, 10_000);
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
      setActiveCluster((current) => current?.id === renamed.id ? renamed : current);
      setUnavailableCluster((current) => current?.id === renamed.id ? renamed : current);
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

  const removeCluster = useCallback(async (cluster: Cluster) => {
    if (!api || !window.confirm(`Remove ${cluster.displayName}?`)) return;
    await api.removeCluster(cluster.id);
    setActiveCluster((current) => current?.id === cluster.id ? null : current);
    setUnavailableCluster((current) => current?.id === cluster.id ? null : current);
    await reloadConfig();
  }, [api, reloadConfig]);

  return {
    api, config, setConfig, settings, backendOk, kubectlVersion,
    activeCluster, setActiveCluster, unavailableCluster, setUnavailableCluster,
    openingClusterId, resourceDefinitions, setResourceDefinitions, runtimeError,
    renameTarget, renameDraft, setRenameDraft, renaming,
    reloadConfig, importKubeconfig, openCluster, startRenameCluster,
    cancelRenameCluster, confirmRenameCluster, removeCluster,
    ...namespaceController,
  };
}
