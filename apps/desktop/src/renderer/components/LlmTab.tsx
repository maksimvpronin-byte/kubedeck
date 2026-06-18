import { ApiClient, ApiError } from "../api";
import type { ErrorInfo, RelatedLink, ResourceRow, Settings } from "../types";
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
  const llm = settings?.llm;
  const configured = Boolean(llm?.enabled && llm.baseUrl && llm.model);

  async function analyze() {
    onLoadingChange(true);
    onError(null);
    try {
      const result = await api.analyzeResourceWithLlm({
        clusterId,
        resource,
        kind: typeof row.kind === "string" ? row.kind : resource,
        namespace: typeof row.namespace === "string" ? row.namespace : "_cluster",
        name: row.name,
        resourceObject: { ...row },
        yaml,
        events,
        describe,
        logs,
        relatedResources: relatedLinks,
        language: settings?.language,
      });
      onAnswer(result);
    } catch (err) {
      onError(err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" });
    } finally {
      onLoadingChange(false);
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
          <button className="primary" onClick={() => void analyze()} disabled={loading}>
            {loading ? t("llm.analyzing") : answer ? t("llm.rerun") : t("llm.analyze")}
          </button>
          {answer ? (
            <button onClick={() => onCopy(answer, t("llm.answerCopied"))}>{t("llm.copyAnswer")}</button>
          ) : null}
        </div>
      </header>
      <ErrorPanel error={error} copyLabel={copyLabel} title={t("llm.analysisFailed")} />
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
