import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useState } from "react";
import type { ApiClient } from "../api";
import type { ResourceRow } from "../types";
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
  const namespace = String(target.pod.namespace || "default");

  return (
    <section className={`pinned-terminal ${collapsed ? "collapsed" : ""}`} aria-label={`Terminal ${namespace}/${target.pod.name}`}>
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
