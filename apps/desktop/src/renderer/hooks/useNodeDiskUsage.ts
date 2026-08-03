import { useCallback, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ResourceRow } from "../types";

interface Options {
  api: ApiClient | null;
  activeCluster: Cluster | null;
  resourceTab: string;
  setRows: Dispatch<SetStateAction<Record<string, ResourceRow[]>>>;
}

export function useNodeDiskUsage({ api, activeCluster, resourceTab, setRows }: Options) {
  const nodeDiskCacheRef = useRef(new Map<string, { at: number; data: ResourceRow }>());
  const nodeDiskPendingRef = useRef(new Set<string>());
  const activeClusterIdRef = useRef<string | null>(null);
  activeClusterIdRef.current = activeCluster?.id ?? null;

  const loadVisibleNodeDisk = useCallback(
    (visibleRows: ResourceRow[]) => {
      if (!api || !activeCluster || resourceTab !== "nodes") return;
      const clusterId = activeCluster.id;
      const now = Date.now();
      const queue = visibleRows.filter((row) => {
        const key = `${clusterId}:${String(row.uid || row.name)}`;
        const cached = nodeDiskCacheRef.current.get(key);
        if (cached && now - cached.at < 60_000) {
          if (row.diskUsage !== cached.data.diskUsage) {
            setRows((current) => ({
              ...current,
              nodes: (current.nodes ?? []).map((item) => (item.uid === row.uid ? { ...item, ...cached.data, uid: item.uid, name: item.name } : item)),
            }));
          }
          return false;
        }
        if (nodeDiskPendingRef.current.has(key)) return false;
        nodeDiskPendingRef.current.add(key);
        return true;
      });
      if (!queue.length) return;

      const queuedKeys = new Set(queue.map((row) => String(row.uid || row.name)));
      setRows((current) => ({
        ...current,
        nodes: (current.nodes ?? []).map((row) => (queuedKeys.has(String(row.uid || row.name)) ? { ...row, diskLoading: true } : row)),
      }));

      let index = 0;
      const worker = async () => {
        while (index < queue.length) {
          const row = queue[index++];
          const identity = String(row.uid || row.name);
          const cacheKey = `${clusterId}:${identity}`;
          try {
            const data = await api.resourceMetrics(clusterId, "nodes", "_cluster", String(row.name));
            nodeDiskCacheRef.current.set(cacheKey, { at: Date.now(), data });
            if (activeClusterIdRef.current !== clusterId) continue;
            setRows((current) => ({
              ...current,
              nodes: (current.nodes ?? []).map((item) => (String(item.uid || item.name) === identity ? { ...item, ...data, uid: item.uid, name: item.name, diskLoading: false } : item)),
            }));
          } catch {
            nodeDiskCacheRef.current.set(cacheKey, { at: Date.now(), data: { uid: "", name: String(row.name), diskMetricsUnavailable: true } });
            if (activeClusterIdRef.current !== clusterId) continue;
            setRows((current) => ({
              ...current,
              nodes: (current.nodes ?? []).map((item) => (String(item.uid || item.name) === identity ? { ...item, diskLoading: false, diskMetricsUnavailable: true } : item)),
            }));
          } finally {
            nodeDiskPendingRef.current.delete(cacheKey);
          }
        }
      };
      void Promise.all([worker(), worker()]);
    },
    [activeCluster, api, resourceTab, setRows],
  );

  return { loadVisibleNodeDisk };
}
