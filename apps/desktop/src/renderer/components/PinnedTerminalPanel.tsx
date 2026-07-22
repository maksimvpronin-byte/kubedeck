import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api";
import type { ResourceRow } from "../types";
import { loadUiState, saveUiState } from "../uiState";
import { TerminalTab } from "./TerminalTab";

export interface PinnedTerminalTarget {
  clusterId: string;
  clusterName: string;
  pod: ResourceRow;
  containers: string[];
  container: string;
}

export function PinnedTerminalPanel({ api, target, onClose }: { api: ApiClient; target: PinnedTerminalTarget; onClose: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [container, setContainer] = useState(target.container);
  const [size, setSize] = useState(() => {
    const saved = loadUiState();
    return { width: saved.pinnedTerminalWidth ?? 900, height: saved.pinnedTerminalHeight ?? 560 };
  });
  const panelRef = useRef<HTMLElement | null>(null);
  const namespace = String(target.pod.namespace || "default");

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || collapsed) return undefined;
    let saveTimer: number | null = null;
    const observer = new ResizeObserver(() => {
      const bounds = panel.getBoundingClientRect();
      const width = Math.round(bounds.width);
      const height = Math.round(bounds.height);
      setSize({ width, height });
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => saveUiState({ ...loadUiState(), pinnedTerminalWidth: width, pinnedTerminalHeight: height }), 150);
    });
    observer.observe(panel);
    return () => {
      observer.disconnect();
      if (saveTimer !== null) window.clearTimeout(saveTimer);
    };
  }, [collapsed]);

  return (
    <section ref={panelRef} className={`pinned-terminal ${collapsed ? "collapsed" : ""}`} style={collapsed ? undefined : { width: size.width, height: size.height }} aria-label={`Terminal ${namespace}/${target.pod.name}`}>
      <header>
        <div>
          <strong>Terminal</strong>
          <span>{target.clusterName} · {namespace}/{target.pod.name}{container ? ` · ${container}` : ""}</span>
        </div>
        <div className="pinned-terminal-actions">
          <button type="button" className="icon-button" onClick={() => setCollapsed((current) => !current)} title={collapsed ? "Expand terminal" : "Collapse terminal"} aria-label={collapsed ? "Expand terminal" : "Collapse terminal"}>
            {collapsed ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          <button type="button" className="icon-button" onClick={onClose} title="Close terminal" aria-label="Close terminal"><X size={17} /></button>
        </div>
      </header>
      <div className="pinned-terminal-body">
        <TerminalTab api={api} clusterId={target.clusterId} pod={target.pod} containers={target.containers} container={container} setContainer={setContainer} autoConnectToken={1} />
      </div>
    </section>
  );
}
