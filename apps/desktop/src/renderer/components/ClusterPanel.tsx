import { Plus } from "lucide-react";
import type { Cluster } from "../types";

export function ClusterPanel(props: {
  clusters: Cluster[];
  activeCluster: Cluster | null;
  openingClusterId: string | null;
  importKubeconfig: () => void;
  openCluster: (cluster: Cluster) => void;
  renameCluster: (cluster: Cluster) => void;
  removeCluster: (cluster: Cluster) => void;
  t: (key: string) => string;
}) {
  return (
    <section className="cluster-panel">
      <header>
        <h2>{props.t("clusters.title")}</h2>
        <button className="icon-text" onClick={props.importKubeconfig}>
          <Plus size={15} />
          {props.t("clusters.import")}
        </button>
      </header>
      {props.clusters.length === 0 ? <p className="muted">{props.t("clusters.empty")}</p> : null}
      <div className="cluster-list">
        {props.clusters.map((cluster) => (
          <article className={props.activeCluster?.id === cluster.id ? "cluster-card active" : "cluster-card"} key={cluster.id}>
            <div>
              <strong>{cluster.displayName}</strong>
              <span>{cluster.kubeconfigPath}</span>
            </div>
            <div className="row-actions">
              <button disabled={props.openingClusterId === cluster.id} onClick={() => props.openCluster(cluster)}>
                {props.openingClusterId === cluster.id ? props.t("clusters.opening") : props.t("clusters.open")}
              </button>
              <button disabled={props.openingClusterId !== null} onClick={() => props.renameCluster(cluster)}>{props.t("clusters.rename")}</button>
              <button disabled={props.openingClusterId !== null} onClick={() => props.removeCluster(cluster)}>{props.t("clusters.remove")}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
