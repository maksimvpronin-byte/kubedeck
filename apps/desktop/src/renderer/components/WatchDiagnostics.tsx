import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ErrorInfo, WatchSession, WatchStatus } from "../types";
import { asErrorInfo } from "../utils/errors";
import { formatElapsed } from "../utils/time";

const WATCH_STATUS_REFRESH_MS = 5000;
const DEFAULT_WATCH_RESOURCE = "pods";

export function WatchDiagnostics({
  api,
  activeCluster,
  selectedNamespaces,
  resourceTab,
  t,
  onError,
}: {
  api: ApiClient | null;
  activeCluster: Cluster | null;
  selectedNamespaces: string[];
  resourceTab: string;
  t: (key: string) => string;
  onError: (error: ErrorInfo | null) => void;
}) {
  const [status, setStatus] = useState<WatchStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [resourceDraft, setResourceDraft] = useState(resourceTab || DEFAULT_WATCH_RESOURCE);
  const [namespaceDraft, setNamespaceDraft] = useState("all");
  const [message, setMessage] = useState("");

  const watches = status?.watches ?? [];
  const visibleWatches = useMemo(() => {
    if (!activeCluster) return watches;
    return watches.filter((watch) => watch.clusterId === activeCluster.id);
  }, [watches, activeCluster?.id]);
  const runningVisible = visibleWatches.filter((watch) => watch.status === "running").length;
  const currentNamespaceHint = selectedNamespaces.length === 1 ? selectedNamespaces[0] : "all";

  async function loadStatus(options: { quiet?: boolean } = {}) {
    if (!api) return;
    if (!options.quiet) setLoading(true);
    try {
      const next = await api.watchStatus();
      setStatus(next);
      onError(null);
    } catch (err) {
      onError(asErrorInfo(err));
    } finally {
      if (!options.quiet) setLoading(false);
    }
  }

  async function startWatch() {
    if (!api || !activeCluster) return;
    const resource = resourceDraft.trim().toLowerCase();
    const namespace = normalizeWatchNamespace(namespaceDraft);
    if (!resource) return;
    setStarting(true);
    setMessage("");
    try {
      const result = await api.startWatch(activeCluster.id, resource, namespace);
      setMessage(result.alreadyRunning ? t("watch.alreadyRunning") : t("watch.started"));
      await loadStatus({ quiet: true });
      onError(null);
    } catch (err) {
      onError(asErrorInfo(err));
    } finally {
      setStarting(false);
    }
  }

  async function stopWatch(watch: WatchSession) {
    if (!api) return;
    setStoppingId(watch.id);
    setMessage("");
    try {
      await api.stopWatch(watch.id);
      setMessage(t("watch.stopped"));
      await loadStatus({ quiet: true });
      onError(null);
    } catch (err) {
      onError(asErrorInfo(err));
    } finally {
      setStoppingId(null);
    }
  }

  async function stopAllWatches() {
    if (!api) return;
    setStoppingAll(true);
    setMessage("");
    try {
      const result = await api.stopAllWatches();
      setMessage(`${t("watch.stopped")}: ${result.stopped}`);
      await loadStatus({ quiet: true });
      onError(null);
    } catch (err) {
      onError(asErrorInfo(err));
    } finally {
      setStoppingAll(false);
    }
  }

  useEffect(() => {
    if (!resourceTab || resourceTab === "port-forwards") return;
    setResourceDraft(resourceTab);
  }, [resourceTab]);

  useEffect(() => {
    setNamespaceDraft(currentNamespaceHint);
  }, [currentNamespaceHint]);

  useEffect(() => {
    void loadStatus({ quiet: true });
    if (!api) return undefined;
    const timer = window.setInterval(() => void loadStatus({ quiet: true }), WATCH_STATUS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [api]);

  return (
    <section className="watch-diagnostics-panel" aria-label={t("watch.title")}>
      <header>
        <div>
          <h3>{t("watch.title")}</h3>
          <p>{t("watch.description")}</p>
        </div>
        <div className="watch-diagnostics-actions">
          <button onClick={() => void loadStatus()} disabled={!api || loading || starting || stoppingAll}>
            {loading ? t("common.refreshing") : t("common.refresh")}
          </button>
          <button onClick={() => void stopAllWatches()} disabled={!api || !visibleWatches.length || stoppingAll || starting}>
            {stoppingAll ? t("watch.stopping") : t("watch.stopAll")}
          </button>
        </div>
      </header>

      <div className="watch-diagnostics-grid">
        <WatchMetric label={t("watch.mode")} value={status?.mode ?? "..."} />
        <WatchMetric label={t("watch.total")} value={String(status?.total ?? 0)} />
        <WatchMetric label={t("watch.running")} value={String(status?.running ?? 0)} />
        <WatchMetric label={t("watch.visibleRunning")} value={String(runningVisible)} />
      </div>

      <div className="watch-start-form">
        <label>
          {t("watch.resource")}
          <input value={resourceDraft} onChange={(event) => setResourceDraft(event.target.value)} placeholder="pods" disabled={!activeCluster || starting} />
        </label>
        <label>
          {t("watch.namespace")}
          <input value={namespaceDraft} onChange={(event) => setNamespaceDraft(event.target.value)} placeholder="all" disabled={!activeCluster || starting} />
        </label>
        <button className="primary" onClick={() => void startWatch()} disabled={!api || !activeCluster || starting || !resourceDraft.trim()}>
          {starting ? t("watch.starting") : t("watch.start")}
        </button>
      </div>

      <p className="watch-hint">{t("watch.namespaceHint")}</p>
      {status?.note ? <p className="watch-note">{status.note}</p> : null}
      {message ? <p className="watch-message">{message}</p> : null}

      {visibleWatches.length ? (
        <div className="watch-entry-list" aria-label={t("watch.entriesList")}>
          {visibleWatches.map((watch) => (
            <WatchEntry
              key={watch.id}
              watch={watch}
              t={t}
              stopping={stoppingId === watch.id}
              onStop={() => void stopWatch(watch)}
            />
          ))}
        </div>
      ) : (
        <p className="watch-empty">{activeCluster ? t("watch.empty") : t("watch.openCluster")}</p>
      )}
    </section>
  );
}

function WatchMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="watch-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WatchEntry({
  watch,
  t,
  stopping,
  onStop,
}: {
  watch: WatchSession;
  t: (key: string) => string;
  stopping: boolean;
  onStop: () => void;
}) {
  const errorTail = watch.errorTail.join("\n");
  const outputTail = watch.outputTail.slice(-3).join("\n");
  const age = formatElapsed(watch.ageSeconds * 1000);
  return (
    <article className={`watch-entry watch-entry-${watch.status}`}>
      <div className="watch-entry-main">
        <strong>{watch.resource}</strong>
        <span>{watch.namespace || "_cluster"}</span>
        <span className="watch-status-pill">{watch.status}</span>
        <span>pid: {watch.pid ?? "-"}</span>
        <span>{t("watch.age")}: {age}</span>
        <span>stdout: {watch.stdoutLines}</span>
        <span>stderr: {watch.stderrLines}</span>
        <span>{t("watch.cacheEvents")}: {watch.cacheEvents ?? 0}</span>
        <span>{t("watch.cacheInvalidations")}: {watch.cacheInvalidations ?? 0}</span>
      </div>
      <div className="watch-entry-command" title={watch.commandPreview}>{watch.commandPreview}</div>
      {errorTail ? <pre className="watch-tail watch-tail-error">{errorTail}</pre> : null}
      {!errorTail && outputTail ? <pre className="watch-tail">{outputTail}</pre> : null}
      <div className="watch-entry-actions">
        <button onClick={onStop} disabled={stopping || watch.status !== "running"}>
          {stopping ? t("watch.stopping") : t("watch.stop")}
        </button>
      </div>
    </article>
  );
}

function normalizeWatchNamespace(value: string): string {
  const text = value.trim();
  if (!text) return "all";
  return text;
}
