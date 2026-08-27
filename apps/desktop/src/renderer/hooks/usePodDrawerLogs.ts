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

  // Following a pod is a stream (see below); the one-shot load is what fills
  // the tab before that, and what serves deployments, which read many pods.
  const streaming = Boolean(pod) && tab === "logs" && logsFollow && !isDeploymentResource;

  useEffect(() => {
    if (!pod || tab !== "logs" || streaming) return;
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
  }, [api, clusterId, podUid, podName, podNamespace, resource, isDeploymentResource, tab, streaming, logsTail, logsPrevious, logsTimestamps, logsContainer, logsPodFilter, logsRefreshToken]);

  // Following used to re-run `kubectl logs --tail=500` every three seconds and
  // transfer the whole tail again, whatever had changed. One socket carries one
  // `kubectl logs -f`, and lines arrive as the pod writes them.
  useEffect(() => {
    if (!streaming || !pod) return;
    const container = logsContainer || containerNames(pod)[0] || "";
    let socket: WebSocket | null = null;
    let closed = false;
    let reconnect: number | null = null;
    // Lines are appended in batches rather than one setState per line.
    let buffered: string[] = [];
    let flush: number | null = null;

    const commit = () => {
      flush = null;
      if (closed || buffered.length === 0) return;
      const appended = buffered.join("\n");
      buffered = [];
      setContent((current) => (current ? `${current}\n${appended}` : appended));
    };

    const connect = () => {
      if (closed) return;
      setLogsLoading(true);
      const next = new WebSocket(api.podLogsStreamUrl(clusterId, podNamespace, podName, { container, tail: logsTail, timestamps: logsTimestamps, previous: logsPrevious }));
      socket = next;

      next.onopen = () => {
        if (socket !== next || closed) return;
        setLogsLoading(false);
        setError(null);
        // The stream starts from its own tail, so the tab starts from it too
        // rather than showing the previous load twice.
        setContent("");
      };
      next.onmessage = (event) => {
        if (socket !== next || closed) return;
        const message = api.parsePodLogsStreamMessage(String(event.data ?? ""));
        if (!message) return;
        if (message.type === "lines" && Array.isArray(message.lines)) {
          if (message.dropped) buffered.push(`… ${message.dropped} lines dropped, the stream was ahead of the window …`);
          buffered.push(...message.lines);
          if (flush === null) flush = window.setTimeout(commit, 60);
          return;
        }
        if (message.type === "error" && message.message) {
          setError(toErrorInfo(new Error(message.message)));
          return;
        }
        if (message.type === "ended") {
          commit();
          setLogsLoading(false);
        }
      };
      next.onerror = () => {
        if (socket !== next || closed) return;
        setLogsLoading(false);
      };
      next.onclose = () => {
        if (socket !== next || closed) return;
        socket = null;
        setLogsLoading(false);
        // A dropped socket is retried once a second while follow is still on;
        // turning follow off, or leaving the tab, stops it for good.
        reconnect = window.setTimeout(connect, 1000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (flush !== null) window.clearTimeout(flush);
      if (reconnect !== null) window.clearTimeout(reconnect);
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
      setLogsLoading(false);
    };
  }, [api, clusterId, podUid, podName, podNamespace, streaming, logsContainer, logsTail, logsTimestamps, logsPrevious, setContent, setError, pod]);

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
