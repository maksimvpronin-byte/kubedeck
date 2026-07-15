import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ResourceCacheStatus } from "../types";
import { asErrorInfo } from "../utils/errors";
import { useAsyncActionFeedback } from "../hooks/useAsyncActionFeedback";
import { AsyncActionButton, refreshActionLabels } from "./AsyncActionButton";

export function ResourceCacheDiagnostics({
  api,
  activeCluster,
  t,
  onError,
}: {
  api: ApiClient | null;
  activeCluster: Cluster | null;
  t: (key: string) => string;
  onError: (error: { code: string; message: string; rawStderr: string; commandPreview: string } | null) => void;
}) {
  const [status, setStatus] = useState<ResourceCacheStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [localMessage, setLocalMessage] = useState("");
  const refreshFeedback = useAsyncActionFeedback();

  const clusterEntries = useMemo(() => {
    if (!status || !activeCluster) return [];
    return status.items.filter((item) => item.clusterId === activeCluster.id);
  }, [status, activeCluster?.id]);

  const visibleEntries = activeCluster ? clusterEntries : (status?.items ?? []);

  async function loadStatus() {
    if (!api) return false;
    setLoading(true);
    setLocalMessage("");
    try {
      const next = await api.resourceCacheStatus();
      setStatus(next);
      onError(null);
      return true;
    } catch (err) {
      onError(asErrorInfo(err));
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function clearCache(clusterOnly = false) {
    if (!api) return;
    setClearing(true);
    setLocalMessage("");
    try {
      const result = await api.clearResourceCache(clusterOnly ? activeCluster?.id : undefined);
      const next = await api.resourceCacheStatus();
      setStatus(next);
      setLocalMessage(`${t("cache.cleared")}: ${result.cleared}`);
      onError(null);
    } catch (err) {
      onError(asErrorInfo(err));
    } finally {
      setClearing(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, [api]);

  return (
    <section className="cache-diagnostics-panel" aria-label={t("cache.title")}>
      <header>
        <div>
          <h3>{t("cache.title")}</h3>
          <p>{t("cache.description")}</p>
        </div>
        <div className="cache-diagnostics-actions">
          <AsyncActionButton phase={refreshFeedback.phase} labels={refreshActionLabels(t)} onClick={() => void refreshFeedback.run(loadStatus)} disabled={!api || loading || clearing} />
          <button onClick={() => void clearCache(false)} disabled={!api || loading || clearing}>
            {clearing ? t("cache.clearing") : t("cache.clearAll")}
          </button>
          <button onClick={() => void clearCache(true)} disabled={!api || !activeCluster || loading || clearing}>
            {t("cache.clearCluster")}
          </button>
        </div>
      </header>

      <div className="cache-diagnostics-grid">
        <CacheMetric label={t("cache.mode")} value={status?.mode ?? "..."} />
        <CacheMetric label={t("cache.enabled")} value={status ? (status.enabled ? t("common.yes") : t("common.no")) : "..."} />
        <CacheMetric label={t("cache.entries")} value={String(status?.entries ?? 0)} />
        <CacheMetric label={t("cache.visibleEntries")} value={String(visibleEntries.length)} />
      </div>

      {status?.note ? <p className="cache-note">{status.note}</p> : null}
      {localMessage ? <p className="cache-message">{localMessage}</p> : null}

      {visibleEntries.length ? (
        <div className="cache-entry-list" aria-label={t("cache.entriesList")}>
          {visibleEntries.map((entry) => (
            <article className="cache-entry" key={`${entry.clusterId}:${entry.namespace}:${entry.resource}`}>
              <strong>{entry.resource}</strong>
              <span>{entry.namespace || "_cluster"}</span>
              <span>
                {entry.items ?? entry.rawCount ?? 0} {t("cache.items")}
              </span>
              <span>
                {t("cache.age")}: {entry.ageSeconds.toFixed(1)}s
              </span>
              <span>
                {t("cache.hits")}: {entry.hits}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <p className="cache-empty">{t("cache.empty")}</p>
      )}
    </section>
  );
}

function CacheMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="cache-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
