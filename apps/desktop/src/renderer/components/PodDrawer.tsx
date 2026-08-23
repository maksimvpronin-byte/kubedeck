import { useEffect, useRef, useState } from "react";
import { ApiClient } from "../api";
import type { PortForwardSession, PortForwardStartRequest, ResourceRow, Settings } from "../types";
import type { YamlEditorHandle } from "./YamlSourceEditor";
import { PortForwardModal, defaultPortForwardDraft, supportsPortForward } from "./PortForwardModal";
import { ResourceActionConfirmModal, TerminalContainerPickerModal, UnsavedYamlConfirmModal, YamlApplyConfirmModal, actionLabel, supportedActions, type ResourceAction } from "./PodDrawerModals";
import { useUiClock } from "../hooks/useUiClock";
import { containerNames, eventTargetForOpen } from "./podDrawerHelpers";
import { availableDrawerTabs, PodDrawerActions, PodDrawerHeader, PodDrawerTabs, type DrawerTab } from "./PodDrawerChrome";
import { PodDrawerTabBody } from "./PodDrawerTabBody";
import { drawerResourceIdentity, usePodDrawerResourceLifecycle } from "../hooks/usePodDrawerResourceLifecycle";
import { usePodDrawerLlm } from "../hooks/usePodDrawerLlm";
import { usePodDrawerLogs } from "../hooks/usePodDrawerLogs";
import { usePodDrawerYamlActions } from "../hooks/usePodDrawerYamlActions";
import { toErrorInfo } from "../utils/errors";
import type { ResourceWorkspaceTab } from "../utils/workspaceTabs";
import { manualJobName } from "../utils/manualJobName";
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
  const [triggerJobName, setTriggerJobName] = useState("");
  const [yamlApplyConfirmOpen, setYamlApplyConfirmOpen] = useState(false);
  const [portForwardDraft, setPortForwardDraft] = useState<PortForwardStartRequest | null>(null);
  const [replicas, setReplicas] = useState(1);
  const [relatedResourceFilter, setRelatedResourceFilter] = useState("all");
  const [terminalPickerOpen, setTerminalPickerOpen] = useState(false);
  const editorRef = useRef<YamlEditorHandle | null>(null);
  const onTabChangeRef = useRef(onTabChange);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onTabChangeRef.current = onTabChange;
  onDirtyChangeRef.current = onDirtyChange;

  const currentObjectKey = drawerResourceIdentity(clusterId, resource, pod);
  const llm = usePodDrawerLlm(currentObjectKey);
  const lifecycle = usePodDrawerResourceLifecycle({ api, clusterId, pod, resource, tab, currentObjectKey });
  const { setContent, yamlBaseline, setYamlBaseline, yamlDraft, setYamlDraft, setYamlObjectKey, loading, setLoading, error, setError } = lifecycle;
  const yamlChanged = yamlDraft !== yamlBaseline;
  // Only the summary shows an age, and the drawer carries a terminal and a
  // YAML editor: ticking a clock the other tabs never read re-rendered all of
  // them once a second.
  const now = useUiClock(Boolean(pod) && tab === "summary", 1000);
  const isDeploymentResource = resource === "deployments" || resource === "deployments.apps" || resource === "deployment";
  const isNodeResource = resource === "nodes" || resource === "node";
  const logs = usePodDrawerLogs({ api, clusterId, pod, resource, tab, currentObjectKey, isDeploymentResource, setContent, setError });
  const yamlActions = usePodDrawerYamlActions({
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
  const { applyYaml } = yamlActions;

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
  }, [currentObjectKey]);

  useEffect(() => {
    if (!currentObjectKey || (tab !== "yaml" && tab !== "describe")) return;
    setApplyResult("");
    if (tab !== "yaml") setYamlStatus("");
  }, [tab, currentObjectKey]);

  async function runAction(action: ResourceAction) {
    if (!pod) return;
    const label = actionLabel(action, resource);

    // Close the confirmation dialog immediately. Kubernetes delete/restart operations can
    // wait for graceful termination or controller reconciliation, so keeping the modal
    // open makes the UI look frozen even though the action was accepted.
    setPendingAction(null);
    setLoading(true);
    setError(null);
    setApplyResult(`${label} requested...`);
    try {
      const result = await api.resourceAction(clusterId, resource, String(pod.namespace || "_cluster"), pod.name, action, {
        ...(action === "scale" ? { replicas } : {}),
        ...(action === "trigger" ? { jobName: triggerJobName } : {}),
        typedName: action === "delete" ? "" : pod.name,
      });
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
            onAction={(action) => {
              // Fixed at the press, not at each render of the confirmation, so
              // the name in the preview is the name the Job is created under.
              if (action === "trigger") setTriggerJobName(manualJobName(pod.name, Date.now()));
              setPendingAction(action);
            }}
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
      <PodDrawerTabBody
        tab={tab}
        api={api}
        clusterId={clusterId}
        pod={pod}
        resource={resource}
        settings={settings}
        copyLabel={copyLabel}
        t={t}
        now={now}
        lifecycle={lifecycle}
        logs={logs}
        yamlActions={yamlActions}
        llm={llm}
        isCrdDefinitionResource={isCrdDefinitionResource}
        isCrdInstanceResource={isCrdInstanceResource}
        isDeploymentResource={isDeploymentResource}
        yamlChanged={yamlChanged}
        yamlReadOnly={yamlReadOnly}
        yamlStatus={yamlStatus}
        namespaceText={namespaceText}
        editorRef={editorRef}
        workspaceTabs={workspaceTabs}
        currentWorkspaceTabId={currentWorkspaceTabId}
        relatedResourceFilter={relatedResourceFilter}
        onRelatedResourceFilterChange={setRelatedResourceFilter}
        onOpenRelated={onOpenRelated}
        onDeleteRelatedPods={onDeleteRelatedPods}
        onYamlStatusChange={setYamlStatus}
        onRequestYamlApply={() => {
          if (!yamlReadOnly) setYamlApplyConfirmOpen(true);
        }}
        onCopy={copyText}
      />
      {pendingAction && pod ? (
        <ResourceActionConfirmModal
          action={pendingAction}
          resource={resource}
          row={pod}
          replicas={replicas}
          onReplicasChange={setReplicas}
          jobName={triggerJobName}
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
