import { useEffect, useRef, useState } from "react";
import { ApiClient } from "../api";
import type { ErrorInfo, PortForwardSession, PortForwardStartRequest, ResourceRow, Settings } from "../types";
import { ErrorPanel } from "./ErrorPanel";
import { LogsTab } from "./LogsTab";
import { YamlTab } from "./YamlTab";
import type { YamlEditorHandle } from "./YamlSourceEditor";
import { DescribeTab } from "./DescribeTab";
import { RelatedTab } from "./RelatedTab";
import { SecretTab } from "./SecretTab";
import { LlmTab } from "./LlmTab";
import { PortForwardModal, defaultPortForwardDraft, supportsPortForward } from "./PortForwardModal";
import { ResourceActionConfirmModal, TerminalContainerPickerModal, UnsavedYamlConfirmModal, YamlApplyConfirmModal, supportedActions, type ResourceAction } from "./PodDrawerModals";
import { useUiClock } from "../hooks/useUiClock";
import { ResourceSummary } from "./ResourceSummary";
import { containerNames, downloadTextFile, eventTargetForOpen } from "./podDrawerHelpers";
import { availableDrawerTabs, PodDrawerActions, PodDrawerHeader, PodDrawerTabs, type DrawerTab } from "./PodDrawerChrome";
import { drawerResourceIdentity, usePodDrawerResourceLifecycle } from "../hooks/usePodDrawerResourceLifecycle";
import { usePodDrawerLogs } from "../hooks/usePodDrawerLogs";
import { usePodDrawerYamlActions } from "../hooks/usePodDrawerYamlActions";
import { toErrorInfo } from "../utils/errors";
import type { ResourceWorkspaceTab } from "../utils/workspaceTabs";
import type { NodeActionKind } from "../hooks/useBulkResourceActions";

interface Props {
  api: ApiClient;
  clusterId: string;
  pod: ResourceRow | null;
  resource: string;
  canLogs: boolean;
  width: number;
  onResize: (width: number) => void;
  onActionComplete: () => void;
  onOpenRelated: (resource: string, namespace: string, name: string) => void;
  onDeleteRelatedPods: (rows: ResourceRow[]) => void;
  workspaceTabs: ResourceWorkspaceTab[];
  currentWorkspaceTabId: string;
  onPortForwardStarted?: (session: PortForwardSession) => void;
  onOpenTerminal: (pod: ResourceRow, containers: string[], container: string) => void;
  onOpenNodeSsh: (node: ResourceRow) => void;
  onNodeAction?: (action: NodeActionKind, rows: ResourceRow[]) => void;
  onClose: () => void;
  copyLabel: string;
  settings?: Settings;
  t: (key: string) => string;
  labels: {
    summary: string;
    yaml: string;
    describe: string;
    logs: string;
  };
  initialTab?: DrawerTab;
  onTabChange?: (tab: DrawerTab) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function PodDrawer({
  api,
  clusterId,
  pod,
  resource,
  canLogs,
  width,
  onResize,
  onActionComplete,
  onOpenRelated,
  onDeleteRelatedPods,
  workspaceTabs,
  currentWorkspaceTabId,
  onPortForwardStarted,
  onOpenTerminal,
  onOpenNodeSsh,
  onNodeAction,
  onClose,
  copyLabel,
  labels,
  settings,
  t,
  initialTab = "summary",
  onTabChange,
  onDirtyChange,
}: Props) {
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  const [applyResult, setApplyResult] = useState("");
  const [yamlStatus, setYamlStatus] = useState("");
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ResourceAction | null>(null);
  const [yamlApplyConfirmOpen, setYamlApplyConfirmOpen] = useState(false);
  const [portForwardDraft, setPortForwardDraft] = useState<PortForwardStartRequest | null>(null);
  const [replicas, setReplicas] = useState(1);
  const [relatedResourceFilter, setRelatedResourceFilter] = useState("all");
  const [terminalPickerOpen, setTerminalPickerOpen] = useState(false);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<ErrorInfo | null>(null);
  const [llmAnswer, setLlmAnswer] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmElapsedMs, setLlmElapsedMs] = useState(0);
  const [llmContextChars, setLlmContextChars] = useState(0);
  const [llmTruncated, setLlmTruncated] = useState(false);
  const editorRef = useRef<YamlEditorHandle | null>(null);
  const onTabChangeRef = useRef(onTabChange);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onTabChangeRef.current = onTabChange;
  onDirtyChangeRef.current = onDirtyChange;

  const currentObjectKey = drawerResourceIdentity(clusterId, resource, pod);
  const {
    content,
    setContent,
    describeContent,
    yamlBaseline,
    setYamlBaseline,
    yamlDraft,
    setYamlDraft,
    setYamlObjectKey,
    events,
    relatedLinks,
    relatedSources,
    relatedErrors,
    relatedLoading,
    loading,
    setLoading,
    error,
    setError,
    metrics,
    serviceEndpoints,
    usageHistory,
  } = usePodDrawerResourceLifecycle({ api, clusterId, pod, resource, tab, currentObjectKey });
  const yamlChanged = yamlDraft !== yamlBaseline;
  // Only the summary shows an age, and the drawer carries a terminal and a
  // YAML editor: ticking a clock the other tabs never read re-rendered all of
  // them once a second.
  const now = useUiClock(Boolean(pod) && tab === "summary", 1000);
  const isDeploymentResource = resource === "deployments" || resource === "deployments.apps" || resource === "deployment";
  const isNodeResource = resource === "nodes" || resource === "node";
  const {
    logsLoading,
    logsDownloadLoading,
    logsTail,
    setLogsTail,
    logsPrevious,
    setLogsPrevious,
    logsTimestamps,
    setLogsTimestamps,
    logsFollow,
    setLogsFollow,
    logsQuery,
    setLogsQuery,
    logsContainer,
    setLogsContainer,
    logsPodFilter,
    setLogsPodFilter,
    deploymentLogPods,
    deploymentLogContainers,
    downloadFullLogs,
    refreshLogs,
  } = usePodDrawerLogs({ api, clusterId, pod, resource, tab, currentObjectKey, isDeploymentResource, setContent, setError });
  const { runYamlDryRun, applyYaml, resetYamlDraft, reloadYamlFromCluster } = usePodDrawerYamlActions({
    api,
    clusterId,
    pod,
    resource,
    currentObjectKey,
    t,
    yamlDraft,
    yamlBaseline,
    setYamlBaseline,
    setYamlDraft,
    setYamlObjectKey,
    setLoading,
    setError,
    setApplyResult,
    setYamlStatus,
    setYamlApplyConfirmOpen,
    onActionComplete,
  });

  // A remembered tab carries over between objects of the same resource, so it
  // has to be dropped when this resource does not offer it.
  const drawerTabs = availableDrawerTabs(resource, canLogs);
  const resolvedInitialTab: DrawerTab = drawerTabs.includes(initialTab) ? initialTab : "summary";

  useEffect(() => onTabChangeRef.current?.(tab), [tab]);
  useEffect(() => setTab(resolvedInitialTab), [currentObjectKey, resolvedInitialTab]);
  useEffect(() => {
    onDirtyChangeRef.current?.(yamlChanged);
    return () => onDirtyChangeRef.current?.(false);
  }, [yamlChanged]);

  useEffect(() => {
    if (!canLogs && tab === "logs") setTab("summary");
  }, [canLogs, tab]);

  useEffect(() => {
    if (tab === "events" || (resource === "events" && tab === "related")) setTab("summary");
  }, [resource, tab]);

  useEffect(() => {
    setPortForwardDraft(null);
    setPendingAction(null);
    setYamlApplyConfirmOpen(false);
    setApplyResult("");
    setYamlStatus("");
    setTerminalPickerOpen(false);
    setCloseConfirmOpen(false);
    setRelatedResourceFilter("all");
    setLlmLoading(false);
    setLlmError(null);
    setLlmAnswer("");
    setLlmModel("");
    setLlmElapsedMs(0);
    setLlmContextChars(0);
    setLlmTruncated(false);
  }, [currentObjectKey]);

  useEffect(() => {
    if (!currentObjectKey || (tab !== "yaml" && tab !== "describe")) return;
    setApplyResult("");
    if (tab !== "yaml") setYamlStatus("");
  }, [tab, currentObjectKey]);

  async function runAction(action: ResourceAction) {
    if (!pod) return;
    const label = action === "delete" ? "Delete" : action === "redeploy" ? "Redeploy" : action === "scale" ? "Scale" : "Restart";

    // Close the confirmation dialog immediately. Kubernetes delete/restart operations can
    // wait for graceful termination or controller reconciliation, so keeping the modal
    // open makes the UI look frozen even though the action was accepted.
    setPendingAction(null);
    setLoading(true);
    setError(null);
    setApplyResult(`${label} requested...`);
    try {
      const result = await api.resourceAction(
        clusterId,
        resource,
        String(pod.namespace || "_cluster"),
        pod.name,
        action,
        action === "scale" ? replicas : undefined,
        action === "delete" ? "" : pod.name,
      );
      setApplyResult(result || `${label} requested`);
      onActionComplete();
      if (action === "delete" || (resource === "pods" && action === "restart")) onClose();
    } catch (err) {
      setApplyResult(`${label} failed`);
      setError(toErrorInfo(err));
    } finally {
      setLoading(false);
    }
  }

  async function startPortForward() {
    if (!portForwardDraft) return;
    setLoading(true);
    setError(null);
    setApplyResult("");
    try {
      const session = await api.startPortForward(clusterId, portForwardDraft);
      setApplyResult(`Port forward started: ${session.url} -> ${portForwardDraft.resource}/${portForwardDraft.name}:${portForwardDraft.remotePort}`);
      onPortForwardStarted?.(session);
      window.setTimeout(() => {
        setApplyResult((current) => (current.startsWith("Port forward started:") ? "" : current));
      }, 5000);
      setPortForwardDraft(null);
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setLoading(false);
    }
  }

  function closePortForwardDraft() {
    setPortForwardDraft(null);
    setApplyResult((current) => (current.startsWith("Port forward started:") ? "" : current));
  }

  async function copyText(text: string, message = "Copied") {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(text);
      setApplyResult(message);
      window.setTimeout(() => {
        setApplyResult((current) => (current === message ? "" : current));
      }, 2500);
    } catch {
      // Clipboard permission errors must not report a successful copy.
    }
  }

  function openTerminal(containerName?: string) {
    if (!pod) return;
    const containers = containerNames(pod);
    if (!containerName && containers.length > 1) {
      setTerminalPickerOpen(true);
      return;
    }
    onOpenTerminal(pod, containers, containerName ?? containers[0] ?? "");
    setTerminalPickerOpen(false);
  }

  function requestClose() {
    if (yamlChanged) {
      setCloseConfirmOpen(true);
      return;
    }
    onClose();
  }

  function keepEditingYaml() {
    setCloseConfirmOpen(false);
    window.setTimeout(() => editorRef.current?.focus(), 0);
  }

  function discardYamlAndClose() {
    setCloseConfirmOpen(false);
    setYamlDraft(yamlBaseline);
    setYamlStatus("");
    setApplyResult("");
    setError(null);
    onClose();
  }

  if (!pod) return null;

  const isCrdDefinitionResource = resource === "customresourcedefinitions" || resource === "customresourcedefinitions.apiextensions.k8s.io";
  const isCrdInstanceResource = !isCrdDefinitionResource && (Boolean(pod.crdInstance) || resource.includes("."));
  const actions = isCrdDefinitionResource ? [] : isCrdInstanceResource ? ["delete" as ResourceAction] : supportedActions(resource);
  const namespaceText = String(pod.namespace || "_cluster");
  const involvedTarget = resource === "events" ? eventTargetForOpen(pod) : null;
  const yamlReadOnly = isCrdDefinitionResource;
  return (
    <aside className="drawer" style={{ width }}>
      <div
        className="drawer-resize-handle"
        onMouseDown={(event) => {
          event.preventDefault();
          const startX = event.clientX;
          const startWidth = width;
          const onMove = (moveEvent: MouseEvent) => {
            onResize(Math.min(920, Math.max(360, startWidth + startX - moveEvent.clientX)));
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }}
      />
      <PodDrawerHeader
        resource={resource}
        namespace={namespaceText}
        name={pod.name}
        onCopyName={() => void copyText(pod.name, "Name copied")}
        onClose={requestClose}
        actions={
          <PodDrawerActions
            actions={actions}
            resource={resource}
            row={pod}
            loading={loading}
            applyResult={applyResult}
            involvedTarget={involvedTarget}
            onAction={setPendingAction}
            onTerminal={() => (isNodeResource ? onOpenNodeSsh(pod) : openTerminal())}
            onNodeAction={onNodeAction}
            canPortForward={supportsPortForward(resource, pod)}
            onPortForward={() => {
              setError(null);
              setApplyResult("");
              setPortForwardDraft(defaultPortForwardDraft(resource, pod));
            }}
            onOpenRelated={onOpenRelated}
          />
        }
      />
      <PodDrawerTabs tabs={drawerTabs} active={tab} labels={labels} llmLabel={t("llm.title")} onChange={setTab} />
      <div className={tab === "logs" || tab === "yaml" || tab === "describe" || tab === "llm" ? "drawer-content drawer-content-fill" : "drawer-content"}>
        {isCrdDefinitionResource ? (
          <section className="crd-notice">
            <strong>CRD definition is view-only</strong>
            <span>KubeDeck blocks direct edits and deletes for CustomResourceDefinition objects. Open a CRD resource from the sidebar to manage its instances.</span>
          </section>
        ) : isCrdInstanceResource ? (
          <section className="crd-notice crd-notice-info">
            <strong>CRD instance</strong>
            <span>This custom resource can be viewed, edited through YAML, or deleted if your Kubernetes RBAC allows it.</span>
          </section>
        ) : null}
        {tab === "summary" ? (
          <ResourceSummary row={{ ...pod, ...metrics, uid: pod.uid, name: pod.name }} resource={resource} now={now} events={events} serviceEndpoints={serviceEndpoints} usageHistory={usageHistory} />
        ) : tab === "llm" ? (
          <LlmTab
            api={api}
            clusterId={clusterId}
            resource={resource}
            row={pod}
            settings={settings}
            yaml={yamlDraft || yamlBaseline}
            describe={describeContent}
            events={events}
            relatedLinks={relatedLinks}
            usageHistory={usageHistory}
            loading={llmLoading}
            answer={llmAnswer}
            model={llmModel}
            elapsedMs={llmElapsedMs}
            contextChars={llmContextChars}
            truncated={llmTruncated}
            error={llmError}
            copyLabel={copyLabel}
            t={t}
            onLoadingChange={setLlmLoading}
            onAnswer={(result) => {
              setLlmAnswer(result.answer);
              setLlmModel(result.model);
              setLlmElapsedMs(result.elapsedMs);
              setLlmContextChars(result.contextChars);
              setLlmTruncated(result.truncated);
            }}
            onError={setLlmError}
            onCopy={copyText}
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
            resourceFilter={relatedResourceFilter}
            onResourceFilterChange={setRelatedResourceFilter}
            onOpenRelated={onOpenRelated}
            onDeletePods={onDeleteRelatedPods}
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
                  setYamlStatus("");
                }}
                yamlChanged={yamlChanged}
                loading={loading}
                status={yamlStatus}
                editorRef={editorRef}
                onReset={resetYamlDraft}
                onReloadFromCluster={reloadYamlFromCluster}
                onDryRun={() => void runYamlDryRun()}
                onRequestApply={() => {
                  if (!yamlReadOnly) setYamlApplyConfirmOpen(true);
                }}
                readOnly={yamlReadOnly}
                readOnlyReason={yamlReadOnly ? "view-only CRD definition" : ""}
                t={t}
                api={api}
                current={{ clusterId, resource, namespace: namespaceText, name: pod.name, label: `${clusterId} · ${namespaceText}/${pod.name}` }}
                candidates={workspaceTabs.filter((item) => item.id !== currentWorkspaceTabId && item.resource.split(".")[0] === resource.split(".")[0])}
              />
            ) : tab === "logs" ? (
              <LogsTab
                content={content}
                loading={logsLoading}
                query={logsQuery}
                onQueryChange={setLogsQuery}
                tail={logsTail}
                onTailChange={setLogsTail}
                previous={logsPrevious}
                onPreviousChange={setLogsPrevious}
                timestamps={logsTimestamps}
                onTimestampsChange={setLogsTimestamps}
                follow={logsFollow}
                onFollowChange={setLogsFollow}
                containers={isDeploymentResource ? deploymentLogContainers : containerNames(pod)}
                selectedContainer={isDeploymentResource ? logsContainer : logsContainer || containerNames(pod)[0] || ""}
                onContainerChange={setLogsContainer}
                allowAllContainers={isDeploymentResource}
                targetPods={isDeploymentResource ? deploymentLogPods : []}
                selectedTargetPod={logsPodFilter}
                onTargetPodChange={setLogsPodFilter}
                contextLabel={isDeploymentResource ? "deployment" : "pod"}
                fullDownloadLabel={isDeploymentResource ? "Full deployment log" : "Full pod log"}
                onRefresh={refreshLogs}
                refreshFailed={Boolean(error)}
                t={t}
                onCopy={() => copyText(content, "Logs copied")}
                downloadLoading={logsDownloadLoading}
                onDownloadVisible={(visibleText) => downloadTextFile(`${pod.name}.visible.log`, visibleText)}
                onDownloadFull={downloadFullLogs}
              />
            ) : (
              <DescribeTab content={content} />
            )}
          </>
        )}
      </div>
      {pendingAction && pod ? (
        <ResourceActionConfirmModal
          action={pendingAction}
          resource={resource}
          row={pod}
          replicas={replicas}
          onReplicasChange={setReplicas}
          loading={loading}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void runAction(pendingAction)}
        />
      ) : null}
      {portForwardDraft ? (
        <PortForwardModal
          draft={portForwardDraft}
          row={pod}
          error={error}
          copyLabel={copyLabel}
          loading={loading}
          onDraftChange={setPortForwardDraft}
          onCancel={closePortForwardDraft}
          onStart={startPortForward}
        />
      ) : null}
      {yamlApplyConfirmOpen && pod ? (
        <YamlApplyConfirmModal resource={resource} row={pod} loading={loading} onCancel={() => setYamlApplyConfirmOpen(false)} onApply={() => void applyYaml(pod.name)} />
      ) : null}
      {closeConfirmOpen ? <UnsavedYamlConfirmModal resource={resource} row={pod} onDiscard={discardYamlAndClose} onContinueEditing={keepEditingYaml} /> : null}
      {terminalPickerOpen && pod ? <TerminalContainerPickerModal row={pod} containers={containerNames(pod)} onCancel={() => setTerminalPickerOpen(false)} onOpenContainer={openTerminal} /> : null}
    </aside>
  );
}
