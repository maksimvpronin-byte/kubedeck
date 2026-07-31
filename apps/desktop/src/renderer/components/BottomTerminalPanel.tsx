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
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

export const MIN_BOTTOM_TERMINAL_HEIGHT = 180;
export const MIN_UPPER_CONTENT_HEIGHT = 160;
const DEFAULT_BOTTOM_TERMINAL_RATIO = 0.42;

export function BottomTerminalPanel({ api, targets, activeId, openToken, settings, onActivate, onClose }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [availableHeight, setAvailableHeight] = useState(() => (typeof window === "undefined" ? 720 : window.innerHeight));
  const [height, setHeight] = useState(() => loadUiState().bottomTerminalHeight ?? Math.round((typeof window === "undefined" ? 720 : window.innerHeight) * DEFAULT_BOTTOM_TERMINAL_RATIO));
  const panelRef = useRef<HTMLElement | null>(null);
  const heightRef = useRef(height);
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
      setHeight((current) => {
        const next = clampBottomTerminalHeight(current, nextAvailableHeight);
        heightRef.current = next;
        return next;
      });
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
    setHeight(next);
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
    <section ref={panelRef} className={`bottom-terminal-panel ${collapsed ? "collapsed" : ""}`} style={collapsed ? undefined : { height }} aria-label="Terminals">
      {!collapsed ? (
        <div
          className="bottom-terminal-resize-handle"
          role="separator"
          tabIndex={0}
          aria-label="Resize terminals"
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
                <button type="button" onClick={() => onClose(target.id)} title={`Close ${label.closeName}`} data-tooltip={`Close ${label.kind}`} aria-label={`Close ${label.closeName}`}>
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
          aria-label={collapsed ? "Expand terminals" : "Collapse terminals"}
          title={collapsed ? "Expand terminals" : "Collapse terminals"}
          data-tooltip={collapsed ? "Expand terminals" : "Collapse terminals"}
        >
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      <div className="bottom-terminal-body">
        {targets.map((target) => (
          <BottomTerminalSession key={target.id} api={api} target={target} settings={settings} active={!collapsed && target.id === activeId} />
        ))}
      </div>
    </section>
  );
}

function BottomTerminalSession({ api, target, settings, active }: { api: ApiClient; target: BottomTerminalTarget; settings?: Settings; active: boolean }) {
  return (
    <div className={`bottom-terminal-session ${active ? "active" : ""}`}>
      {target.kind === "pod" ? (
        <BottomPodTerminalSession api={api} target={target} active={active} />
      ) : (
        <NodeSshTab api={api} clusterId={target.clusterId} node={target.node} settings={settings} active={active} />
      )}
    </div>
  );
}

function BottomPodTerminalSession({ api, target, active }: { api: ApiClient; target: Extract<BottomTerminalTarget, { kind: "pod" }>; active: boolean }) {
  const [container, setContainer] = useState(target.container);
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
