import { lazy } from "react";
import type { ApiClient } from "../api";
import type { ResourceRow, Settings } from "../types";
import type { ResourceWorkspaceTab } from "../utils/workspaceTabs";
import { LazySurface } from "./LazySurface";
import type { DrawerTab } from "./PodDrawerChrome";
import { ResourceWorkspaceTabs } from "./ResourceWorkspaceTabs";

const PodDrawer = lazy(() => import("./PodDrawer").then((module) => ({ default: module.PodDrawer })));

interface Props {
  api: ApiClient | null;
  clusterId: string | null;
  width: number;
  tabs: ResourceWorkspaceTab[];
  activeTabId: string | null;
  activeTab: ResourceWorkspaceTab | null | undefined;
  displayedTab: ResourceWorkspaceTab | null | undefined;
  row: ResourceRow | null;
  resource: string;
  settings: Settings | undefined;
  t: (key: string) => string;
  onActivateTab: (tab: ResourceWorkspaceTab) => void;
  onCloseTab: (id: string) => void;
  onResize: (width: number) => void;
  onActionComplete: () => void;
  onOpenRelated: (resource: string, namespace: string, name: string) => void;
  onDeleteRelatedPods: (rows: ResourceRow[]) => void;
  onPortForwardStarted: () => void;
  onOpenTerminal: (pod: ResourceRow, containers: string[], container: string) => void;
  onOpenNodeSsh: (node: ResourceRow) => void;
  onNodeAction: (action: "cordon" | "uncordon" | "drain", rows: ResourceRow[]) => void;
  onDrawerTabChange: (tab: DrawerTab) => void;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
}

// The right-hand column: the saved resource tabs, and under them either the
// drawer for the displayed object or the reason it is not there yet.
export function AppResourceWorkspace(props: Props) {
  const { api, clusterId, row, displayedTab, activeTab } = props;
  if (!props.tabs.length && !row) return null;

  return (
    <div className="resource-workspace" style={{ width: props.width }}>
      {props.tabs.length ? <ResourceWorkspaceTabs tabs={props.tabs} activeId={props.activeTabId} onActivate={props.onActivateTab} onClose={props.onCloseTab} /> : null}
      {activeTab?.status && activeTab.status !== "ready" && !row ? (
        <section className="resource-workspace-status">
          <strong>{activeTab.row.name}</strong>
          <span>{activeTab.status}</span>
          <button type="button" onClick={() => props.onActivateTab(activeTab)}>
            Retry
          </button>
        </section>
      ) : api && clusterId && row && displayedTab ? (
        <LazySurface resetKey={`drawer:${row.uid ?? row.name}`}>
          <PodDrawer
            api={api}
            clusterId={clusterId}
            pod={row}
            resource={props.resource}
            canLogs={props.resource === "pods" || props.resource === "deployments" || props.resource === "deployments.apps"}
            width={props.width}
            onResize={props.onResize}
            onActionComplete={props.onActionComplete}
            onOpenRelated={props.onOpenRelated}
            onDeleteRelatedPods={props.onDeleteRelatedPods}
            workspaceTabs={props.tabs}
            currentWorkspaceTabId={displayedTab.id}
            onPortForwardStarted={props.onPortForwardStarted}
            onOpenTerminal={props.onOpenTerminal}
            onOpenNodeSsh={props.onOpenNodeSsh}
            onNodeAction={props.onNodeAction}
            initialTab={displayedTab.drawerTab as DrawerTab}
            onTabChange={props.onDrawerTabChange}
            onDirtyChange={props.onDirtyChange}
            onClose={props.onClose}
            copyLabel={props.t("error.copy")}
            settings={props.settings}
            t={props.t}
            labels={{ summary: props.t("drawer.summary"), yaml: props.t("drawer.yaml"), describe: props.t("drawer.describe"), logs: props.t("drawer.logs") }}
          />
        </LazySurface>
      ) : null}
    </div>
  );
}
