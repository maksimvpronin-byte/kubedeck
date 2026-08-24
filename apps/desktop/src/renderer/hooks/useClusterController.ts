import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ApiClient } from "../api";
import { beginBootStage, completeBootStage, failBootStage, finishBoot } from "../bootProgress";
import type { AppConfig, Cluster, ClusterLiveSessions, ErrorInfo, ResourceDefinition, ResourceRow } from "../types";
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
  const [disconnectTarget, setDisconnectTarget] = useState<{ cluster: Cluster; sessions: ClusterLiveSessions } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
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
      failBootStage("gateway", "no Electron runtime");
      return;
    }
    let cancelled = false;
    // The boot screen is on top of the window until this whole chain settles,
    // so every branch through it has to report what it is waiting for.
    beginBootStage("gateway");
    void window.kubedeck
      .getBackendAuth()
      .then(({ baseUrl, token }) => {
        if (cancelled) return;
        const client = new ApiClient(baseUrl, token);
        setApi(client);
        void client
          .health()
          .then(() => {
            setBackendOk(true);
            completeBootStage("gateway");
          })
          .catch((error) => {
            const info = asErrorInfo(error);
            failBootStage("gateway", info.message);
            setError(info);
          });
        beginBootStage("config");
        void client
          .config()
          .then((next) => {
            setConfig(normalizeConfig(next));
            completeBootStage("config");
          })
          .catch((error) => {
            const info = asErrorInfo(error);
            failBootStage("config", info.message);
            setError(info);
          });
        beginBootStage("kubectl");
        void client
          .kubectlStatus()
          .then((status) => {
            setKubectlVersion(status.version.gitVersion ?? "ok");
            completeBootStage("kubectl");
          })
          .catch((error) => {
            const info = asErrorInfo(error);
            failBootStage("kubectl", info.message);
            setError(info);
          });
        const requestId = clusterOpenSequenceRef.current + 1;
        clusterOpenSequenceRef.current = requestId;
        beginBootStage("cluster");
        void client
          .openLastCluster()
          .then(async (result) => {
            if (cancelled || clusterOpenSequenceRef.current !== requestId || !result.cluster) return;
            beginBootStage("cluster", result.cluster.displayName);
            const definitions = await client.resourceDefinitions(result.cluster.id);
            if (cancelled || clusterOpenSequenceRef.current !== requestId) return;
            namespaceController.activateClusterNamespaces(
              result.cluster.id,
              (result.namespaces ?? []).map((item) => item.metadata.name),
            );
            setActiveCluster(result.cluster);
            setUnavailableCluster(null);
            setResourceDefinitions(definitions.items);
            // The config fetch above races this open, so it can answer before
            // the cluster is marked connected. Without this re-read the rail
            // would show the restored cluster as disconnected.
            setConfig(normalizeConfig(await client.config()));
          })
          .catch((error) => {
            if (cancelled || clusterOpenSequenceRef.current !== requestId) return;
            const info = asErrorInfo(error);
            failBootStage("cluster", info.message);
            setError(info);
          })
          // Whether a cluster was restored, there was none to restore or it
          // refused to open, the start is over and the window belongs to the
          // application from here.
          .finally(() => {
            completeBootStage("cluster");
            finishBoot();
          });
      })
      .catch((error) => {
        const info = asErrorInfo(error);
        failBootStage("gateway", info.message);
        setError(info);
      });
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
      if (!silent) setOpeningClusterId(cluster.id);
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
        if (!silent) setOpeningClusterId((current) => (current === cluster.id ? null : current));
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

  // Disconnecting stops the background work this cluster leaves behind - a
  // usage sampler on a timer and one kubectl watch process per resource kind
  // being viewed - which is what makes a rail of many clusters expensive. The
  // first attempt is never forced: if sessions someone may be using are open,
  // the backend refuses and names them, and the confirmation retries.
  const disconnectCluster = useCallback(
    async (cluster: Cluster, force = false) => {
      if (!api) return;
      setDisconnecting(true);
      try {
        const result = await api.disconnectCluster(cluster.id, force);
        if (!result.ok) {
          setDisconnectTarget({ cluster, sessions: result.sessions });
          return;
        }
        setDisconnectTarget(null);
        if (cluster.id === activeCluster?.id) {
          setRows({});
          setSelectedRow(null);
        }
        await reloadConfig();
      } catch (error) {
        setError(asErrorInfo(error));
      } finally {
        setDisconnecting(false);
      }
    },
    [api, reloadConfig, setError, activeCluster?.id, setRows, setSelectedRow],
  );

  const cancelDisconnectCluster = useCallback(() => setDisconnectTarget(null), []);

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
    connectedClusterIds: config?.connectedClusterIds ?? [],
    disconnectCluster,
    disconnectTarget,
    disconnecting,
    cancelDisconnectCluster,
    ...namespaceController,
  };
}
