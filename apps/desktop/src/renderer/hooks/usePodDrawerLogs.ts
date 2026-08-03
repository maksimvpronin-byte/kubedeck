import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ApiClient } from "../api";
import type { DrawerTab } from "../components/PodDrawerChrome";
import { containerNames, downloadTextFile, isAbortError } from "../components/podDrawerHelpers";
import type { ErrorInfo, ResourceRow } from "../types";
import { toErrorInfo } from "../utils/errors";

interface Options {
  api: ApiClient;
  clusterId: string;
  pod: ResourceRow | null;
  resource: string;
  tab: DrawerTab;
  currentObjectKey: string;
  isDeploymentResource: boolean;
  setContent: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
}

export function usePodDrawerLogs({ api, clusterId, pod, resource, tab, currentObjectKey, isDeploymentResource, setContent, setError }: Options) {
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsDownloadLoading, setLogsDownloadLoading] = useState(false);
  const [logsTail, setLogsTail] = useState(500);
  const [logsPrevious, setLogsPrevious] = useState(false);
  const [logsTimestamps, setLogsTimestamps] = useState(false);
  const [logsFollow, setLogsFollow] = useState(false);
  const [logsQuery, setLogsQuery] = useState("");
  const [logsRefreshToken, setLogsRefreshToken] = useState(0);
  const [logsContainer, setLogsContainer] = useState("");
  const [logsPodFilter, setLogsPodFilter] = useState("");
  const [deploymentLogPods, setDeploymentLogPods] = useState<string[]>([]);
  const [deploymentLogContainers, setDeploymentLogContainers] = useState<string[]>([]);

  const podUid = pod?.uid ? String(pod.uid) : "";
  const podName = pod?.name ?? "";
  const podNamespace = pod ? String(pod.namespace || "_cluster") : "";

  useEffect(() => {
    setLogsFollow(false);
    setLogsQuery("");
    setLogsLoading(false);
    setLogsDownloadLoading(false);
    setLogsContainer("");
    setLogsPodFilter("");
    setDeploymentLogPods([]);
    setDeploymentLogContainers([]);
  }, [currentObjectKey]);

  useEffect(() => {
    if (!pod || tab !== "logs") return;
    const controller = new AbortController();

    setLogsLoading(true);
    setError(null);

    if (isDeploymentResource) {
      api
        .deploymentLogTargets(clusterId, String(pod.namespace), pod.name, controller.signal)
        .then((targets) => {
          if (controller.signal.aborted) return "";
          const podNames = targets.pods.map((item) => item.name).filter(Boolean);
          setDeploymentLogPods(podNames);
          setDeploymentLogContainers(targets.containers || []);
          const selectedPod = logsPodFilter && podNames.includes(logsPodFilter) ? logsPodFilter : "";
          if (logsPodFilter && !podNames.includes(logsPodFilter)) setLogsPodFilter("");
          return api.deploymentLogs(
            clusterId,
            String(pod.namespace),
            pod.name,
            {
              tail: logsTail,
              previous: logsPrevious,
              timestamps: logsTimestamps,
              container: logsContainer || undefined,
              pod: selectedPod || undefined,
            },
            controller.signal,
          );
        })
        .then((text) => {
          if (controller.signal.aborted || typeof text !== "string") return;
          setContent((current) => (current === text ? current : text));
        })
        .catch((err) => {
          if (isAbortError(err)) return;
          setError(toErrorInfo(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLogsLoading(false);
        });
      return () => controller.abort();
    }

    const selectedContainer = logsContainer || containerNames(pod)[0] || "";
    api
      .podLogs(
        clusterId,
        String(pod.namespace),
        pod.name,
        {
          tail: logsTail,
          previous: logsPrevious,
          timestamps: logsTimestamps,
          container: selectedContainer || undefined,
        },
        controller.signal,
      )
      .then((text) => {
        if (controller.signal.aborted) return;
        setContent((current) => (current === text ? current : text));
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(toErrorInfo(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLogsLoading(false);
      });
    return () => controller.abort();
  }, [api, clusterId, podUid, podName, podNamespace, resource, isDeploymentResource, tab, logsTail, logsPrevious, logsTimestamps, logsContainer, logsPodFilter, logsRefreshToken]);

  useEffect(() => {
    if (!pod || tab !== "logs" || !logsFollow) return;
    const timer = window.setInterval(() => {
      setLogsRefreshToken((current) => current + 1);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [podUid, tab, logsFollow]);

  async function downloadFullLogs() {
    if (!pod) return;
    setLogsDownloadLoading(true);
    setError(null);
    try {
      if (isDeploymentResource) {
        const text = await api.deploymentLogs(clusterId, String(pod.namespace), pod.name, {
          all: true,
          previous: logsPrevious,
          timestamps: logsTimestamps,
          container: logsContainer || undefined,
          pod: logsPodFilter || undefined,
        });
        downloadTextFile(`${pod.name}.deployment.full.log`, text);
        return;
      }
      const selectedContainer = logsContainer || containerNames(pod)[0] || "";
      const text = await api.podLogs(clusterId, String(pod.namespace), pod.name, {
        all: true,
        previous: logsPrevious,
        timestamps: logsTimestamps,
        container: selectedContainer || undefined,
      });
      downloadTextFile(`${pod.name}.full.log`, text);
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setLogsDownloadLoading(false);
    }
  }

  return {
    logsLoading,
    logsDownloadLoading,
    logsTail,
    setLogsTail,
    logsPrevious,
    setLogsPrevious,
    logsTimestamps,
    setLogsTimestamps,
    logsFollow,
    setLogsFollow,
    logsQuery,
    setLogsQuery,
    logsContainer,
    setLogsContainer,
    logsPodFilter,
    setLogsPodFilter,
    deploymentLogPods,
    deploymentLogContainers,
    downloadFullLogs,
    refreshLogs: () => setLogsRefreshToken((current) => current + 1),
  };
}
