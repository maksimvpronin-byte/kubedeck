import { Copy, X } from "lucide-react";
import type { ResourceRow } from "../types";
import { displayResource } from "./podDrawerHelpers";
import { actionLabel, type ResourceAction } from "./PodDrawerModals";

export type DrawerTab = "summary" | "llm" | "yaml" | "describe" | "logs" | "events" | "related" | "terminal" | "secret";

export function availableDrawerTabs(resource: string, canLogs: boolean): DrawerTab[] {
  const node = resource === "nodes" || resource === "node";
  const event = resource === "events";
  const secret = resource === "secrets" || resource === "secret";
  return [
    "summary",
    "llm",
    ...(event ? [] : ["related" as const]),
    ...(secret ? ["secret" as const] : []),
    "yaml",
    "describe",
    ...(event ? [] : ["events" as const]),
    ...(canLogs && !node ? ["logs" as const] : []),
    ...(node ? ["terminal" as const] : []),
  ];
}

interface HeaderProps {
  resource: string;
  namespace: string;
  name: string;
  onCopyName: () => void;
  onClose: () => void;
}

export function PodDrawerHeader({ resource, namespace, name, onCopyName, onClose }: HeaderProps) {
  return (
    <header>
      <div>
        <span>{displayResource(resource)} · {namespace}</span>
        <div className="drawer-title-row">
          <h2>{name}</h2>
          <button type="button" className="icon-button drawer-copy-name-button" onClick={onCopyName} title="Copy resource name" aria-label="Copy resource name">
            <Copy size={15} />
          </button>
        </div>
      </div>
      <button className="icon-button" onClick={onClose} title="Close"><X size={18} /></button>
    </header>
  );
}

interface TabsProps {
  tabs: DrawerTab[];
  active: DrawerTab;
  nodeResource: boolean;
  labels: Record<string, string | undefined>;
  llmLabel: string;
  onChange: (tab: DrawerTab) => void;
}

export function PodDrawerTabs({ tabs, active, nodeResource, labels, llmLabel, onChange }: TabsProps) {
  return (
    <nav className="drawer-tabs">
      {tabs.map((item) => (
        <button className={active === item ? "active" : ""} onClick={() => onChange(item)} key={item}>
          {item === "events" ? "Events" : item === "related" ? "Related" : item === "terminal" ? (nodeResource ? "SSH" : "Terminal") : item === "secret" ? "Secret" : item === "llm" ? llmLabel : labels[item]}
        </button>
      ))}
    </nav>
  );
}

interface ActionsProps {
  actions: ResourceAction[];
  resource: string;
  row: ResourceRow;
  loading: boolean;
  applyResult: string;
  involvedTarget: { resource: string; namespace: string; name: string } | null;
  onAction: (action: ResourceAction) => void;
  onTerminal: () => void;
  onPortForward: () => void;
  onOpenRelated: (resource: string, namespace: string, name: string) => void;
  canPortForward: boolean;
}

export function PodDrawerActions(props: ActionsProps) {
  return (
    <div className="drawer-actions">
      {props.actions.map((action) => (
        <button key={action} className={action === "delete" ? "danger" : "icon-text"} disabled={props.loading} onClick={() => props.onAction(action)}>
          {actionLabel(action, props.resource)}
        </button>
      ))}
      {props.resource === "pods" ? <button className="icon-text" disabled={props.loading} onClick={props.onTerminal}>Terminal</button> : null}
      {props.canPortForward ? <button className="icon-text" disabled={props.loading} onClick={props.onPortForward}>Port forward</button> : null}
      {props.involvedTarget ? (
        <button className="icon-text" onClick={() => props.onOpenRelated(props.involvedTarget!.resource, props.involvedTarget!.namespace, props.involvedTarget!.name)}>Open involved object</button>
      ) : null}
      {props.applyResult ? <span>{props.applyResult}</span> : null}
    </div>
  );
}
