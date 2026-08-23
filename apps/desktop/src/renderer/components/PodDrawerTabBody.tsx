import type { RefObject } from "react";
import type { ApiClient } from "../api";
import type { PodDrawerLlmState } from "../hooks/usePodDrawerLlm";
import type { usePodDrawerLogs } from "../hooks/usePodDrawerLogs";
import type { usePodDrawerResourceLifecycle } from "../hooks/usePodDrawerResourceLifecycle";
import type { usePodDrawerYamlActions } from "../hooks/usePodDrawerYamlActions";
import type { ResourceRow, Settings } from "../types";
import type { ResourceWorkspaceTab } from "../utils/workspaceTabs";
import { DescribeTab } from "./DescribeTab";
import { ErrorPanel } from "./ErrorPanel";
import { LlmTab } from "./LlmTab";
import { LogsTab } from "./LogsTab";
import { containerNames, downloadTextFile } from "./podDrawerHelpers";
import type { DrawerTab } from "./PodDrawerChrome";
import { RelatedTab } from "./RelatedTab";
import { ResourceSummary } from "./ResourceSummary";
import { SecretTab } from "./SecretTab";
import type { YamlEditorHandle } from "./YamlSourceEditor";
import { YamlTab } from "./YamlTab";

// The hooks already group their state; passing those bundles whole keeps this
// component's surface at what the drawer decides, rather than re-listing forty
// individual values.
type Lifecycle = ReturnType<typeof usePodDrawerResourceLifecycle>;
type Logs = ReturnType<typeof usePodDrawerLogs>;
type YamlActions = ReturnType<typeof usePodDrawerYamlActions>;

interface Props {
  tab: DrawerTab;
  api: ApiClient;
  clusterId: string;
  pod: ResourceRow;
  resource: string;
  settings?: Settings;
  copyLabel: string;
  t: (key: string) => string;
  now: number;
  lifecycle: Lifecycle;
  logs: Logs;
  yamlActions: YamlActions;
  llm: PodDrawerLlmState;
  isCrdDefinitionResource: boolean;
  isCrdInstanceResource: boolean;
  isDeploymentResource: boolean;
  yamlChanged: boolean;
  yamlReadOnly: boolean;
  yamlStatus: string;
  namespaceText: string;
  editorRef: RefObject<YamlEditorHandle | null>;
  workspaceTabs: ResourceWorkspaceTab[];
  currentWorkspaceTabId: string;
  relatedResourceFilter: string;
  onRelatedResourceFilterChange: (value: string) => void;
  onOpenRelated: (resource: string, namespace: string, name: string) => void;
  onDeleteRelatedPods: (rows: ResourceRow[]) => void;
  onYamlStatusChange: (value: string) => void;
  onRequestYamlApply: () => void;
  onCopy: (text: string, message?: string) => void;
}

export function PodDrawerTabBody(props: Props) {
  const { tab, pod, resource, api, clusterId, copyLabel, t, lifecycle, logs, yamlActions, llm } = props;
  const {
    content,
    describeContent,
    yamlBaseline,
    yamlDraft,
    setYamlDraft,
    events,
    relatedLinks,
    relatedSources,
    relatedErrors,
    relatedLoading,
    loading,
    error,
    metrics,
    serviceEndpoints,
    usageHistory,
  } = lifecycle;

  return (
    <div className={tab === "logs" || tab === "yaml" || tab === "describe" || tab === "llm" ? "drawer-content drawer-content-fill" : "drawer-content"}>
      {props.isCrdDefinitionResource ? (
        <section className="crd-notice">
          <strong>CRD definition is view-only</strong>
          <span>KubeDeck blocks direct edits and deletes for CustomResourceDefinition objects. Open a CRD resource from the sidebar to manage its instances.</span>
        </section>
      ) : props.isCrdInstanceResource ? (
        <section className="crd-notice crd-notice-info">
          <strong>CRD instance</strong>
          <span>This custom resource can be viewed, edited through YAML, or deleted if your Kubernetes RBAC allows it.</span>
        </section>
      ) : null}
      {tab === "summary" ? (
        <ResourceSummary
          row={{ ...pod, ...metrics, uid: pod.uid, name: pod.name }}
          resource={resource}
          now={props.now}
          events={events}
          serviceEndpoints={serviceEndpoints}
          usageHistory={usageHistory}
          onCopy={props.onCopy}
        />
      ) : tab === "llm" ? (
        <LlmTab
          api={api}
          clusterId={clusterId}
          resource={resource}
          row={pod}
          settings={props.settings}
          yaml={yamlDraft || yamlBaseline}
          describe={describeContent}
          events={events}
          relatedLinks={relatedLinks}
          usageHistory={usageHistory}
          loading={llm.loading}
          answer={llm.answer}
          model={llm.model}
          elapsedMs={llm.elapsedMs}
          contextChars={llm.contextChars}
          truncated={llm.truncated}
          error={llm.error}
          copyLabel={copyLabel}
          t={t}
          onLoadingChange={llm.setLoading}
          onAnswer={llm.setAnswer}
          onError={llm.setError}
          onCopy={props.onCopy}
        />
      ) : tab === "related" ? (
        <RelatedTab
          pod={pod}
          relatedLinks={relatedLinks}
          loading={relatedLoading}
          error={error}
          copyLabel={copyLabel}
          sources={relatedSources}
          errors={relatedErrors}
          resourceFilter={props.relatedResourceFilter}
          onResourceFilterChange={props.onRelatedResourceFilterChange}
          onOpenRelated={props.onOpenRelated}
          onDeletePods={props.onDeleteRelatedPods}
          sourceResource={resource}
        />
      ) : tab === "secret" ? (
        <SecretTab api={api} clusterId={clusterId} row={pod} copyLabel={copyLabel} t={t} />
      ) : (
        <>
          {loading ? <div className="muted">Loading...</div> : null}
          <ErrorPanel error={error} copyLabel={copyLabel} />
          {tab === "yaml" ? (
            <YamlTab
              yamlDraft={yamlDraft}
              setYamlDraft={(value) => {
                setYamlDraft(value);
                props.onYamlStatusChange("");
              }}
              yamlChanged={props.yamlChanged}
              loading={loading}
              status={props.yamlStatus}
              editorRef={props.editorRef}
              onReset={yamlActions.resetYamlDraft}
              onReloadFromCluster={yamlActions.reloadYamlFromCluster}
              onDryRun={() => void yamlActions.runYamlDryRun()}
              onRequestApply={props.onRequestYamlApply}
              readOnly={props.yamlReadOnly}
              readOnlyReason={props.yamlReadOnly ? "view-only CRD definition" : ""}
              t={t}
              api={api}
              current={{ clusterId, resource, namespace: props.namespaceText, name: pod.name, label: `${clusterId} · ${props.namespaceText}/${pod.name}` }}
              candidates={props.workspaceTabs.filter((item) => item.id !== props.currentWorkspaceTabId && item.resource.split(".")[0] === resource.split(".")[0])}
            />
          ) : tab === "logs" ? (
            <LogsTab
              content={content}
              loading={logs.logsLoading}
              query={logs.logsQuery}
              onQueryChange={logs.setLogsQuery}
              tail={logs.logsTail}
              onTailChange={logs.setLogsTail}
              previous={logs.logsPrevious}
              onPreviousChange={logs.setLogsPrevious}
              timestamps={logs.logsTimestamps}
              onTimestampsChange={logs.setLogsTimestamps}
              follow={logs.logsFollow}
              onFollowChange={logs.setLogsFollow}
              containers={props.isDeploymentResource ? logs.deploymentLogContainers : containerNames(pod)}
              selectedContainer={props.isDeploymentResource ? logs.logsContainer : logs.logsContainer || containerNames(pod)[0] || ""}
              onContainerChange={logs.setLogsContainer}
              allowAllContainers={props.isDeploymentResource}
              targetPods={props.isDeploymentResource ? logs.deploymentLogPods : []}
              selectedTargetPod={logs.logsPodFilter}
              onTargetPodChange={logs.setLogsPodFilter}
              contextLabel={props.isDeploymentResource ? "deployment" : "pod"}
              fullDownloadLabel={props.isDeploymentResource ? "Full deployment log" : "Full pod log"}
              onRefresh={logs.refreshLogs}
              refreshFailed={Boolean(error)}
              t={t}
              onCopy={() => props.onCopy(content, "Logs copied")}
              downloadLoading={logs.logsDownloadLoading}
              onDownloadVisible={(visibleText) => downloadTextFile(`${pod.name}.visible.log`, visibleText)}
              onDownloadFull={logs.downloadFullLogs}
            />
          ) : (
            <DescribeTab content={content} />
          )}
        </>
      )}
    </div>
  );
}
