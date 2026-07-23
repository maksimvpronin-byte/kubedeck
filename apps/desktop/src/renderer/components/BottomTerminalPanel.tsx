import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useState } from "react";
import type { ApiClient } from "../api";
import type { ResourceRow } from "../types";
import { TerminalTab } from "./TerminalTab";

export interface BottomTerminalTarget {
  id: string;
  clusterId: string;
  clusterName: string;
  pod: ResourceRow;
  containers: string[];
  container: string;
}

interface Props {
  api: ApiClient;
  targets: BottomTerminalTarget[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

export function BottomTerminalPanel({ api, targets, activeId, onActivate, onClose }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className={`bottom-terminal-panel ${collapsed ? "collapsed" : ""}`} aria-label="Terminals">
      <div className="bottom-terminal-header">
        <div className="bottom-terminal-tabs" role="tablist">
          {targets.map((target) => (
            <div className={`bottom-terminal-tab ${target.id === activeId ? "active" : ""}`} key={target.id}>
              <button
                type="button"
                role="tab"
                aria-selected={target.id === activeId}
                onClick={() => {
                  onActivate(target.id);
                  setCollapsed(false);
                }}
                title={`${target.clusterName} · ${target.pod.namespace}/${target.pod.name}`}
              >
                <strong>{target.pod.name}</strong>
                {target.container ? <small>· {target.container}</small> : null}
              </button>
              <button type="button" onClick={() => onClose(target.id)} title={`Close terminal ${target.pod.name}`} data-tooltip="Close terminal" aria-label={`Close terminal ${target.pod.name}`}>
                <X size={13} />
              </button>
            </div>
          ))}
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
          <BottomTerminalSession key={target.id} api={api} target={target} active={!collapsed && target.id === activeId} />
        ))}
      </div>
    </section>
  );
}

function BottomTerminalSession({ api, target, active }: { api: ApiClient; target: BottomTerminalTarget; active: boolean }) {
  const [container, setContainer] = useState(target.container);
  return (
    <div className={`bottom-terminal-session ${active ? "active" : ""}`}>
      <TerminalTab api={api} clusterId={target.clusterId} pod={target.pod} containers={target.containers} container={container} setContainer={setContainer} autoConnectToken={1} active={active} />
    </div>
  );
}
