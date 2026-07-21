import { useEffect, useRef, useState } from "react";
import { ApiClient } from "../api";
import type { ErrorInfo, PortForwardSession, PortForwardStartRequest, ResourceRow, Settings } from "../types";
import { ErrorPanel } from "./ErrorPanel";
import { NodeSshTab } from "./NodeSshTab";
import { LogsTab } from "./LogsTab";
import { YamlTab } from "./YamlTab";
import { DescribeTab } from "./DescribeTab";
import { EventsTab } from "./EventsTab";
import { RelatedTab } from "./RelatedTab";
import { SecretTab } from "./SecretTab";
import { LlmTab } from "./LlmTab";
import { PortForwardModal, defaultPortForwardDraft, supportsPortForward } from "./PortForwardModal";
import { ResourceActionConfirmModal, TerminalContainerPickerModal, UnsavedYamlConfirmModal, YamlApplyConfirmModal, supportedActions, type ResourceAction } from "./PodDrawerModals";
import { useUiClock } from "../hooks/useUiClock";
import { ResourceSummary } from "./ResourceSummary";
import { containerNames, downloadTextFile, eventTargetForOpen, isAbortError } from "./podDrawerHelpers";
import { availableDrawerTabs, PodDrawerActions, PodDrawerHeader, PodDrawerTabs, type DrawerTab } from "./PodDrawerChrome";
import { drawerResourceIdentity, usePodDrawerResourceLifecycle } from "../hooks/usePodDrawerResourceLifecycle";
import { toErrorInfo } from "../utils/errors";

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
  onPortForwardStarted?: (session: PortForwardSession) => void;
  onOpenTerminal: (pod: ResourceRow, containers: string[], container: string) => void;
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
}

export function PodDrawer({ api, clusterId, pod, resource, canLogs, width, onResize, onActionComplete, onOpenRelated, onPortForwardStarted, onOpenTerminal, onClose, copyLabel, labels, settings, t }: Props) {
  const [tab, setTab] = useState<DrawerTab>("summary");
  const [applyResult, setApplyResult] = useState("");
  const [yamlStatus, setYamlStatus] = useState("");
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ResourceAction | null>(null);
  const [yamlApplyConfirmOpen, setYamlApplyConfirmOpen] = useState(false);
  const [portForwardDraft, setPortForwardDraft] = useState<PortForwardStartRequest | null>(null);
  const [replicas, setReplicas] = useState(1);
  const [eventTypeFilter, setEventTypeFilter] = useState<"all" | "warning" | "normal">("all");
  const [eventSort, setEventSort] = useState<"newest" | "oldest">("newest");
  const [relatedResourceFilter, setRelatedResourceFilter] = useState("all");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsDownloadLoading, setLogsDownloadLoading] = useState(false);
  const [terminalPickerOpen, setTerminalPickerOpen] = useState(false);
  const [logsTail, setLogsTail] = useState(500);
  const [logsPrevious, setLogsPrevious] = useState(false);
  const [logsTimestamps, setLogsTimestamps] = useState(false);
  const [logsFollow, setLogsFollow] = useState(false);
  const [logsQuery, setLogsQuery] = useState("");
  const [logsRefreshToken, setLogsRefreshToken] = useState(0);
  const [logsContainer, setLogsContainer] = useState("");
  const [logsPodFilter, setLogsPodFilter] = useState("");
  const [deploymentLogPods, setDeploymentLogPods] = useState<string[]>([]);
  const [deploymentLogContainers, setDeploymentLogContainers] = useState<string[]>([]);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<ErrorInfo | null>(null);
  const [llmAnswer, setLlmAnswer] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmElapsedMs, setLlmElapsedMs] = useState(0);
  const [llmContextChars, setLlmContextChars] = useState(0);
  const [llmTruncated, setLlmTruncated] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const podUid = pod?.uid ? String(pod.uid) : "";
  const podName = pod?.name ?? "";
  const podNamespace = pod ? String(pod.namespace || "_cluster") : "";
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
  } = usePodDrawerResourceLifecycle({ api, clusterId, pod, resource, tab, currentObjectKey });
  const yamlChanged = yamlDraft !== yamlBaseline;
  const now = useUiClock(Boolean(pod), 1000);
  const isDeploymentResource = resource === "deployments" || resource === "deployments.apps" || resource === "deployment";
  const isNodeResource = resource === "nodes" || resource === "node";

  useEffect(() => {
    if (!canLogs && !(resource === "nodes" || resource === "node") && (tab === "logs" || tab === "terminal")) setTab("summary");
  }, [canLogs, tab, resource]);

  useEffect(() => {
    if (resource === "events" && (tab === "events" || tab === "related")) setTab("summary");
  }, [resource, tab]);

  useEffect(() => {
    setPortForwardDraft(null);
    setPendingAction(null);
    setYamlApplyConfirmOpen(false);
    setApplyResult("");
    setYamlStatus("");
    setTerminalPickerOpen(false);
    setLogsFollow(false);
    setLogsQuery("");
    setLogsLoading(false);
    setLogsDownloadLoading(false);
    setLogsContainer("");
    setLogsPodFilter("");
    setDeploymentLogPods([]);
    setDeploymentLogContainers([]);
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

  useEffect(() => {
    if (!pod || tab !== "logs") return;
    const controller = new AbortController();

    setLogsLoading(true);
    setError(null);

    if (isDeploymentResource) {
      api
        .deploymentLogTargets(clusterId, String(pod.namespace), pod.name, controller.signal)
        .then((targets) => {
          if (controller.signal.aborted) return "";
          const podNames = targets.pods.map((item) => item.name).filter(Boolean);
          setDeploymentLogPods(podNames);
          setDeploymentLogContainers(targets.containers || []);
          const selectedPod = logsPodFilter && podNames.includes(logsPodFilter) ? logsPodFilter : "";
          if (logsPodFilter && !podNames.includes(logsPodFilter)) setLogsPodFilter("");
          return api.deploymentLogs(
            clusterId,
            String(pod.namespace),
            pod.name,
            {
              tail: logsTail,
              previous: logsPrevious,
              timestamps: logsTimestamps,
              container: logsContainer || undefined,
              pod: selectedPod || undefined,
            },
            controller.signal,
          );
        })
        .then((text) => {
          if (controller.signal.aborted || typeof text !== "string") return;
          setContent((current) => (current === text ? current : text));
        })
        .catch((err) => {
          if (isAbortError(err)) return;
          setError(toErrorInfo(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLogsLoading(false);
        });
      return () => controller.abort();
    }

    const selectedContainer = logsContainer || containerNames(pod)[0] || "";
    api
      .podLogs(
        clusterId,
        String(pod.namespace),
        pod.name,
        {
          tail: logsTail,
          previous: logsPrevious,
          timestamps: logsTimestamps,
          container: selectedContainer || undefined,
        },
        controller.signal,
      )
      .then((text) => {
        if (controller.signal.aborted) return;
        setContent((current) => (current === text ? current : text));
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(toErrorInfo(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLogsLoading(false);
      });
    return () => controller.abort();
  }, [api, clusterId, podUid, podName, podNamespace, resource, isDeploymentResource, tab, logsTail, logsPrevious, logsTimestamps, logsContainer, logsPodFilter, logsRefreshToken]);

  useEffect(() => {
    if (!pod || tab !== "logs" || !logsFollow) return;
    const timer = window.setInterval(() => {
      setLogsRefreshToken((current) => current + 1);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [podUid, tab, logsFollow]);

  async function downloadFullLogs() {
    if (!pod) return;
    setLogsDownloadLoading(true);
    setError(null);
    try {
      if (isDeploymentResource) {
        const text = await api.deploymentLogs(clusterId, String(pod.namespace), pod.name, {
          all: true,
          previous: logsPrevious,
          timestamps: logsTimestamps,
          container: logsContainer || undefined,
          pod: logsPodFilter || undefined,
        });
        downloadTextFile(`${pod.name}.deployment.full.log`, text);
        return;
      }
      const selectedContainer = logsContainer || containerNames(pod)[0] || "";
      const text = await api.podLogs(clusterId, String(pod.namespace), pod.name, {
        all: true,
        previous: logsPrevious,
        timestamps: logsTimestamps,
        container: selectedContainer || undefined,
      });
      downloadTextFile(`${pod.name}.full.log`, text);
    } catch (err) {
      setError(toErrorInfo(err));
    } finally {
      setLogsDownloadLoading(false);
    }
  }

  async function runYamlDryRun() {
    if (!pod) return;
    setLoading(true);
    setError(null);
    setApplyResult("");
    setYamlStatus("");
    try {
      await api.dryRunYaml(clusterId, yamlDraft);
      setYamlStatus(t("yaml.dryRunPassed"));
    } catch (err) {
      const info = toErrorInfo(err);
      setYamlStatus("");
      setError(info);
    } finally {
      setLoading(false);
    }
  }

  async function applyYaml(typedName: string) {
    if (!pod) return;
    const namespace = String(pod.namespace || "_cluster");
    const submittedYaml = yamlDraft;
    setLoading(true);
    setError(null);
    setApplyResult("");
    setYamlStatus("");
    try {
      await api.applyYaml(clusterId, submittedYaml, namespace, pod.name, typedName);
      setYamlStatus(t("yaml.applied"));
      setYamlBaseline(submittedYaml);
      setYamlDraft(submittedYaml);
      setYamlObjectKey(currentObjectKey);
      onActionComplete();

      try {
        const refreshed = await api.resourceText(clusterId, resource, namespace, pod.name, "yaml");
        setYamlBaseline(refreshed);
        setYamlDraft(refreshed);
        setYamlObjectKey(currentObjectKey);
      } catch {
        // Keep the submitted YAML as the new clean baseline if refresh fails.
      }
    } catch (err) {
      const info = toErrorInfo(err);
      setYamlStatus("");
      setError(info);
    } finally {
      setYamlApplyConfirmOpen(false);
      setLoading(false);
    }
  }

  function resetYamlDraft() {
    setYamlDraft(yamlBaseline);
    setYamlStatus("");
    setApplyResult("");
    setError(null);
  }

  async function reloadYamlFromCluster() {
    if (!pod) return false;
    const namespace = String(pod.namespace || "_cluster");
    setLoading(true);
    setError(null);
    setApplyResult("");
    setYamlStatus("");
    try {
      const text = await api.resourceText(clusterId, resource, namespace, pod.name, "yaml");
      setYamlBaseline(text);
      setYamlDraft(text);
      setYamlObjectKey(currentObjectKey);
      return true;
    } catch (err) {
      const info = toErrorInfo(err);
      setError(info);
      return false;
    } finally {
      setLoading(false);
    }
  }

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

  function copyText(text: string, message = "Copied") {
    void navigator.clipboard?.writeText(text);
    setApplyResult(message);
    window.setTimeout(() => {
      setApplyResult((current) => (current === message ? "" : current));
    }, 2500);
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
  const drawerTabs = availableDrawerTabs(resource, canLogs);
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
      <PodDrawerHeader resource={resource} namespace={namespaceText} name={pod.name} onCopyName={() => copyText(`${resource}/${pod.name}`, "Name copied")} onClose={requestClose} />
      <PodDrawerTabs tabs={drawerTabs} active={tab} nodeResource={isNodeResource} labels={labels} llmLabel={t("llm.title")} onChange={setTab} />
      <div key={currentObjectKey} className={tab === "logs" || tab === "terminal" || tab === "yaml" || tab === "describe" || tab === "llm" ? "drawer-content drawer-content-fill" : "drawer-content"}>
        <PodDrawerActions
          actions={actions}
          resource={resource}
          row={pod}
          loading={loading}
          applyResult={applyResult}
          involvedTarget={involvedTarget}
          onAction={setPendingAction}
          onTerminal={() => openTerminal()}
          canPortForward={supportsPortForward(resource, pod)}
          onPortForward={() => {
            setError(null);
            setApplyResult("");
            setPortForwardDraft(defaultPortForwardDraft(resource, pod));
          }}
          onOpenRelated={onOpenRelated}
        />
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
          <ResourceSummary row={pod} resource={resource} now={now} />
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
          />
        ) : tab === "events" ? (
          <EventsTab
            events={events}
            loading={loading}
            error={error}
            copyLabel={copyLabel}
            typeFilter={eventTypeFilter}
            onTypeFilterChange={setEventTypeFilter}
            sort={eventSort}
            onSortChange={setEventSort}
            onOpenRelated={onOpenRelated}
            now={now}
          />
        ) : tab === "secret" ? (
          <SecretTab api={api} clusterId={clusterId} row={pod} copyLabel={copyLabel} t={t} />
        ) : tab === "terminal" && isNodeResource ? (
          <NodeSshTab api={api} clusterId={clusterId} node={pod} settings={settings} />
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
                onRefresh={() => setLogsRefreshToken((current) => current + 1)}
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
