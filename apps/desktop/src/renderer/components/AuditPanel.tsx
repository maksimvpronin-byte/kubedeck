import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api";
import type { AuditEvent, ErrorInfo } from "../types";
import { asErrorInfo, isAbortError } from "../utils/errors";
import { useAsyncActionFeedback } from "../hooks/useAsyncActionFeedback";
import { AsyncActionButton, refreshActionLabels } from "./AsyncActionButton";

const STATUS_FILTERS = ["all", "success", "failed", "opened", "closed"] as const;
type AuditStatusFilter = (typeof STATUS_FILTERS)[number];

function formatDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function matchesAuditQuery(event: AuditEvent, query: string) {
  const text = [
    event.timestamp,
    event.action,
    event.status,
    event.clusterId,
    event.namespace,
    event.resource,
    event.name,
    event.commandPreview,
    event.message,
    event.extra ? JSON.stringify(event.extra) : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes(query.toLowerCase());
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/jsonl;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AuditPanel({ api, copyLabel, t, onError }: { api: ApiClient | null; copyLabel: string; t: (key: string) => string; onError: (error: ErrorInfo) => void }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(300);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AuditStatusFilter>("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [copyMessage, setCopyMessage] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const refreshFeedback = useAsyncActionFeedback();

  const loadAudit = useCallback(
    async (silent = false, requestedLimit = limit) => {
      if (!api) return false;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      if (!silent) setLoading(true);
      try {
        const response = await api.audit(requestedLimit, controller.signal);
        setEvents(response.items);
        return true;
      } catch (err) {
        if (isAbortError(err)) return false;
        onError(asErrorInfo(err));
        return false;
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
        if (!silent) setLoading(false);
      }
    },
    [api, limit, onError],
  );

  useEffect(() => {
    void loadAudit();
    const timer = window.setInterval(() => void loadAudit(true), 15000);
    return () => {
      requestRef.current?.abort();
      window.clearInterval(timer);
    };
  }, [loadAudit]);

  const actionOptions = useMemo(() => {
    return Array.from(new Set(events.map((event) => event.action).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [events]);

  const filteredEvents = useMemo(() => {
    const trimmedQuery = query.trim();
    return events.filter((event) => {
      if (statusFilter !== "all" && event.status !== statusFilter) return false;
      if (actionFilter !== "all" && event.action !== actionFilter) return false;
      if (trimmedQuery && !matchesAuditQuery(event, trimmedQuery)) return false;
      return true;
    });
  }, [actionFilter, events, query, statusFilter]);

  const summary = useMemo(() => {
    const failed = events.filter((event) => event.status === "failed").length;
    const success = events.filter((event) => ["success", "opened", "closed"].includes(event.status)).length;
    return { total: events.length, visible: filteredEvents.length, failed, success };
  }, [events, filteredEvents.length]);

  function showCopyMessage(message: string) {
    setCopyMessage(message);
    window.setTimeout(() => {
      setCopyMessage((current) => (current === message ? "" : current));
    }, 2500);
  }

  async function copyAudit(event: AuditEvent) {
    await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
    showCopyMessage(t("audit.eventCopied"));
  }

  async function copyVisible() {
    await navigator.clipboard.writeText(JSON.stringify(filteredEvents, null, 2));
    showCopyMessage(t("audit.visibleCopied"));
  }

  function downloadVisible() {
    const payload = filteredEvents.map((event) => JSON.stringify(event)).join("\n");
    downloadText(`kubedeck-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`, payload ? `${payload}\n` : "");
  }

  function updateLimit(value: number) {
    setLimit(value);
    void loadAudit(false, value);
  }

  return (
    <section className="audit-panel">
      <header>
        <div>
          <h2>{t("audit.title")}</h2>
          <p>{t("audit.description")}</p>
        </div>
        <div className="audit-header-actions">
          <select value={limit} onChange={(event) => updateLimit(Number(event.target.value))} aria-label={t("audit.limitLabel")}>
            {[100, 300, 500, 1000].map((value) => (
              <option key={value} value={value}>
                {t("audit.last")} {value}
              </option>
            ))}
          </select>
          <AsyncActionButton phase={refreshFeedback.phase} labels={refreshActionLabels(t)} onClick={() => void refreshFeedback.run(() => loadAudit())} disabled={loading} />
        </div>
      </header>

      <div className="audit-summary-grid">
        <div>
          <span>{t("audit.total")}</span>
          <strong>{summary.total}</strong>
        </div>
        <div>
          <span>{t("audit.visible")}</span>
          <strong>{summary.visible}</strong>
        </div>
        <div>
          <span>{t("audit.success")}</span>
          <strong>{summary.success}</strong>
        </div>
        <div>
          <span>{t("audit.failed")}</span>
          <strong>{summary.failed}</strong>
        </div>
      </div>

      <div className="audit-filters">
        <label>
          {t("audit.search")}
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("audit.searchPlaceholder")} />
        </label>
        <label>
          {t("audit.status")}
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AuditStatusFilter)}>
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("common.action")}
          <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
            <option value="all">{t("common.all")}</option>
            {actionOptions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
        </label>
        <div className="audit-filter-actions">
          <button onClick={copyVisible} disabled={!filteredEvents.length}>
            {t("audit.copyVisible")}
          </button>
          <button onClick={downloadVisible} disabled={!filteredEvents.length}>
            {t("audit.download")}
          </button>
          {copyMessage ? <span>{copyMessage}</span> : null}
        </div>
      </div>

      {filteredEvents.length ? (
        <div className="audit-list">
          {filteredEvents.map((event, index) => (
            <article className={`audit-event ${event.status || "unknown"}`} key={`${event.timestamp}-${event.action}-${index}`}>
              <div className="audit-event-main">
                <span className="audit-time">{formatDateTime(event.timestamp)}</span>
                <strong>{event.action}</strong>
                <em>{event.status}</em>
              </div>
              <div className="audit-event-target">{[event.clusterId, event.namespace, event.resource, event.name].filter(Boolean).join(" / ") || t("common.application")}</div>
              {event.commandPreview ? <code>{event.commandPreview}</code> : null}
              {event.message ? <p>{event.message}</p> : null}
              {event.extra && Object.keys(event.extra).length ? <small>{JSON.stringify(event.extra)}</small> : null}
              <div className="row-actions">
                <button onClick={() => copyAudit(event)}>{copyLabel}</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">{events.length ? t("audit.noMatches") : t("audit.empty")}</div>
      )}
    </section>
  );
}
