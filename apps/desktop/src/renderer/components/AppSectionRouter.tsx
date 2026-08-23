import { lazy } from "react";
import type { ApiClient } from "../api";
import type { ResourceWorkspaceTab } from "../utils/workspaceTabs";
import type { BottomTerminalTarget } from "./BottomTerminalPanel";
import { isPlaceholderSection, sectionTitle } from "../navigation";
import type { ApiKeyUpdate, AppConfig, Cluster, ErrorInfo, ResourceDefinition, ResourceRow, Section, Settings } from "../types";
import { canDeleteResource } from "../utils/kubeResources";
import { AppResourceTable } from "./AppResourceTable";
import { DisconnectedClusterPanel } from "./DisconnectedClusterPanel";
import { LazySurface } from "./LazySurface";
import { PlaceholderSection } from "./PlaceholderSection";
import type { Column } from "./ResourceTable";
import { UnavailableClusterPanel } from "./UnavailableClusterPanel";

// The panels live in their own chunks: a section nobody opens is never
// downloaded. Keep these declarations here rather than in App, so the chunk
// boundary follows the router that decides which one is needed.
const AboutPanel = lazy(() => import("./AboutPanel").then((module) => ({ default: module.AboutPanel })));
const HelpPanel = lazy(() => import("./HelpPanel").then((module) => ({ default: module.HelpPanel })));
const OverviewPanel = lazy(() => import("./OverviewPanel").then((module) => ({ default: module.OverviewPanel })));
const PortForwardsPanel = lazy(() => import("./PortForwardsPanel").then((module) => ({ default: module.PortForwardsPanel })));
const ProblemsPanel = lazy(() => import("./ProblemsPanel").then((module) => ({ default: module.ProblemsPanel })));
const SettingsPanel = lazy(() => import("./SettingsPanel").then((module) => ({ default: module.SettingsPanel })));

interface Props {
  section: Section;
  resourceTab: string;
  api: ApiClient | null;
  config: AppConfig | null;
  settings: Settings | undefined;
  clusters: Cluster[];
  activeCluster: Cluster | null;
  activeClusterConnected: boolean;
  unavailableCluster: Cluster | null;
  openingClusterId: string | null;
  reorderingClusters: boolean;
  backendOk: boolean;
  kubectlVersion: string;
  selectedNamespaces: string[];
  resourceWorkspaceTabs: ResourceWorkspaceTab[];
  bottomTerminals: BottomTerminalTarget[];
  error: ErrorInfo | null;
  rows: ResourceRow[];
  columns: Column[];
  loading: boolean;
  selectedRow: ResourceRow | null;
  selectedDefinition: ResourceDefinition | undefined;
  isCrdDefinitionTab: boolean;
  t: (key: string) => string;
  onError: (error: ErrorInfo | null) => void;
  onSelectSection: (section: Section) => void;
  onSelectResource: (section: Section, resource: string) => void;
  onActivateTab: (tab: ResourceWorkspaceTab) => void;
  onSaveSettings: (next: Settings, apiKeyUpdate?: ApiKeyUpdate) => Promise<void>;
  onLanguagePreview: (language: Settings["language"] | null) => void;
  onImportKubeconfig: () => Promise<unknown>;
  onOpenCluster: (cluster: Cluster) => Promise<unknown>;
  onRenameCluster: (cluster: Cluster) => void;
  onRemoveCluster: (cluster: Cluster) => Promise<void>;
  onReorderClusters: (clusters: Cluster[]) => Promise<void> | void;
  onOpenResourceLocator: (row: ResourceRow) => Promise<void>;
  onRefreshResources: () => void;
  onNodeAction: (action: "cordon" | "uncordon" | "drain", rows: ResourceRow[]) => Promise<void>;
  onVisibleNodeRows: (rows: ResourceRow[]) => void;
  onSelectRow: (row: ResourceRow, resource: string) => void;
  onPinRow: (row: ResourceRow, resource: string) => void;
  onNamespaceClick: (namespace: string) => void;
  onBulkDelete: (resource: string, rows: ResourceRow[]) => void;
}

// Which surface the chosen section shows. Everything that is not one of the
// named panels is a resource table - which is why the fallback also carries the
// two states that replace it: a cluster that could not be reached, and one that
// is configured but not connected.
export function AppSectionRouter(props: Props) {
  const { section, activeCluster, selectedNamespaces, t } = props;

  if (section === "overview") {
    return (
      <LazySurface resetKey={`overview:${activeCluster?.id ?? "none"}:${selectedNamespaces.join(",")}`}>
        <OverviewPanel
          api={props.api}
          cluster={activeCluster}
          namespaces={selectedNamespaces.includes("_cluster") ? ["all"] : selectedNamespaces}
          settings={props.settings}
          recentTabs={props.resourceWorkspaceTabs.filter((tab) => tab.clusterId === activeCluster?.id)}
          terminalCount={props.bottomTerminals.filter((target) => target.clusterId === activeCluster?.id).length}
          onError={props.onError}
          onNavigate={(resource) => {
            if (resource === "problems") props.onSelectSection("problems");
            else if (resource === "events") props.onSelectSection("events");
            else {
              const targetSection = resource === "nodes" ? "nodes" : resource === "persistentvolumeclaims" ? "storage" : "workloads";
              props.onSelectResource(targetSection, resource);
            }
          }}
          onOpenTab={(tab) => props.onActivateTab(tab)}
          t={t}
        />
      </LazySurface>
    );
  }

  if (section === "help") {
    return (
      <LazySurface resetKey="help">
        <HelpPanel t={t} />
      </LazySurface>
    );
  }

  if (section === "about") {
    return (
      <LazySurface resetKey="about">
        <AboutPanel api={props.api} config={props.config} activeCluster={activeCluster} backendOk={props.backendOk} kubectlVersion={props.kubectlVersion} t={t} onError={props.onError} />
      </LazySurface>
    );
  }

  if (section === "settings" && props.config) {
    return (
      <LazySurface resetKey="settings">
        <SettingsPanel
          api={props.api}
          settings={props.config.settings}
          save={props.onSaveSettings}
          onLanguagePreview={props.onLanguagePreview}
          t={t}
          clusters={props.clusters}
          activeCluster={activeCluster}
          selectedNamespaces={selectedNamespaces}
          resourceTab={props.resourceTab}
          openingClusterId={props.openingClusterId}
          importKubeconfig={props.onImportKubeconfig}
          openCluster={props.onOpenCluster}
          renameCluster={props.onRenameCluster}
          removeCluster={props.onRemoveCluster}
          reorderClusters={props.onReorderClusters}
          reorderingClusters={props.reorderingClusters}
          onError={props.onError}
        />
      </LazySurface>
    );
  }

  if (section === "problems") {
    return (
      <LazySurface resetKey="problems">
        <ProblemsPanel
          api={props.api}
          cluster={activeCluster}
          settings={props.settings}
          copyLabel={t("error.copy")}
          t={t}
          onError={props.onError}
          onOpenResource={(row) => {
            void props.onOpenResourceLocator(row);
          }}
        />
      </LazySurface>
    );
  }

  if (section === "port-forwards") {
    return (
      <LazySurface resetKey="port-forwards">
        <PortForwardsPanel api={props.api} cluster={activeCluster} copyLabel={t("error.copy")} t={t} onError={props.onError} />
      </LazySurface>
    );
  }

  if (isPlaceholderSection(section)) {
    return <PlaceholderSection section={section} t={t} />;
  }

  return (
    <>
      <UnavailableClusterPanel
        visible={Boolean(props.unavailableCluster && props.error)}
        displayName={props.unavailableCluster?.displayName ?? ""}
        opening={Boolean(props.unavailableCluster && props.openingClusterId === props.unavailableCluster.id)}
        t={t}
        onRetry={() => {
          if (props.unavailableCluster) void props.onOpenCluster(props.unavailableCluster);
        }}
        onRemove={() => {
          if (props.unavailableCluster) void props.onRemoveCluster(props.unavailableCluster);
        }}
      />
      <DisconnectedClusterPanel
        visible={Boolean(activeCluster) && !props.activeClusterConnected && !props.unavailableCluster}
        displayName={activeCluster?.displayName ?? ""}
        connecting={Boolean(activeCluster && props.openingClusterId === activeCluster.id)}
        t={t}
        onConnect={() => {
          if (activeCluster) void props.onOpenCluster(activeCluster);
        }}
      />
      {activeCluster && props.activeClusterConnected ? (
        <AppResourceTable
          title={sectionTitle(section, props.resourceTab, t)}
          rows={props.rows}
          columns={props.columns}
          loading={props.loading}
          resource={props.resourceTab}
          onRefresh={props.onRefreshResources}
          onNodeAction={props.onNodeAction}
          onVisibleNodeRows={props.onVisibleNodeRows}
          onOpenLocator={props.onOpenResourceLocator}
          onSelect={props.onSelectRow}
          onPin={props.onPinRow}
          selectedRow={props.selectedRow}
          onNamespaceClick={props.onNamespaceClick}
          canBulkDelete={!props.isCrdDefinitionTab && canDeleteResource(props.selectedDefinition)}
          onBulkDelete={props.onBulkDelete}
          t={t}
        />
      ) : null}
    </>
  );
}
