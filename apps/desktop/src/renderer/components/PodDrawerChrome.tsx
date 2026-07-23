import {
  Bell,
  Copy,
  ExternalLink,
  FileCode2,
  FileText,
  KeyRound,
  LayoutDashboard,
  List,
  LogOut,
  Maximize2,
  Network,
  RotateCw,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ResourceRow } from "../types";
import type { NodeActionKind } from "../hooks/useBulkResourceActions";
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
  actions?: ReactNode;
}

export function PodDrawerHeader({ resource, namespace, name, onCopyName, onClose, actions }: HeaderProps) {
  return (
    <header>
      <div className="drawer-resource-identity">
        <span>
          {displayResource(resource)} · {namespace}
        </span>
        <div className="drawer-title-row">
          <h2>{name}</h2>
          <button type="button" className="icon-button drawer-copy-name-button" onClick={onCopyName} title="Copy resource name" aria-label="Copy resource name">
            <Copy size={15} />
          </button>
        </div>
      </div>
      <div className="drawer-header-actions">
        {actions}
        <button className="icon-button" onClick={onClose} title="Close" aria-label="Close resource">
          <X size={18} />
        </button>
      </div>
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
      {tabs.map((item) => {
        const label = drawerTabLabel(item, nodeResource, labels, llmLabel);
        return (
          <button
            className={`icon-button drawer-tab-button ${active === item ? "active" : ""}`}
            onClick={() => onChange(item)}
            key={item}
            title={label}
            data-tooltip={label}
            aria-label={label}
            aria-current={active === item ? "page" : undefined}
          >
            {drawerTabIcon(item)}
          </button>
        );
      })}
    </nav>
  );
}

function drawerTabLabel(item: DrawerTab, nodeResource: boolean, labels: Record<string, string | undefined>, llmLabel: string) {
  if (item === "events") return "Events";
  if (item === "related") return "Related";
  if (item === "terminal") return nodeResource ? "SSH" : "Terminal";
  if (item === "secret") return "Secret";
  if (item === "llm") return llmLabel;
  return labels[item] || item;
}

function drawerTabIcon(item: DrawerTab) {
  if (item === "summary") return <LayoutDashboard size={18} />;
  if (item === "llm") return <Sparkles size={18} />;
  if (item === "related") return <Network size={18} />;
  if (item === "yaml") return <FileCode2 size={18} />;
  if (item === "describe") return <FileText size={18} />;
  if (item === "logs") return <List size={18} />;
  if (item === "terminal") return <SquareTerminal size={18} />;
  if (item === "secret") return <KeyRound size={18} />;
  return <Bell size={18} />;
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
  onNodeAction?: (action: NodeActionKind, rows: ResourceRow[]) => void;
  onPortForward: () => void;
  onOpenRelated: (resource: string, namespace: string, name: string) => void;
  canPortForward: boolean;
}

export function PodDrawerActions(props: ActionsProps) {
  const actionIcon = (action: ResourceAction) => {
    if (action === "delete") return <Trash2 size={18} strokeWidth={2.25} />;
    if (action === "scale") return <Maximize2 size={18} strokeWidth={2.25} />;
    return <RotateCw size={18} strokeWidth={2.25} />;
  };
  return (
    <div className="drawer-actions">
      {props.actions.map((action) => {
        const label = actionLabel(action, props.resource);
        return (
          <button
            key={action}
            className={`icon-button drawer-action-button ${action === "delete" ? "danger" : ""}`}
            disabled={props.loading}
            onClick={() => props.onAction(action)}
            title={label}
            data-tooltip={label}
            aria-label={label}
          >
            {actionIcon(action)}
          </button>
        );
      })}
      {props.resource === "pods" ? (
        <button className="icon-button drawer-action-button" disabled={props.loading} onClick={props.onTerminal} title="Terminal" data-tooltip="Terminal" aria-label="Terminal">
          <SquareTerminal size={18} strokeWidth={2.25} />
        </button>
      ) : null}
      {props.resource === "nodes" || props.resource === "node" ? (
        <>
          <button
            className="icon-button drawer-action-button"
            disabled={props.loading}
            onClick={() => props.onNodeAction?.(props.row.unschedulable ? "uncordon" : "cordon", [props.row])}
            title={props.row.unschedulable ? "Uncordon node" : "Cordon node"}
            data-tooltip={props.row.unschedulable ? "Uncordon node" : "Cordon node"}
            aria-label={props.row.unschedulable ? "Uncordon node" : "Cordon node"}
          >
            {props.row.unschedulable ? <ShieldCheck size={18} strokeWidth={2.25} /> : <ShieldOff size={18} strokeWidth={2.25} />}
          </button>
          <button
            className="icon-button drawer-action-button danger"
            disabled={props.loading}
            onClick={() => props.onNodeAction?.("drain", [props.row])}
            title="Drain node"
            data-tooltip="Drain node"
            aria-label="Drain node"
          >
            <LogOut size={18} strokeWidth={2.25} />
          </button>
        </>
      ) : null}
      {props.canPortForward ? (
        <button className="icon-button drawer-action-button" disabled={props.loading} onClick={props.onPortForward} title="Port forward" data-tooltip="Port forward" aria-label="Port forward">
          <Network size={18} strokeWidth={2.25} />
        </button>
      ) : null}
      {props.involvedTarget ? (
        <button
          className="icon-button drawer-action-button"
          onClick={() => props.onOpenRelated(props.involvedTarget!.resource, props.involvedTarget!.namespace, props.involvedTarget!.name)}
          title="Open involved object"
          data-tooltip="Open involved object"
          aria-label="Open involved object"
        >
          <ExternalLink size={18} strokeWidth={2.25} />
        </button>
      ) : null}
      {props.applyResult ? <span>{props.applyResult}</span> : null}
    </div>
  );
}
