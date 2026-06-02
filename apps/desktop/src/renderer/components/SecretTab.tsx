import { Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiClient, ApiError } from "../api";
import type { ErrorInfo, ResourceRow, SecretKeysResponse, SecretRevealResponse } from "../types";
import { ErrorPanel } from "./ErrorPanel";

interface Props {
  api: ApiClient;
  clusterId: string;
  row: ResourceRow;
  copyLabel: string;
}

type RevealedValue = SecretRevealResponse & {
  visibleUntil: number;
};

export function SecretTab({ api, clusterId, row, copyLabel }: Props) {
  const namespace = String(row.namespace || "");
  const name = row.name;
  const [response, setResponse] = useState<SecretKeysResponse | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealingKey, setRevealingKey] = useState("");
  const [revealed, setRevealed] = useState<Record<string, RevealedValue>>({});
  const [copiedKey, setCopiedKey] = useState("");
  const hideTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    const controller = new AbortController();
    void loadSecret(controller.signal);
    return () => {
      controller.abort();
      Object.values(hideTimers.current).forEach((timer) => window.clearTimeout(timer));
      hideTimers.current = {};
    };
  }, [api, clusterId, namespace, name]);

  async function loadSecret(signal?: AbortSignal) {
    if (!namespace) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.secretKeys(clusterId, namespace, name, signal);
      setResponse(data);
      setRevealed({});
      Object.values(hideTimers.current).forEach((timer) => window.clearTimeout(timer));
      hideTimers.current = {};
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  async function revealKey(key: string) {
    setRevealingKey(key);
    setError(null);
    try {
      const data = await api.revealSecret(clusterId, namespace, name, key);
      const timeoutSeconds = data.revealTimeoutSeconds || response?.revealTimeoutSeconds || 30;
      const visibleUntil = Date.now() + timeoutSeconds * 1000;
      setRevealed((current) => ({ ...current, [key]: { ...data, visibleUntil } }));
      if (hideTimers.current[key]) window.clearTimeout(hideTimers.current[key]);
      hideTimers.current[key] = window.setTimeout(() => hideKey(key), timeoutSeconds * 1000);
    } catch (err) {
      setError(err instanceof ApiError ? err.info : { code: "ERROR", message: String(err), rawStderr: "", commandPreview: "" });
    } finally {
      setRevealingKey("");
    }
  }

  function hideKey(key: string) {
    if (hideTimers.current[key]) {
      window.clearTimeout(hideTimers.current[key]);
      delete hideTimers.current[key];
    }
    setRevealed((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function copyValue(key: string) {
    const item = revealed[key];
    if (!item) return;
    await navigator.clipboard?.writeText(item.value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => current === key ? "" : current), 1500);
    try {
      await api.auditSecretCopy(clusterId, namespace, name, key);
    } catch {
      // Copy must not fail just because audit logging failed.
    }
  }

  const keys = response?.keys ?? [];
  const timeoutSeconds = response?.revealTimeoutSeconds ?? 30;

  return (
    <div className="drawer-panel-stack secret-tab">
      <section className="secret-warning">
        <strong>Secret values are sensitive.</strong>
        <span>Values are hidden by default, auto-hidden after {timeoutSeconds}s, and reveal/copy actions are written to the local audit log without storing values.</span>
      </section>

      <div className="drawer-filterbar">
        <div className="secret-meta">
          <span>Type: <strong>{response?.type || "—"}</strong></span>
          <span>Keys: <strong>{keys.length}</strong></span>
          {response?.immutable ? <span>Immutable</span> : null}
        </div>
        <button className="icon-text" disabled={loading} onClick={() => void loadSecret()}>
          <RefreshCw size={14} />
          Refresh keys
        </button>
      </div>

      {loading ? <div className="muted">Loading secret keys...</div> : null}
      <ErrorPanel error={error} copyLabel={copyLabel} />

      {!loading && !error && keys.length === 0 ? (
        <div className="empty-state">
          <strong>No secret keys</strong>
          <p>This Secret does not contain keys in the data section.</p>
        </div>
      ) : null}

      <div className="secret-key-list">
        {keys.map((item) => {
          const visible = revealed[item.key];
          return (
            <article className="secret-key-card" key={item.key}>
              <header>
                <div>
                  <strong>{item.key}</strong>
                  <span>{item.validBase64 ? `${formatBytes(item.decodedBytes)} decoded` : "invalid base64"}{item.binary ? " · binary-like" : ""}</span>
                </div>
                <div className="secret-key-actions">
                  {visible ? (
                    <button className="icon-text" onClick={() => hideKey(item.key)}>
                      <EyeOff size={14} />
                      Hide
                    </button>
                  ) : (
                    <button className="icon-text" disabled={!item.validBase64 || revealingKey === item.key} onClick={() => void revealKey(item.key)}>
                      <Eye size={14} />
                      {revealingKey === item.key ? "Revealing..." : "Reveal"}
                    </button>
                  )}
                  <button className="icon-text" disabled={!visible} onClick={() => void copyValue(item.key)}>
                    <Copy size={14} />
                    {copiedKey === item.key ? "Copied" : "Copy"}
                  </button>
                </div>
              </header>
              {visible ? (
                <div className="secret-value-panel">
                  <div className="secret-value-meta">
                    <span>Auto-hide at {new Date(visible.visibleUntil).toLocaleTimeString()}</span>
                    {visible.binary ? <span>Binary-like data is shown as UTF-8 with replacement characters.</span> : null}
                  </div>
                  <pre>{visible.value}</pre>
                </div>
              ) : (
                <div className="secret-value-placeholder">Hidden</div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
