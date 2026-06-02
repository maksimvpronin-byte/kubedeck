import { useEffect, useState } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ErrorInfo, PortForwardSession } from "../types";
import { asErrorInfo } from "../utils/errors";
import { ErrorPanel } from "./ErrorPanel";

export function PortForwardsPanel({
  api,
  cluster,
  copyLabel,
  t,
  onError,
}: {
  api: ApiClient | null;
  cluster: Cluster | null;
  copyLabel: string;
  t: (key: string) => string;
  onError: (error: ErrorInfo | null) => void;
}) {
  const [sessions, setSessions] = useState<PortForwardSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<ErrorInfo | null>(null);
  const [message, setMessage] = useState("");

  async function refresh() {
    if (!api) return;
    setLoading(true);
    try {
      setSessions((await api.portForwards()).items);
      setLocalError(null);
    } catch (err) {
      const info = asErrorInfo(err);
      setLocalError(info);
      onError(info);
    } finally {
      setLoading(false);
    }
  }

  async function stop(id: string) {
    if (!api) return;
    setLoading(true);
    try {
      await api.stopPortForward(id);
      await refresh();
      setMessage("Port-forward stopped");
      onError(null);
    } catch (err) {
      const info = asErrorInfo(err);
      setLocalError(info);
      onError(info);
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
      setMessage(`Port-forward restarted: ${next.url}`);
      await refresh();
      onError(null);
    } catch (err) {
      const info = asErrorInfo(err);
      setLocalError(info);
      onError(info);
    } finally {
      setLoading(false);
    }
  }

  function copyUrl(session: PortForwardSession) {
    void navigator.clipboard?.writeText(session.url);
    setMessage(`Copied ${session.url}`);
    window.setTimeout(() => {
      setMessage((current) => current === `Copied ${session.url}` ? "" : current);
    }, 2500);
  }

  useEffect(() => {
    refresh();
  }, [api, cluster?.id]);

  useEffect(() => {
    if (!api || !cluster) return;
    const interval = window.setInterval(() => {
      refresh();
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
          <p className="muted">{sessions.length} active session{sessions.length === 1 ? "" : "s"}</p>
        </div>
        <button className="icon-text" onClick={refresh} disabled={loading}>{loading ? t("common.refreshing") : t("common.refresh")}</button>
      </header>
      <ErrorPanel error={localError} copyLabel={copyLabel} />
      {message ? <p className="muted port-forward-message">{message}</p> : null}
      <div className="port-forward-list">
        {sessions.length === 0 ? <p className="muted">{t("portForwards.empty")}</p> : null}
        {sessions.map((session) => (
          <article className="port-forward-card" key={session.id}>
            <div>
              <strong>{session.resource}/{session.name} <small>{session.source === "external" ? "External" : "KubeDeck"}</small></strong>
              <span>{session.namespace} · localhost:{session.localPort} → {session.resource}/{session.name}:{session.remotePort} · {session.status} · pid {session.pid}</span>
              <a href={session.url} target="_blank" rel="noreferrer">{session.url}</a>
              {session.commandPreview ? <code>{session.commandPreview}</code> : null}
            </div>
            <div className="port-forward-actions">
              <button onClick={() => copyUrl(session)} disabled={loading}>Copy URL</button>
              {session.stoppable ? (
                <>
                  <button onClick={() => restart(session)} disabled={loading}>Restart</button>
                  <button onClick={() => stop(session.id)} disabled={loading}>{t("portForwards.stop")}</button>
                </>
              ) : (
                <button disabled title={t("portForwards.externalReadOnly")}>External</button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
