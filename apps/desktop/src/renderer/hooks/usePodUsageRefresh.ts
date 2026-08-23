import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ResourceRow } from "../types";
import { setAlignedInterval } from "../utils/alignedInterval";
import { normalizeNamespaceSelection } from "../utils/kubeResources";
import { applyPodUsage } from "../utils/podUsagePatch";

// Matches the sampling interval: the table cannot show anything newer than the
// samples behind it.
const POD_USAGE_REFRESH_MS = 15_000;

function isPodResourceTab(resource: string): boolean {
  return ["pods", "pod", "po"].includes(resource);
}

interface Options {
  api: ApiClient | null;
  activeCluster: Cluster | null;
  connectedClusterIds: string[];
  resourceTab: string;
  selectedNamespaces: string[];
  setRows: Dispatch<SetStateAction<Record<string, ResourceRow[]>>>;
}

// A pods table driven by watch events is not reloaded while nothing about the
// pods changes, so its usage column would keep whatever the last list load
// happened to catch - N/A for a pod metrics-server had not reported yet. This
// refreshes only the usage, from samples KubeDeck already recorded, so it costs
// no kubectl call.
export function usePodUsageRefresh({ api, activeCluster, connectedClusterIds, resourceTab, selectedNamespaces, setRows }: Options): void {
  useEffect(() => {
    // A disconnected cluster has no samples left to read, so this would poll
    // the store for an empty answer every tick.
    if (!api || !activeCluster || !isPodResourceTab(resourceTab) || !connectedClusterIds.includes(activeCluster.id)) return;
    const namespace = normalizeNamespaceSelection(selectedNamespaces).join(",") || "all";
    let cancelled = false;

    const refresh = async () => {
      try {
        const response = await api.podUsage(activeCluster.id, namespace.includes(",") ? "all" : namespace);
        if (cancelled) return;
        setRows((current) => {
          const rows = current[resourceTab];
          if (!rows) return current;
          const next = applyPodUsage(rows, response.items);
          return next === rows ? current : { ...current, [resourceTab]: next };
        });
      } catch {
        // Usage is a refinement of what the table already shows: failing to
        // read it must never disturb the rows or raise an error banner.
      }
    };

    void refresh();
    // Aligned rather than free-running: the drawer's usage panel reads the same
    // recorded samples on the same interval, and two unaligned timers make the
    // table and the drawer disagree about a pod whose usage is moving.
    const stop = setAlignedInterval(() => void refresh(), POD_USAGE_REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [api, activeCluster?.id, resourceTab, selectedNamespaces, connectedClusterIds]);
}
