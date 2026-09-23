import { ChevronDown } from "lucide-react";
import { useCallback, useState } from "react";
import type { CSSProperties } from "react";
import type { Cluster } from "../types";
import { ClusterMenu, type ClusterMenuActions, type ClusterMenuLabels, clusterTitle } from "./ClusterMenu";

interface Props {
  cluster: Cluster;
  avatar: string;
  accentHue: number;
  connected: boolean;
  stateLabel: string;
  labels: ClusterMenuLabels;
  actions: ClusterMenuActions;
}

// The cluster being browsed, named in full above the resource tree. The rail
// only has room for two letters, and a tooltip is not where anyone looks to
// find out which cluster a delete is about to go to. A click opens the same
// menu as a right-click on the rail.
export function SidebarClusterHeader({ cluster, avatar, accentHue, connected, stateLabel, labels, actions }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const title = clusterTitle(cluster, stateLabel);

  return (
    <div className="sidebar-cluster">
      <button
        type="button"
        className={`sidebar-cluster-button${connected ? " is-connected" : ""}`}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        style={{ "--cluster-accent": `hsl(${accentHue} 62% 52%)` } as CSSProperties}
        onPointerDown={(event) => {
          // Pressing the button while its menu is open should close the menu,
          // not close and reopen it.
          if (menu) event.stopPropagation();
        }}
        onClick={(event) => {
          if (menu) {
            setMenu(null);
            return;
          }
          const box = event.currentTarget.getBoundingClientRect();
          setMenu({ x: box.left, y: box.bottom + 4 });
        }}
      >
        <span className="sidebar-cluster-avatar" aria-hidden="true">
          {avatar}
        </span>
        <span className="sidebar-cluster-name">{cluster.displayName}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {menu ? <ClusterMenu cluster={cluster} connected={connected} x={menu.x} y={menu.y} labels={labels} onClose={closeMenu} {...actions} /> : null}
    </div>
  );
}
