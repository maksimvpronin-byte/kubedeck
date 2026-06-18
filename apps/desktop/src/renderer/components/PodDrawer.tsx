import { Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiClient, ApiError } from "../api";
import type { ErrorInfo, PortForwardSession, PortForwardStartRequest, RelatedLink, ResourceRow, Settings } from "../types";
import { ErrorPanel } from "./ErrorPanel";
import { TerminalTab } from "./TerminalTab";
import { NodeSshTab } from "./NodeSshTab";
import { LogsTab } from "./LogsTab";
import { YamlTab } from "./YamlTab";
import { DescribeTab } from "./DescribeTab";
import { EventsTab } from "./EventsTab";
import { RelatedTab } from "./RelatedTab";
import { SecretTab } from "./SecretTab";
import { LlmTab } from "./LlmTab";
import { PortForwardModal, defaultPortForwardDraft, supportsPortForward } from "./PortForwardModal";
import { ResourceActionConfirmModal, TerminalContainerPickerModal, UnsavedYamlConfirmModal, YamlApplyConfirmModal, actionLabel, supportedActions, type ResourceAction } from "./PodDrawerModals";
import { useUiClock } from "../hooks/useUiClock";
import { ResourceSummary } from "./ResourceSummary";
import { containerNames, displayResource, downloadTextFile, eventTargetForOpen, formatOperationError, isAbortError } from "./podDrawerHelpers";

type DrawerTab = "summary" | "llm" | "yaml" | "describe" | "logs" | "events" | "related" | "terminal" | "secret";
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

export function PodDrawer({ api, clusterId, pod, resource, canLogs, width, onResize, onActionComplete, onOpenRelated, onPortForwardStarted, onClose, copyLabel, labels, settings, t }: Props) {
  const [tab, setTab] = useState<DrawerTab>("summary");
  const [content, setContent] = useState("");
  const [describeContent, setDescribeContent] = useState("");
  const [logsContent, setLogsContent] = useState("");
  const [yamlBaseline, setYamlBaseline] = useState("");
  const [yamlDraft, setYamlDraft] = useState("");
  const [yamlObjectKey, setYamlObjectKey] = useState("");
  const [applyResult, setApplyResult] = useState("");
  const [yamlOperationTitle, setYamlOperationTitle] = useState("");
  const [yamlOperationOutput, setYamlOperationOutput] = useState("");
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<ResourceAction | null>(null);
  const [yamlApplyConfirmOpen, setYamlApplyConfirmOpen] = useState(false);
  const [portForwardDraft, setPortForwardDraft] = useState<PortForwardStartRequest | null>(null);
  const [replicas, setReplicas] = useState(1);
  const [events, setEvents] = useState<ResourceRow[]>([]);
  const [eventTypeFilter, setEventTypeFilter] = useState<"all" | "warning" | "normal">("all");
  const [eventSort, setEventSort] = useState<"newest" | "oldest">("newest");
  const [relatedResourceFilter, setRelatedResourceFilter] = useState("all");
  const [relatedLinks, setRelatedLinks] = useState<RelatedLink[]>([]);
  const [relatedSources, setRelatedSources] = useState<Record<string, number>>({});
  const [relatedErrors, setRelatedErrors] = useState<Array<ErrorInfo & { resource?: string; namespace?: string }>>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsDownloadLoading, setLogsDownloadLoading] = useState(false);
  const [terminalContainer, setTerminalContainer] = useState("");
  const [terminalPickerOpen, setTerminalPickerOpen] = useState(false);
  const [terminalConnectToken, setTerminalConnectToken] = useState(0);
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
  const currentObjectKey = pod ? `${clusterId}:${resource}:${podNamespace}:${podName}:${podUid}` : "";
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
    setYamlOperationTitle("");
    setYamlOperationOutput("");
    setTerminalContainer("");
    setTerminalPickerOpen(false);
    setLogsFollow(false);
    setLogsQuery("");
    setLogsLoading(false);
    setLogsDownloadLoading(false);
    setLogsContainer("");
    setLogsPodFilter("");
    setDeploymentLogPods([]);
    setDeploymentLogContainers([]);
    setDescribeContent("");
    setLogsContent("");
    setYamlBaseline("");
    setYamlDraft("");
    setYamlObjectKey("");
    setCloseConfirmOpen(false);
    setRelatedLinks([]);
    setRelatedResourceFilter("all");
    setRelatedSources({});
    setRelatedErrors([]);
    setEvents([]);
    setLlmLoading(false);
    setLlmError(null);
    setLlmAnswer("");
    setLlmModel("");
    setLlmElapsedMs(0);
    setLlmContextChars(0);
    setLlmTruncated(false);
    setTab((current) => current === "terminal" ? "summary" : current);
  }, [pod?.uid, resource]);

  useEffect(() => {
    if (!pod || tab === "summary" || tab === "llm" || tab === "events" || tab === "related" || tab === "terminal" || tab === "logs" || tab === "secret") {
      if (tab !== "yaml") setError(null);
      return;
    }

    if (tab === "yaml" && yamlObjectKey === currentObjectKey && yamlChanged) {
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setApplyResult("");
    setYamlOperationTitle("");
    setYamlOperationOutput("");
    const namespace = String(pod.namespace || "_cluster");
    api.resourceText(clusterId, resource, namespace, pod.name, tab, controller.signal)
      .then((text) => {
        if (controller.signal.aborted) return;
        if (tab === "yaml") {
          setYamlBaseline(text);
          setYamlDraft(text);
          setYamlObjectKey(currentObjectKey);
        } else {
          setContent(text);
          if (tab === "describe") setDescribeContent(text);
        }
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, clusterId, podUid, podName, podNamespace, resource, tab, currentObjectKey, yamlObjectKey, yamlChanged]);

  useEffect(() => {
    if (!pod || tab !== "logs") return;
    const controller = new AbortController();

    setLogsLoading(true);
    setError(null);

    if (isDeploymentResource) {
      api.deploymentLogTargets(clusterId, String(pod.namespace), pod.name, controller.signal)
        .then((targets) => {
          if (controller.signal.aborted) return "";
          const podNames = targets.pods.map((item) => item.name).filter(Boolean);
          setDeploymentLogPods(podNames);
          setDeploymentLogContainers(targets.containers || []);
          const selectedPod = logsPodFilter && podNames.includes(logsPodFilter) ? logsPodFilter : "";
          if (logsPodFilter && !podNames.includes(logsPodFilter)) setLogsPodFilter("");
          return api.deploymentLogs(clusterId, String(pod.namespace), pod.name, {
            tail: logsTail,
            previous: logsPrevious,
            timestamps: logsTimestamps,
            container: logsContainer || undefined,
            pod: selectedPod || undefined,
          }, controller.signal);
        })
        .then((text) => {
          if (controller.signal.aborted || typeof text !== "string") return;
          setContent((current) => current === text ? current : text);
          setLogsContent((current) => current === text ? current : text);
        })
        .catch((err) => {
          if (isAbortError(err)) return;
          setError(err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" });
        })
        .finally(() => {
          if (!controller.signal.aborted) setLogsLoading(false);
        });
      return () => controller.abort();
    }

    const selectedContainer = logsContainer || containerNames(pod)[0] || "";
    api.podLogs(clusterId, String(pod.namespace), pod.name, {
      tail: logsTail,
      previous: logsPrevious,
      timestamps: logsTimestamps,
      container: selectedContainer || undefined,
    }, controller.signal)
      .then((text) => {
        if (controller.signal.aborted) return;
        setContent((current) => current === text ? current : text);
        setLogsContent((current) => current === text ? current : text);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" });
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

  useEffect(() => {
    if (!pod || tab !== "events") return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const namespace = String(pod.namespace || "_cluster");
    api.resourceEvents(clusterId, resource, namespace, pod.name, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setEvents(response.items);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, clusterId, podUid, podName, podNamespace, resource, tab]);

  useEffect(() => {
    if (!pod || tab !== "related") return;
    const controller = new AbortController();
    setRelatedLoading(true);
    setError(null);
    setRelatedSources({});
    setRelatedErrors([]);
    const namespace = String(pod.namespace || "_cluster");
    api.relatedResources(clusterId, resource, namespace, pod.name, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setRelatedLinks(response.items);
        setRelatedSources(response.sources || {});
        setRelatedErrors(response.errors || []);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" });
      })
      .finally(() => {
        if (!controller.signal.aborted) setRelatedLoading(false);
      });
    return () => controller.abort();
  }, [api, clusterId, podUid, podName, podNamespace, resource, tab]);

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
      setError(err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" });
    } finally {
      setLogsDownloadLoading(false);
    }
  }

  async function runYamlDryRun() {
    if (!pod) return;
    setLoading(true);
    setError(null);
    setApplyResult("");
    setYamlOperationTitle("Server dry-run");
    setYamlOperationOutput("");
    try {
      const result = await api.dryRunYaml(clusterId, yamlDraft);
      setYamlOperationOutput(result || "Server dry-run completed successfully.");
    } catch (err) {
      const info = err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" };
      setYamlOperationTitle("Dry-run failed");
      setYamlOperationOutput(formatOperationError(info));
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
    setYamlOperationTitle("Apply result");
    setYamlOperationOutput("");
    try {
      const result = await api.applyYaml(clusterId, submittedYaml, namespace, pod.name, typedName);
      setApplyResult("YAML applied");
      setYamlOperationOutput(result || "YAML applied successfully.");
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
      const info = err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" };
      setYamlOperationTitle("Apply failed");
      setYamlOperationOutput(formatOperationError(info));
      setError(info);
    } finally {
      setYamlApplyConfirmOpen(false);
      setLoading(false);
    }
  }

  function resetYamlDraft() {
    setYamlDraft(yamlBaseline);
    setYamlOperationTitle("");
    setYamlOperationOutput("");
    setApplyResult("");
    setError(null);
  }

  async function reloadYamlFromCluster() {
    if (!pod) return;
    const namespace = String(pod.namespace || "_cluster");
    setLoading(true);
    setError(null);
    setApplyResult("");
    setYamlOperationTitle("Reload YAML");
    setYamlOperationOutput("");
    try {
      const text = await api.resourceText(clusterId, resource, namespace, pod.name, "yaml");
      setYamlBaseline(text);
      setYamlDraft(text);
      setYamlObjectKey(currentObjectKey);
      setYamlOperationOutput("YAML reloaded from the cluster.");
    } catch (err) {
      const info = err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" };
      setYamlOperationTitle("Reload failed");
      setYamlOperationOutput(formatOperationError(info));
      setError(info);
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
      setError(err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" });
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
        setApplyResult((current) => current.startsWith("Port forward started:") ? "" : current);
      }, 5000);
      setPortForwardDraft(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" });
    } finally {
      setLoading(false);
    }
  }

  function closePortForwardDraft() {
    setPortForwardDraft(null);
    setApplyResult((current) => current.startsWith("Port forward started:") ? "" : current);
  }

  function copyText(text: string, message = "Copied") {
    void navigator.clipboard?.writeText(text);
    setApplyResult(message);
    window.setTimeout(() => {
      setApplyResult((current) => current === message ? "" : current);
    }, 2500);
  }

  function openTerminal(containerName?: string) {
    if (!pod) return;
    const containers = containerNames(pod);
    if (!containerName && containers.length > 1) {
      setTerminalPickerOpen(true);
      return;
    }
    setTerminalContainer(containerName ?? containers[0] ?? "");
    setTerminalPickerOpen(false);
    setTab("terminal");
    setTerminalConnectToken((current) => current + 1);
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
    setYamlOperationTitle("");
    setYamlOperationOutput("");
    setApplyResult("");
    setError(null);
    onClose();
  }

  if (!pod) return null;

  const isCrdDefinitionResource = resource === "customresourcedefinitions" || resource === "customresourcedefinitions.apiextensions.k8s.io";
  const isCrdInstanceResource = !isCrdDefinitionResource && (Boolean(pod.crdInstance) || resource.includes("."));
  const actions = isCrdDefinitionResource
    ? []
    : isCrdInstanceResource
      ? ["delete" as ResourceAction]
      : supportedActions(resource);
  const namespaceText = String(pod.namespace || "_cluster");
  const involvedTarget = resource === "events" ? eventTargetForOpen(pod) : null;
  const isSecretResource = resource === "secrets" || resource === "secret";
  const yamlReadOnly = isCrdDefinitionResource;
  const drawerTabs = [
    "summary",
    "llm",
    ...(resource === "events" ? [] : ["related"]),
    ...(isSecretResource ? ["secret"] : []),
    "yaml",
    "describe",
    ...(resource === "events" ? [] : ["events"]),
    ...(canLogs && !isNodeResource ? ["logs"] : []),
    ...(isNodeResource ? ["terminal"] : []),
  ] as DrawerTab[];
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
      <header>
        <div>
          <span>{displayResource(resource)} · {namespaceText}</span>
          <div className="drawer-title-row">
            <h2>{pod.name}</h2>
            <button
              type="button"
              className="icon-button drawer-copy-name-button"
              onClick={() => copyText(`${resource}/${pod.name}`, "Name copied")}
              title="Copy resource name"
              aria-label="Copy resource name"
            >
              <Copy size={15} />
            </button>
          </div>
        </div>
        <button className="icon-button" onClick={requestClose} title="Close">
          <X size={18} />
        </button>
      </header>
      <nav className="drawer-tabs">
        {drawerTabs.map((item) => (
          <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>
            {item === "events" ? "Events" : item === "related" ? "Related" : item === "terminal" ? (isNodeResource ? "SSH" : "Terminal") : item === "secret" ? "Secret" : item === "llm" ? t("llm.title") : labels[item]}
          </button>
        ))}
      </nav>
      <div className={tab === "logs" || tab === "terminal" || tab === "yaml" || tab === "describe" || tab === "llm" ? "drawer-content drawer-content-fill" : "drawer-content"}>
        <div className="drawer-actions">
          {actions.map((action) => (
            <button key={action} className={action === "delete" ? "danger" : "icon-text"} disabled={loading} onClick={() => setPendingAction(action)}>
              {actionLabel(action, resource)}
            </button>
          ))}
          {resource === "pods" ? (
            <button className="icon-text" disabled={loading} onClick={() => openTerminal()}>
              Terminal
            </button>
          ) : null}
          {supportsPortForward(resource, pod) ? (
            <button
              className="icon-text"
              disabled={loading}
              onClick={() => {
                setError(null);
                setApplyResult("");
                setPortForwardDraft(defaultPortForwardDraft(resource, pod));
              }}
            >
              Port forward
            </button>
          ) : null}
          {involvedTarget ? (
            <button className="icon-text" onClick={() => onOpenRelated(involvedTarget.resource, involvedTarget.namespace, involvedTarget.name)}>
              Open involved object
            </button>
          ) : null}
          {applyResult ? <span>{applyResult}</span> : null}
        </div>
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
            logs={logsContent}
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
          <SecretTab
            api={api}
            clusterId={clusterId}
            row={pod}
            copyLabel={copyLabel}
          />
        ) : tab === "terminal" ? (
          isNodeResource ? (
            <NodeSshTab api={api} clusterId={clusterId} node={pod} settings={settings} />
          ) : (
            <TerminalTab
              api={api}
              clusterId={clusterId}
              pod={pod}
              containers={containerNames(pod)}
              container={terminalContainer}
              setContainer={setTerminalContainer}
              autoConnectToken={terminalConnectToken}
            />
          )
        ) : (
          <>
            {loading ? <div className="muted">Loading...</div> : null}
            <ErrorPanel error={error} copyLabel={copyLabel} />
            {tab === "yaml" ? (
              <YamlTab
                yamlDraft={yamlDraft}
                setYamlDraft={setYamlDraft}
                yamlChanged={yamlChanged}
                loading={loading}
                applyResult={applyResult}
                operationTitle={yamlOperationTitle}
                operationOutput={yamlOperationOutput}
                editorRef={editorRef}
                onReset={resetYamlDraft}
                onReloadFromCluster={() => void reloadYamlFromCluster()}
                onDryRun={() => void runYamlDryRun()}
                onRequestApply={() => { if (!yamlReadOnly) setYamlApplyConfirmOpen(true); }}
                onCopyOutput={() => copyText(yamlOperationOutput, "Output copied")}
                readOnly={yamlReadOnly}
                readOnlyReason={yamlReadOnly ? "view-only CRD definition" : ""}
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
                selectedContainer={isDeploymentResource ? logsContainer : (logsContainer || containerNames(pod)[0] || "")}
                onContainerChange={setLogsContainer}
                allowAllContainers={isDeploymentResource}
                targetPods={isDeploymentResource ? deploymentLogPods : []}
                selectedTargetPod={logsPodFilter}
                onTargetPodChange={setLogsPodFilter}
                contextLabel={isDeploymentResource ? "deployment" : "pod"}
                fullDownloadLabel={isDeploymentResource ? "Full deployment log" : "Full pod log"}
                onRefresh={() => setLogsRefreshToken((current) => current + 1)}
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
        <YamlApplyConfirmModal
          resource={resource}
          row={pod}
          loading={loading}
          onCancel={() => setYamlApplyConfirmOpen(false)}
          onApply={() => void applyYaml(pod.name)}
        />
      ) : null}
      {closeConfirmOpen ? (
        <UnsavedYamlConfirmModal
          resource={resource}
          row={pod}
          onDiscard={discardYamlAndClose}
          onContinueEditing={keepEditingYaml}
        />
      ) : null}
      {terminalPickerOpen && pod ? (
        <TerminalContainerPickerModal
          row={pod}
          containers={containerNames(pod)}
          onCancel={() => setTerminalPickerOpen(false)}
          onOpenContainer={openTerminal}
        />
      ) : null}
    </aside>
  );
}
