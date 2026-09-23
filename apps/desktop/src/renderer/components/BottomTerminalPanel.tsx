import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ApiClient } from "../api";
import type { ResourceRow, Settings } from "../types";
import { loadUiState, saveUiState } from "../uiState";
import { NodeSshTab } from "./NodeSshTab";
import { TerminalTab } from "./TerminalTab";

export type BottomTerminalTarget =
  | {
      kind: "pod";
      id: string;
      clusterId: string;
      clusterName: string;
      pod: ResourceRow;
      containers: string[];
      container: string;
    }
  | {
      kind: "node-ssh";
      id: string;
      clusterId: string;
      clusterName: string;
      node: ResourceRow;
    };

interface Props {
  api: ApiClient;
  targets: BottomTerminalTarget[];
  activeId: string;
  openToken: number;
  settings?: Settings;
  t?: (key: string) => string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onContainerChange?: (id: string, container: string) => void;
}

export const MIN_BOTTOM_TERMINAL_HEIGHT = 180;
export const MIN_UPPER_CONTENT_HEIGHT = 160;
const DEFAULT_BOTTOM_TERMINAL_RATIO = 0.42;

export function BottomTerminalPanel({ api, targets, activeId, openToken, settings, t, onActivate, onClose, onContainerChange }: Props) {
  const tr = (key: string, fallback: string) => (t ? t(key) : fallback);
  const [collapsed, setCollapsed] = useState(false);
  const [availableHeight, setAvailableHeight] = useState(() => (typeof window === "undefined" ? 720 : window.innerHeight));
  // The height the user chose, and the height drawn: that one fitted to the
  // room there is now. Clamping the choice itself lost it for good whenever the
  // window was made smaller for a moment.
  const [preferredHeight, setPreferredHeight] = useState(
    () => loadUiState().bottomTerminalHeight ?? Math.round((typeof window === "undefined" ? 720 : window.innerHeight) * DEFAULT_BOTTOM_TERMINAL_RATIO),
  );
  const height = clampBottomTerminalHeight(preferredHeight, availableHeight);
  const panelRef = useRef<HTMLElement | null>(null);
  const heightRef = useRef(height);
  heightRef.current = height;
  const availableHeightRef = useRef(availableHeight);
  const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);

  useEffect(() => setCollapsed(false), [openToken]);

  useEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return undefined;
    const updateBounds = () => {
      const nextAvailableHeight = Math.round(parent.getBoundingClientRect().height);
      if (nextAvailableHeight <= 0) return;
      availableHeightRef.current = nextAvailableHeight;
      setAvailableHeight(nextAvailableHeight);
    };
    updateBounds();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateBounds) : null;
    observer?.observe(parent);
    window.addEventListener("resize", updateBounds);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, []);

  function updateHeight(candidate: number, persist = false) {
    const next = clampBottomTerminalHeight(candidate, availableHeightRef.current);
    heightRef.current = next;
    setPreferredHeight(next);
    if (persist) saveUiState({ ...loadUiState(), bottomTerminalHeight: next });
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: heightRef.current };
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updateHeight(drag.startHeight + drag.startY - event.clientY);
  }

  function stopResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    updateHeight(heightRef.current, true);
  }

  const maxHeight = maxBottomTerminalHeight(availableHeight);

  return (
    <section ref={panelRef} className={`bottom-terminal-panel ${collapsed ? "collapsed" : ""}`} style={collapsed ? undefined : { height }} aria-label={tr("terminals.title", "Terminals")}>
      {!collapsed ? (
        <div
          className="bottom-terminal-resize-handle"
          role="separator"
          tabIndex={0}
          aria-label={tr("terminals.resize", "Resize terminals")}
          aria-orientation="horizontal"
          aria-valuemin={Math.min(MIN_BOTTOM_TERMINAL_HEIGHT, maxHeight)}
          aria-valuemax={maxHeight}
          aria-valuenow={height}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          onLostPointerCapture={stopResize}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            const delta = event.shiftKey ? 48 : 16;
            updateHeight(heightRef.current + (event.key === "ArrowUp" ? delta : -delta), true);
          }}
        />
      ) : null}
      <div className="bottom-terminal-header">
        <div className="bottom-terminal-tabs" role="tablist">
          {targets.map((target) => {
            const label = bottomTerminalLabel(target);
            return (
              <div className={`bottom-terminal-tab ${target.id === activeId ? "active" : ""}`} key={target.id}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={target.id === activeId}
                  onClick={() => {
                    onActivate(target.id);
                    setCollapsed(false);
                  }}
                  title={bottomTerminalTitle(target)}
                >
                  <strong>{label.name}</strong>
                  <small>· {label.detail}</small>
                </button>
                <button
                  type="button"
                  onClick={() => onClose(target.id)}
                  title={`${tr("common.close", "Close")} ${label.closeName}`}
                  data-tooltip={`${tr("common.close", "Close")} ${label.kind}`}
                  aria-label={`${tr("common.close", "Close")} ${label.closeName}`}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="icon-button bottom-terminal-collapse"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? tr("terminals.expand", "Expand terminals") : tr("terminals.collapse", "Collapse terminals")}
          title={collapsed ? tr("terminals.expand", "Expand terminals") : tr("terminals.collapse", "Collapse terminals")}
          data-tooltip={collapsed ? tr("terminals.expand", "Expand terminals") : tr("terminals.collapse", "Collapse terminals")}
        >
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      <div className="bottom-terminal-body">
        {targets.map((target) => (
          <BottomTerminalSession key={target.id} api={api} target={target} settings={settings} t={t} active={!collapsed && target.id === activeId} onContainerChange={onContainerChange} />
        ))}
      </div>
    </section>
  );
}

function BottomTerminalSession({
  api,
  target,
  settings,
  t,
  active,
  onContainerChange,
}: {
  api: ApiClient;
  target: BottomTerminalTarget;
  settings?: Settings;
  t?: (key: string) => string;
  active: boolean;
  onContainerChange?: (id: string, container: string) => void;
}) {
  return (
    <div className={`bottom-terminal-session ${active ? "active" : ""}`}>
      {target.kind === "pod" ? (
        <BottomPodTerminalSession api={api} target={target} active={active} onContainerChange={onContainerChange} />
      ) : (
        <NodeSshTab api={api} clusterId={target.clusterId} node={target.node} settings={settings} active={active} t={t} />
      )}
    </div>
  );
}

// The container lives on the target rather than in here: switching it inside
// the terminal left the tab, and its tooltip, naming the one it was opened on.
function BottomPodTerminalSession({
  api,
  target,
  active,
  onContainerChange,
}: {
  api: ApiClient;
  target: Extract<BottomTerminalTarget, { kind: "pod" }>;
  active: boolean;
  onContainerChange?: (id: string, container: string) => void;
}) {
  const [localContainer, setLocalContainer] = useState(target.container);
  const container = onContainerChange ? target.container : localContainer;
  const setContainer = (next: string) => (onContainerChange ? onContainerChange(target.id, next) : setLocalContainer(next));
  return <TerminalTab api={api} clusterId={target.clusterId} pod={target.pod} containers={target.containers} container={container} setContainer={setContainer} autoConnectToken={1} active={active} />;
}

function bottomTerminalLabel(target: BottomTerminalTarget) {
  if (target.kind === "node-ssh") return { name: target.node.name, detail: "SSH", kind: "SSH", closeName: `SSH ${target.node.name}` };
  return { name: target.pod.name, detail: target.container || "Terminal", kind: "terminal", closeName: `terminal ${target.pod.name}` };
}

function bottomTerminalTitle(target: BottomTerminalTarget) {
  if (target.kind === "node-ssh") return `${target.clusterName} · SSH · ${target.node.name}`;
  return `${target.clusterName} · ${String(target.pod.namespace || "default")}/${target.pod.name}${target.container ? ` · ${target.container}` : ""}`;
}

export function maxBottomTerminalHeight(availableHeight: number) {
  return Math.max(0, Math.round(availableHeight) - MIN_UPPER_CONTENT_HEIGHT);
}

export function clampBottomTerminalHeight(height: number, availableHeight: number) {
  const maximum = maxBottomTerminalHeight(availableHeight);
  const minimum = Math.min(MIN_BOTTOM_TERMINAL_HEIGHT, maximum);
  return Math.round(Math.min(maximum, Math.max(minimum, height)));
}
