import { useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Plus } from "lucide-react";
import type { Cluster } from "../types";

export function moveCluster(clusters: Cluster[], fromIndex: number, toIndex: number): Cluster[] {
  if (
    fromIndex < 0 ||
    fromIndex >= clusters.length ||
    toIndex < 0 ||
    toIndex >= clusters.length ||
    fromIndex === toIndex
  ) {
    return clusters;
  }
  const next = [...clusters];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function ClusterPanel(props: {
  clusters: Cluster[];
  activeCluster: Cluster | null;
  openingClusterId: string | null;
  importKubeconfig: () => void;
  openCluster: (cluster: Cluster) => void;
  renameCluster: (cluster: Cluster) => void;
  removeCluster: (cluster: Cluster) => void;
  reorderClusters: (clusters: Cluster[]) => void | Promise<void>;
  reorderingClusters: boolean;
  t: (key: string) => string;
}) {
  const [draggedClusterId, setDraggedClusterId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const actionsDisabled = props.reorderingClusters;

  const move = (fromIndex: number, toIndex: number) => {
    const next = moveCluster(props.clusters, fromIndex, toIndex);
    if (next !== props.clusters) void props.reorderClusters(next);
  };

  const drop = (targetIndex: number) => {
    const fromIndex = props.clusters.findIndex((cluster) => cluster.id === draggedClusterId);
    setDraggedClusterId(null);
    setDropTargetId(null);
    if (fromIndex >= 0) move(fromIndex, targetIndex);
  };

  return (
    <section className="cluster-panel">
      <header>
        <h2>{props.t("clusters.title")}</h2>
        <button className="icon-text" onClick={props.importKubeconfig} disabled={actionsDisabled}>
          <Plus size={15} />
          {props.t("clusters.import")}
        </button>
      </header>
      {props.clusters.length === 0 ? <p className="muted">{props.t("clusters.empty")}</p> : null}
      <div className="cluster-list">
        {props.clusters.map((cluster, index) => (
          <article
            className={[
              "cluster-card",
              props.activeCluster?.id === cluster.id ? "active" : "",
              draggedClusterId === cluster.id ? "dragging" : "",
              dropTargetId === cluster.id ? "drop-target" : "",
            ].filter(Boolean).join(" ")}
            key={cluster.id}
            onDragOver={(event) => {
              if (actionsDisabled || !draggedClusterId) return;
              event.preventDefault();
              setDropTargetId(cluster.id);
            }}
            onDragLeave={() => setDropTargetId((current) => current === cluster.id ? null : current)}
            onDrop={(event) => {
              event.preventDefault();
              if (!actionsDisabled) drop(index);
            }}
          >
            <button
              className="cluster-drag-handle"
              draggable={!actionsDisabled}
              disabled={actionsDisabled}
              aria-label={props.t("clusters.drag")}
              title={props.t("clusters.drag")}
              onDragStart={(event) => {
                setDraggedClusterId(cluster.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", cluster.id);
              }}
              onDragEnd={() => {
                setDraggedClusterId(null);
                setDropTargetId(null);
              }}
            >
              <GripVertical size={16} />
            </button>
            <div>
              <strong>{cluster.displayName}</strong>
              <span>{cluster.kubeconfigPath}</span>
            </div>
            <div className="row-actions">
              <button
                className="cluster-order-button"
                disabled={actionsDisabled || index === 0}
                onClick={() => move(index, index - 1)}
                aria-label={props.t("clusters.moveUp")}
                title={props.t("clusters.moveUp")}
              >
                <ChevronUp size={15} />
              </button>
              <button
                className="cluster-order-button"
                disabled={actionsDisabled || index === props.clusters.length - 1}
                onClick={() => move(index, index + 1)}
                aria-label={props.t("clusters.moveDown")}
                title={props.t("clusters.moveDown")}
              >
                <ChevronDown size={15} />
              </button>
              <button disabled={actionsDisabled || props.openingClusterId === cluster.id} onClick={() => props.openCluster(cluster)}>
                {props.openingClusterId === cluster.id ? props.t("clusters.opening") : props.t("clusters.open")}
              </button>
              <button disabled={actionsDisabled || props.openingClusterId === cluster.id} onClick={() => props.renameCluster(cluster)}>{props.t("clusters.rename")}</button>
              <button disabled={actionsDisabled || props.openingClusterId === cluster.id} onClick={() => props.removeCluster(cluster)}>{props.t("clusters.remove")}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
