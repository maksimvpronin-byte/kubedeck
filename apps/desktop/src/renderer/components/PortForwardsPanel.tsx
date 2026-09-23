import { useEffect, useState } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ErrorInfo, PortForwardSession } from "../types";
import { asErrorInfo } from "../utils/errors";
import { ErrorPanel } from "./ErrorPanel";
import { useAsyncActionFeedback } from "../hooks/useAsyncActionFeedback";
import { AsyncActionButton, refreshActionLabels } from "./AsyncActionButton";

export function PortForwardsPanel({ api, cluster, copyLabel, t }: { api: ApiClient | null; cluster: Cluster | null; copyLabel: string; t: (key: string) => string }) {
  const [sessions, setSessions] = useState<PortForwardSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<ErrorInfo | null>(null);
  const [message, setMessage] = useState("");
  const refreshFeedback = useAsyncActionFeedback();

  async function refresh(options: { quiet?: boolean } = {}) {
    if (!api) return false;
    if (!options.quiet) setLoading(true);
    try {
      setSessions((await api.portForwards()).items);
      setLocalError(null);
      return true;
    } catch (err) {
      const info = asErrorInfo(err);
      setLocalError(info);
      return false;
    } finally {
      if (!options.quiet) setLoading(false);
    }
  }

  async function stop(id: string) {
    if (!api) return;
    setLoading(true);
    try {
      await api.stopPortForward(id);
      await refresh({ quiet: true });
      setMessage(t("portForwards.stopped"));
    } catch (err) {
      const info = asErrorInfo(err);
      setLocalError(info);
    } finally {
      setLoading(false);
    }
  }

  async function restart(session: PortForwardSession) {
    if (!api || !session.stoppable) return;
    setLoading(true);
    try {
      await api.stopPortForward(session.id);
      const next = await api.startPortForward(session.clusterId, {
        namespace: session.namespace,
        resource: session.resource,
        name: session.name,
        localPort: session.localPort,
        remotePort: session.remotePort,
      });
      setMessage(`${t("portForwards.restarted")}: ${next.url}`);
      await refresh({ quiet: true });
    } catch (err) {
      const info = asErrorInfo(err);
      setLocalError(info);
    } finally {
      setLoading(false);
    }
  }

  // "Copied" only once the clipboard has taken it.
  async function copyUrl(session: PortForwardSession) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(session.url);
      copied = true;
    } catch {
      copied = false;
    }
    const text = `${t(copied ? "portForwards.copied" : "portForwards.copyFailed")}: ${session.url}`;
    setMessage(text);
    window.setTimeout(() => {
      setMessage((current) => (current === text ? "" : current));
    }, 2500);
  }

  useEffect(() => {
    void refresh({ quiet: true });
  }, [api, cluster?.id]);

  useEffect(() => {
    if (!api || !cluster) return;
    const interval = window.setInterval(() => {
      void refresh({ quiet: true });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [api, cluster?.id]);

  if (!cluster) {
    return (
      <section className="placeholder-page">
        <h2>{t("portForwards.title")}</h2>
        <p>{t("portForwards.openCluster")}</p>
      </section>
    );
  }

  return (
    <section className="port-forward-panel">
      <header>
        <div>
          <h2>{t("portForwards.title")}</h2>
          <p className="muted">
            {t("portForwards.activeSessions")}: {sessions.length}
          </p>
        </div>
        <AsyncActionButton className="icon-text" phase={refreshFeedback.phase} labels={refreshActionLabels(t)} onClick={() => void refreshFeedback.run(() => refresh())} disabled={loading} />
      </header>
      <ErrorPanel error={localError} copyLabel={copyLabel} t={t} />
      {message ? <p className="muted port-forward-message">{message}</p> : null}
      <div className="port-forward-list">
        {sessions.length === 0 ? <p className="muted">{t("portForwards.empty")}</p> : null}
        {sessions.map((session) => (
          <article className="port-forward-card" key={session.id}>
            <div>
              <strong>
                {session.resource}/{session.name} <small>{session.source === "external" ? t("portForwards.external") : "KubeDeck"}</small>
              </strong>
              <span>
                {session.namespace} · localhost:{session.localPort} → {session.resource}/{session.name}:{session.remotePort} · {session.status} · pid {session.pid}
              </span>
              <a href={session.url} target="_blank" rel="noreferrer">
                {session.url}
              </a>
              {session.commandPreview ? <code>{session.commandPreview}</code> : null}
            </div>
            <div className="port-forward-actions">
              <button onClick={() => void copyUrl(session)} disabled={loading}>
                {t("portForwards.copyUrl")}
              </button>
              {session.stoppable ? (
                <>
                  <button onClick={() => void restart(session)} disabled={loading}>
                    {t("portForwards.restart")}
                  </button>
                  <button onClick={() => void stop(session.id)} disabled={loading}>
                    {t("portForwards.stop")}
                  </button>
                </>
              ) : (
                <button disabled title={t("portForwards.externalReadOnly")}>
                  {t("portForwards.external")}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
