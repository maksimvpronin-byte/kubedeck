import { useState } from "react";
import { ApiClient, ApiError } from "../api";
import type { ErrorInfo, LlmAnalyzeResourceRequest, RelatedLink, ResourceRow, Settings } from "../types";
import { ErrorPanel } from "./ErrorPanel";

interface Props {
  api: ApiClient;
  clusterId: string;
  resource: string;
  row: ResourceRow;
  settings?: Settings;
  yaml: string;
  describe: string;
  logs: string;
  events: ResourceRow[];
  relatedLinks: RelatedLink[];
  loading: boolean;
  answer: string;
  model: string;
  elapsedMs: number;
  contextChars: number;
  truncated: boolean;
  error: ErrorInfo | null;
  copyLabel: string;
  t: (key: string) => string;
  onLoadingChange: (value: boolean) => void;
  onAnswer: (value: { answer: string; model: string; elapsedMs: number; contextChars: number; truncated: boolean }) => void;
  onError: (error: ErrorInfo | null) => void;
  onCopy: (text: string, message: string) => void;
}

export function LlmTab({
  api,
  clusterId,
  resource,
  row,
  settings,
  yaml,
  describe,
  logs,
  events,
  relatedLinks,
  loading,
  answer,
  model,
  elapsedMs,
  contextChars,
  truncated,
  error,
  copyLabel,
  t,
  onLoadingChange,
  onAnswer,
  onError,
  onCopy,
}: Props) {
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [promptPreviewLoading, setPromptPreviewLoading] = useState(false);
  const [promptPreview, setPromptPreview] = useState("");

  const llm = settings?.llm;
  const configured = Boolean(llm?.enabled && llm.baseUrl && llm.model);
  const busy = loading || promptPreviewLoading;

  async function buildFreshRequest(): Promise<LlmAnalyzeResourceRequest> {
    const namespace = typeof row.namespace === "string" && row.namespace ? row.namespace : "_cluster";
    const name = row.name;
    const [freshYaml, freshDescribe, freshEvents, freshRelated, freshLogs, freshPreviousLogs] = await Promise.all([
      safeText(api.resourceText(clusterId, resource, namespace, name, "yaml"), yaml),
      safeText(api.resourceText(clusterId, resource, namespace, name, "describe"), describe),
      safeItems(api.resourceEvents(clusterId, resource, namespace, name), events),
      safeRelated(api.relatedResources(clusterId, resource, namespace, name), relatedLinks),
      fetchResourceLogs(namespace, name, false, logs),
      fetchResourceLogs(namespace, name, true, ""),
    ]);

    return {
      clusterId,
      resource,
      kind: typeof row.kind === "string" ? row.kind : resource,
      namespace,
      name,
      resourceObject: { ...row },
      yaml: freshYaml,
      events: freshEvents,
      describe: freshDescribe,
      logs: freshLogs,
      previousLogs: freshPreviousLogs,
      relatedResources: freshRelated,
      language: settings?.language,
    };
  }

  async function safeText(promise: Promise<string>, fallback = "") {
    try {
      return await promise;
    } catch {
      return fallback;
    }
  }

  async function safeItems<T>(promise: Promise<{ items: T[] }>, fallback: T[]) {
    try {
      const response = await promise;
      return response.items || fallback;
    } catch {
      return fallback;
    }
  }

  async function safeRelated(promise: Promise<{ items: RelatedLink[] }>, fallback: RelatedLink[]) {
    try {
      const response = await promise;
      return response.items || fallback;
    } catch {
      return fallback;
    }
  }

  async function fetchResourceLogs(namespace: string, name: string, previous: boolean, fallback: string) {
    if (isDeploymentResource(resource)) {
      return safeText(api.deploymentLogs(clusterId, namespace, name, { tail: 300, previous, timestamps: true }), fallback);
    }
    if (isPodResource(resource)) {
      return safeText(api.podLogs(clusterId, namespace, name, { tail: 300, previous, timestamps: true }), fallback);
    }
    return fallback;
  }

  async function analyze() {
    onLoadingChange(true);
    onError(null);
    try {
      const request = await buildFreshRequest();
      const result = await api.analyzeResourceWithLlm(request);
      onAnswer(result);
    } catch (err) {
      onError(err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" });
    } finally {
      onLoadingChange(false);
    }
  }

  async function togglePromptPreview() {
    if (promptPreviewOpen) {
      setPromptPreviewOpen(false);
      return;
    }
    setPromptPreviewLoading(true);
    onError(null);
    try {
      const request = await buildFreshRequest();
      const result = await api.previewLlmResourcePrompt(request);
      const text = result.messages.map((message) => `ROLE: ${message.role}\n${message.content}`).join("\n\n---\n\n");
      setPromptPreview(text);
      setPromptPreviewOpen(true);
    } catch (err) {
      onError(err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" });
    } finally {
      setPromptPreviewLoading(false);
    }
  }

  if (!configured) {
    return (
      <section className="llm-tab empty-state">
        <strong>{t("llm.notConfigured")}</strong>
        <p>{t("llm.configureInSettings")}</p>
      </section>
    );
  }

  return (
    <section className="llm-tab">
      <header className="llm-tab-header">
        <div>
          <h3>{t("llm.diagnostics")}</h3>
          <p>{llm?.model}</p>
        </div>
        <div className="llm-tab-actions">
          <button className="primary" onClick={() => void analyze()} disabled={busy}>
            {loading ? t("llm.analyzing") : answer ? t("llm.rerun") : t("llm.analyze")}
          </button>
          <button onClick={() => void togglePromptPreview()} disabled={busy}>
            {promptPreviewLoading ? t("llm.collectingContext") : promptPreviewOpen ? t("llm.hidePrompt") : t("llm.showPrompt")}
          </button>
          {answer ? (
            <button onClick={() => onCopy(answer, t("llm.answerCopied"))}>{t("llm.copyAnswer")}</button>
          ) : null}
          {promptPreviewOpen ? (
            <button onClick={() => onCopy(promptPreview, t("llm.promptCopied"))}>{t("llm.copyPrompt")}</button>
          ) : null}
        </div>
      </header>
      <ErrorPanel error={error} copyLabel={copyLabel} title={t("llm.analysisFailed")} />

      {promptPreviewOpen ? (
        <section className="llm-prompt-preview">
          <div className="llm-meta">
            <span>{t("llm.promptPreview")}</span>
          </div>
          <pre className="llm-answer">{promptPreview}</pre>
        </section>
      ) : null}

      {answer ? (
        <>
          <div className="llm-meta">
            <span>{t("llm.model")}: {model}</span>
            <span>{t("llm.elapsed")}: {elapsedMs} ms</span>
            <span>{t("llm.contextSize")}: {contextChars}</span>
            <span>{t("llm.truncated")}: {truncated ? t("llm.yes") : t("llm.no")}</span>
          </div>
          <pre className="llm-answer">{answer || t("llm.noResponse")}</pre>
        </>
      ) : loading ? (
        <div className="muted">{t("llm.analyzing")}</div>
      ) : (
        <div className="muted">{t("llm.noResponse")}</div>
      )}
    </section>
  );
}

function isPodResource(resource: string) {
  return resource === "pods" || resource === "pod";
}

function isDeploymentResource(resource: string) {
  return resource === "deployments" || resource === "deployments.apps" || resource === "deployment";
}