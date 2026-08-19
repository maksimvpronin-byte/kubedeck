import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Cluster } from "../types";

// Connected means KubeDeck is allowed to talk to this cluster on its own: a
// usage sampler on a timer and watch processes per resource kind being viewed.
// Disconnected is the resting state, not a fault, so it is dimmed rather than
// red - a rail of red buttons after a fresh start would read as an outage.
export type ClusterConnectionState = "connected" | "disconnected" | "failed";

export function clusterInitials(displayName: string) {
  const words = String(displayName ?? "")
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return [...words[0]].slice(0, 2).join("").toUpperCase();
  return [[...words[0]][0], [...words[1]][0]].join("").toUpperCase();
}

function sharedPrefixLength(names: string[]) {
  const [first, ...rest] = names.map((name) => name.toLowerCase());
  let length = 0;
  while (length < first.length && rest.every((name) => name[length] === first[length])) length += 1;
  return length;
}

function shortLabel(value: string) {
  const compact = value.replace(/[^\p{L}\p{N}]/gu, "") || value;
  return [...compact].slice(0, 2).join("").toUpperCase();
}

// Cluster names usually share a prefix (k8s1, k8s2, k8s-office), so plain
// initials would label almost every button "K8". The rail labels the part that
// actually differs, and falls back to initials when there is no shared prefix.
export function clusterRailLabels(clusters: Array<{ id: string; displayName: string }>) {
  const names = clusters.map((cluster) => String(cluster.displayName ?? "").trim());
  const shared = names.length > 1 ? sharedPrefixLength(names) : 0;
  const remainders = names.map((name) => name.slice(shared).replace(/^[\s._-]+/, ""));
  const distinguishing = shared > 0 && remainders.every((remainder) => remainder.length > 0);

  return new Map(clusters.map((cluster, index) => [cluster.id, distinguishing ? shortLabel(remainders[index]) : clusterInitials(names[index])]));
}

// A stable hue per cluster id keeps neighbouring buttons visually apart even
// when their labels are close.
export function clusterAccentHue(clusterId: string) {
  let hash = 0;
  for (const character of String(clusterId)) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % 360;
}

interface ClusterRailProps {
  clusters: Cluster[];
  activeClusterId?: string;
  unavailableClusterId?: string;
  openingClusterId: string | null;
  connectedClusterIds?: string[];
  railLabel: string;
  importLabel: string;
  emptyLabel: string;
  openingLabel: string;
  connectLabel?: string;
  disconnectLabel?: string;
  connectedLabel?: string;
  disconnectedLabel?: string;
  onSelect: (cluster: Cluster) => void;
  onImport: () => void;
  onDisconnect?: (cluster: Cluster) => void;
}

export function ClusterRail({
  clusters,
  activeClusterId,
  unavailableClusterId,
  openingClusterId,
  connectedClusterIds,
  railLabel,
  importLabel,
  emptyLabel,
  openingLabel,
  connectLabel = "Connect",
  disconnectLabel = "Disconnect",
  connectedLabel = "connected",
  disconnectedLabel = "not connected",
  onSelect,
  onImport,
  onDisconnect,
}: ClusterRailProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const labels = useMemo(() => clusterRailLabels(clusters), [clusters]);
  const connected = useMemo(() => new Set(connectedClusterIds ?? []), [connectedClusterIds]);
  const [menu, setMenu] = useState<{ cluster: Cluster; x: number; y: number } | null>(null);

  // A context menu that outlives the click that opened it is a trap: any other
  // interaction, a scroll, or Escape has to dismiss it.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

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
          const state: ClusterConnectionState = unavailable ? "failed" : connected.has(cluster.id) ? "connected" : "disconnected";
          const stateLabel = state === "connected" ? connectedLabel : disconnectedLabel;
          const title = opening ? `${cluster.displayName} — ${openingLabel}` : `${cluster.displayName} — ${stateLabel}`;
          return (
            <button
              type="button"
              key={cluster.id}
              className={["cluster-rail-item", `is-${state}`, active ? "is-active" : "", opening ? "is-opening" : "", unavailable ? "is-unavailable" : ""].filter(Boolean).join(" ")}
              aria-current={active ? "true" : undefined}
              aria-label={title}
              title={title}
              style={{ "--cluster-accent": `hsl(${clusterAccentHue(cluster.id)} 62% 52%)` } as CSSProperties}
              onClick={() => onSelect(cluster)}
              onContextMenu={(event) => {
                event.preventDefault();
                const box = event.currentTarget.getBoundingClientRect();
                setMenu({ cluster, x: box.right + 6, y: box.top });
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") moveFocus(event, index, 1);
                if (event.key === "ArrowUp") moveFocus(event, index, -1);
              }}
            >
              <span aria-hidden="true">{labels.get(cluster.id)}</span>
              {/* The state badge is a separate element rather than a ring on
                  the button: `is-active` sets its own box-shadow and would win
                  by source order, hiding the state of the one cluster the user
                  is actually looking at. */}
              <span className="cluster-rail-state" aria-hidden="true" />
            </button>
          );
        })}
      </nav>
      <button type="button" className="cluster-rail-import" aria-label={clusters.length ? importLabel : emptyLabel} title={clusters.length ? importLabel : emptyLabel} onClick={onImport}>
        <Plus size={17} aria-hidden="true" />
      </button>
      {menu ? (
        <div
          className="cluster-rail-menu"
          role="menu"
          aria-label={menu.cluster.displayName}
          style={{ left: menu.x, top: menu.y }}
          // The window-level dismiss handler would close the menu before a
          // click on it could land.
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={connected.has(menu.cluster.id)}
            onClick={() => {
              setMenu(null);
              onSelect(menu.cluster);
            }}
          >
            {connectLabel}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!connected.has(menu.cluster.id)}
            onClick={() => {
              setMenu(null);
              onDisconnect?.(menu.cluster);
            }}
          >
            {disconnectLabel}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
