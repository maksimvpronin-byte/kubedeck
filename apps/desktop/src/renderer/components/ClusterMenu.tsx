import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Cluster } from "../types";

// What can be done to a cluster from where it is shown - its button on the rail
// and its name above the resource tree - rather than only from Settings. An
// action without a handler is left out, so a caller offers only what it wires.
export interface ClusterMenuActions {
  onConnect: (cluster: Cluster) => void;
  onDisconnect?: (cluster: Cluster) => void;
  onRename?: (cluster: Cluster) => void;
  onEditKubeconfig?: (cluster: Cluster) => void;
  onOpenSettings?: () => void;
  onRemove?: (cluster: Cluster) => void;
}

export interface ClusterMenuLabels {
  connect: string;
  disconnect: string;
  rename?: string;
  editKubeconfig?: string;
  settings?: string;
  remove?: string;
}

interface Props extends ClusterMenuActions {
  cluster: Cluster;
  connected: boolean;
  x: number;
  y: number;
  labels: ClusterMenuLabels;
  onClose: () => void;
}

// Space kept between the menu and the window edge it is pushed back from.
const EDGE = 8;

export function ClusterMenu({ cluster, connected, x, y, labels, onClose, onConnect, onDisconnect, onRename, onEditKubeconfig, onOpenSettings, onRemove }: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  // Opened beside a cluster low on the rail, seven items ran off the bottom of
  // the window. Measured before it is painted and moved back inside.
  useLayoutEffect(() => {
    const box = menuRef.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - box.width - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - box.height - EDGE)),
    });
  }, [x, y]);

  // A menu that outlives the click that opened it is a trap: any other
  // interaction, a change of window size, or Escape has to dismiss it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const item = (label: string | undefined, run: (() => void) | undefined, options: { disabled?: boolean; danger?: boolean } = {}) =>
    label && run ? (
      <button
        key={label}
        type="button"
        role="menuitem"
        className={options.danger ? "is-danger" : undefined}
        disabled={options.disabled}
        onClick={() => {
          onClose();
          run();
        }}
      >
        {label}
      </button>
    ) : null;
  const manage = [
    item(labels.rename, onRename && (() => onRename(cluster))),
    item(labels.editKubeconfig, onEditKubeconfig && (() => onEditKubeconfig(cluster))),
    item(labels.settings, onOpenSettings),
  ].filter(Boolean);
  const remove = item(labels.remove, onRemove && (() => onRemove(cluster)), { danger: true });

  return (
    <div
      className="cluster-rail-menu"
      role="menu"
      aria-label={cluster.displayName}
      ref={menuRef}
      style={position}
      // The window-level dismiss handler would close the menu before a click on
      // it could land.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {item(labels.connect, () => onConnect(cluster), { disabled: connected })}
      {item(labels.disconnect, onDisconnect && (() => onDisconnect(cluster)), { disabled: !connected })}
      {manage.length ? <div className="cluster-menu-separator" role="separator" /> : null}
      {manage}
      {remove ? <div className="cluster-menu-separator" role="separator" /> : null}
      {remove}
    </div>
  );
}

// What a cluster's tooltip says: its name, the API server behind it - clusters
// made by kubeadm are all called "kubernetes" - and whether it is connected.
export function clusterTitle(cluster: Cluster, state: string) {
  return [cluster.displayName, cluster.server, state].filter(Boolean).join("\n");
}
