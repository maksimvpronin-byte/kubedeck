import { Plus } from "lucide-react";
import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Cluster } from "../types";

export function clusterInitials(displayName: string) {
  const words = String(displayName ?? "")
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return [...words[0]].slice(0, 2).join("").toUpperCase();
  return [[...words[0]][0], [...words[1]][0]].join("").toUpperCase();
}

interface ClusterRailProps {
  clusters: Cluster[];
  activeClusterId?: string;
  unavailableClusterId?: string;
  openingClusterId: string | null;
  railLabel: string;
  importLabel: string;
  emptyLabel: string;
  openingLabel: string;
  onSelect: (cluster: Cluster) => void;
  onImport: () => void;
}

export function ClusterRail({ clusters, activeClusterId, unavailableClusterId, openingClusterId, railLabel, importLabel, emptyLabel, openingLabel, onSelect, onImport }: ClusterRailProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  function moveFocus(event: ReactKeyboardEvent<HTMLButtonElement>, from: number, direction: 1 | -1) {
    const buttons = listRef.current?.querySelectorAll("button");
    if (!buttons?.length) return;
    event.preventDefault();
    const next = (from + direction + buttons.length) % buttons.length;
    (buttons[next] as HTMLButtonElement).focus();
  }

  return (
    <aside className="cluster-rail">
      <nav className="cluster-rail-items" aria-label={railLabel} ref={listRef}>
        {clusters.map((cluster, index) => {
          const active = cluster.id === activeClusterId;
          const opening = openingClusterId === cluster.id;
          const unavailable = cluster.id === unavailableClusterId;
          const title = opening ? `${cluster.displayName} — ${openingLabel}` : cluster.displayName;
          return (
            <button
              type="button"
              key={cluster.id}
              className={["cluster-rail-item", active ? "is-active" : "", opening ? "is-opening" : "", unavailable ? "is-unavailable" : ""].filter(Boolean).join(" ")}
              aria-current={active ? "true" : undefined}
              aria-label={title}
              title={title}
              onClick={() => onSelect(cluster)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") moveFocus(event, index, 1);
                if (event.key === "ArrowUp") moveFocus(event, index, -1);
              }}
            >
              <span aria-hidden="true">{clusterInitials(cluster.displayName)}</span>
            </button>
          );
        })}
      </nav>
      <button type="button" className="cluster-rail-import" aria-label={clusters.length ? importLabel : emptyLabel} title={clusters.length ? importLabel : emptyLabel} onClick={onImport}>
        <Plus size={17} aria-hidden="true" />
      </button>
    </aside>
  );
}
