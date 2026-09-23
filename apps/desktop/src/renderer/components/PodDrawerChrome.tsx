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
  Play,
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

export type DrawerTab = "summary" | "llm" | "yaml" | "describe" | "logs" | "events" | "related" | "secret";

export function availableDrawerTabs(resource: string, canLogs: boolean): DrawerTab[] {
  const node = resource === "nodes" || resource === "node";
  const event = resource === "events";
  const secret = resource === "secrets" || resource === "secret";
  return ["summary", "llm", ...(event ? [] : ["related" as const]), ...(secret ? ["secret" as const] : []), "yaml", "describe", ...(canLogs && !node ? ["logs" as const] : [])];
}

interface HeaderProps {
  resource: string;
  namespace: string;
  name: string;
  onCopyName: () => void;
  onClose: () => void;
  actions?: ReactNode;
  t: (key: string) => string;
}

export function PodDrawerHeader({ resource, namespace, name, onCopyName, onClose, actions, t }: HeaderProps) {
  return (
    <header>
      <div className="drawer-resource-identity">
        <span>
          {displayResource(resource)} · {namespace}
        </span>
        <div className="drawer-title-row">
          <h2>{name}</h2>
          <button type="button" className="icon-button drawer-copy-name-button" onClick={onCopyName} title={t("drawer.copyName")} aria-label={t("drawer.copyName")}>
            <Copy size={15} />
          </button>
        </div>
      </div>
      <div className="drawer-header-actions">
        {actions}
        <button className="icon-button" onClick={onClose} title={t("common.close")} aria-label={t("drawer.close")}>
          <X size={18} />
        </button>
      </div>
    </header>
  );
}

interface TabsProps {
  tabs: DrawerTab[];
  active: DrawerTab;
  labels: Record<string, string | undefined>;
  llmLabel: string;
  onChange: (tab: DrawerTab) => void;
  t: (key: string) => string;
}

export function PodDrawerTabs({ tabs, active, labels, llmLabel, onChange, t }: TabsProps) {
  return (
    <nav className="drawer-tabs">
      {tabs.map((item) => {
        const label = drawerTabLabel(item, labels, llmLabel, t);
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

function drawerTabLabel(item: DrawerTab, labels: Record<string, string | undefined>, llmLabel: string, t: (key: string) => string) {
  if (item === "events") return t("drawer.tab.events");
  if (item === "related") return t("drawer.tab.related");
  if (item === "secret") return t("drawer.tab.secret");
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
  t: (key: string) => string;
}

export function PodDrawerActions(props: ActionsProps) {
  const actionIcon = (action: ResourceAction) => {
    if (action === "delete") return <Trash2 size={18} strokeWidth={2.25} />;
    if (action === "trigger") return <Play size={18} strokeWidth={2.25} />;
    if (action === "scale") return <Maximize2 size={18} strokeWidth={2.25} />;
    return <RotateCw size={18} strokeWidth={2.25} />;
  };
  return (
    <div className="drawer-actions">
      {props.actions.map((action) => {
        const label = actionLabel(action, props.resource, props.t);
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
      {props.resource === "pods" || props.resource === "nodes" || props.resource === "node" ? (
        <button
          className="icon-button drawer-action-button"
          disabled={props.loading}
          onClick={props.onTerminal}
          title={props.resource === "pods" ? props.t("drawer.terminal") : "SSH"}
          data-tooltip={props.resource === "pods" ? props.t("drawer.terminal") : "SSH"}
          aria-label={props.resource === "pods" ? props.t("drawer.terminal") : "SSH"}
        >
          <SquareTerminal size={18} strokeWidth={2.25} />
        </button>
      ) : null}
      {props.resource === "nodes" || props.resource === "node" ? (
        <>
          <button
            className="icon-button drawer-action-button"
            disabled={props.loading}
            onClick={() => props.onNodeAction?.(props.row.unschedulable ? "uncordon" : "cordon", [props.row])}
            title={props.t(props.row.unschedulable ? "drawer.uncordon" : "drawer.cordon")}
            data-tooltip={props.t(props.row.unschedulable ? "drawer.uncordon" : "drawer.cordon")}
            aria-label={props.t(props.row.unschedulable ? "drawer.uncordon" : "drawer.cordon")}
          >
            {props.row.unschedulable ? <ShieldCheck size={18} strokeWidth={2.25} /> : <ShieldOff size={18} strokeWidth={2.25} />}
          </button>
          <button
            className="icon-button drawer-action-button danger"
            disabled={props.loading}
            onClick={() => props.onNodeAction?.("drain", [props.row])}
            title={props.t("drawer.drain")}
            data-tooltip={props.t("drawer.drain")}
            aria-label={props.t("drawer.drain")}
          >
            <LogOut size={18} strokeWidth={2.25} />
          </button>
        </>
      ) : null}
      {props.canPortForward ? (
        <button
          className="icon-button drawer-action-button"
          disabled={props.loading}
          onClick={props.onPortForward}
          title={props.t("drawer.portForward")}
          data-tooltip={props.t("drawer.portForward")}
          aria-label={props.t("drawer.portForward")}
        >
          <Network size={18} strokeWidth={2.25} />
        </button>
      ) : null}
      {props.involvedTarget ? (
        <button
          className="icon-button drawer-action-button"
          onClick={() => props.onOpenRelated(props.involvedTarget!.resource, props.involvedTarget!.namespace, props.involvedTarget!.name)}
          title={props.t("drawer.openInvolved")}
          data-tooltip={props.t("drawer.openInvolved")}
          aria-label={props.t("drawer.openInvolved")}
        >
          <ExternalLink size={18} strokeWidth={2.25} />
        </button>
      ) : null}
      {props.applyResult ? <span>{props.applyResult}</span> : null}
    </div>
  );
}
