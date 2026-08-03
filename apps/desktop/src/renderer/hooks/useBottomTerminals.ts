import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BottomTerminalTarget } from "../components/BottomTerminalPanel";
import type { Cluster, ErrorInfo, ResourceRow } from "../types";

interface Options {
  activeCluster: Cluster | null;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
}

export function useBottomTerminals({ activeCluster, setError }: Options) {
  const [bottomTerminals, setBottomTerminals] = useState<BottomTerminalTarget[]>([]);
  const [activeBottomTerminalId, setActiveBottomTerminalId] = useState<string | null>(null);
  const [bottomTerminalOpenToken, setBottomTerminalOpenToken] = useState(0);

  function openBottomTerminal(pod: ResourceRow, containers: string[], container: string) {
    if (!activeCluster) return;
    const id = `pod\u0000${activeCluster.id}\u0000${String(pod.namespace || "default")}\u0000${String(pod.uid || pod.name)}\u0000${container}`;
    const existing = bottomTerminals.find((target) => target.id === id);
    if (existing) {
      setActiveBottomTerminalId(existing.id);
      setBottomTerminalOpenToken((current) => current + 1);
      return;
    }
    if (bottomTerminals.length >= 5) {
      setError({ code: "LIMIT_REACHED", message: "Close a terminal or SSH session before opening another (5 maximum).", rawStderr: "", commandPreview: "" });
      return;
    }
    setBottomTerminals((current) => [...current, { kind: "pod", id, clusterId: activeCluster.id, clusterName: activeCluster.displayName, pod, containers, container }]);
    setActiveBottomTerminalId(id);
    setBottomTerminalOpenToken((current) => current + 1);
  }

  function openBottomNodeSsh(node: ResourceRow) {
    if (!activeCluster) return;
    const id = `ssh\u0000${activeCluster.id}\u0000${String(node.uid || node.name)}`;
    const existing = bottomTerminals.find((target) => target.id === id);
    if (existing) {
      setActiveBottomTerminalId(existing.id);
      setBottomTerminalOpenToken((current) => current + 1);
      return;
    }
    if (bottomTerminals.length >= 5) {
      setError({ code: "LIMIT_REACHED", message: "Close a terminal or SSH session before opening another (5 maximum).", rawStderr: "", commandPreview: "" });
      return;
    }
    setBottomTerminals((current) => [...current, { kind: "node-ssh", id, clusterId: activeCluster.id, clusterName: activeCluster.displayName, node }]);
    setActiveBottomTerminalId(id);
    setBottomTerminalOpenToken((current) => current + 1);
  }

  function closeBottomTerminal(id: string) {
    const index = bottomTerminals.findIndex((target) => target.id === id);
    const next = bottomTerminals.filter((target) => target.id !== id);
    setBottomTerminals(next);
    if (id === activeBottomTerminalId) setActiveBottomTerminalId(next[Math.min(index, next.length - 1)]?.id ?? null);
  }

  function removeClusterTerminals(clusterId: string) {
    const remaining = bottomTerminals.filter((target) => target.clusterId !== clusterId);
    setBottomTerminals(remaining);
    setActiveBottomTerminalId((current) => (remaining.some((target) => target.id === current) ? current : (remaining[0]?.id ?? null)));
  }

  return {
    bottomTerminals,
    activeBottomTerminalId,
    setActiveBottomTerminalId,
    bottomTerminalOpenToken,
    openBottomTerminal,
    openBottomNodeSsh,
    closeBottomTerminal,
    removeClusterTerminals,
  };
}
