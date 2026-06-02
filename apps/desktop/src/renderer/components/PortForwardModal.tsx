import { X } from "lucide-react";
import type { ErrorInfo, PortForwardStartRequest, ResourceRow } from "../types";
import { ErrorPanel } from "./ErrorPanel";

interface PortForwardModalProps {
  draft: PortForwardStartRequest;
  row: ResourceRow;
  error: ErrorInfo | null;
  copyLabel: string;
  loading: boolean;
  onDraftChange: (draft: PortForwardStartRequest) => void;
  onCancel: () => void;
  onStart: () => void;
}

export function PortForwardModal({
  draft,
  row,
  error,
  copyLabel,
  loading,
  onDraftChange,
  onCancel,
  onStart,
}: PortForwardModalProps) {
  const portChoices = portChoicesForRow(row, draft.remotePort);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal port-forward-modal" role="dialog" aria-modal="true" aria-labelledby="port-forward-title">
        <header>
          <h2 id="port-forward-title">Port forward</h2>
          <button className="icon-button" onClick={onCancel} title="Close">
            <X size={16} />
          </button>
        </header>
        <div className="confirm-body">
          <p>Expose {draft.resource}/{draft.name} on localhost.</p>
          <ErrorPanel error={error} copyLabel={copyLabel} />
          {portChoices.length ? (
            <div className="port-forward-port-pills" aria-label="Detected ports">
              {portChoices.map((port) => (
                <button
                  key={port}
                  type="button"
                  className={draft.remotePort === port ? "active" : ""}
                  onClick={() => onDraftChange({ ...draft, remotePort: port })}
                >
                  {port}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">No ports were detected for this resource. Enter the remote container port explicitly.</p>
          )}
          <div className="port-forward-grid">
            <label className="confirm-field">
              Remote port
              <input
                type="number"
                min="1"
                max="65535"
                value={draft.remotePort === 0 ? "" : draft.remotePort}
                placeholder="remote port"
                onChange={(event) => onDraftChange({ ...draft, remotePort: event.target.value ? Number(event.target.value) : 0 })}
              />
            </label>
            <label className="confirm-field">
              Local port
              <input
                type="number"
                min="1"
                max="65535"
                value={draft.localPort === 0 ? "" : draft.localPort}
                placeholder="auto"
                disabled={draft.localPort === 0}
                onChange={(event) => onDraftChange({ ...draft, localPort: Number(event.target.value) })}
              />
            </label>
          </div>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={draft.localPort === 0}
              onChange={(event) => onDraftChange({ ...draft, localPort: event.target.checked ? 0 : suggestedLocalPort(draft.remotePort) })}
            />
            Auto-pick free local port
          </label>
          <code>kubectl port-forward -n {draft.namespace} {draft.resource}/{draft.name} {portForwardLocalPreview(draft.localPort)}:{portForwardRemotePreview(draft.remotePort)}</code>
          {draft.localPort === 0 ? <p className="muted">KubeDeck will replace auto with a free high local port after Start.</p> : null}
          <p className="muted">If the requested local port is busy, KubeDeck will fail clearly instead of stealing another process port.</p>
        </div>
        <footer>
          <button onClick={onCancel} disabled={loading}>Cancel</button>
          <button className="primary" onClick={onStart} disabled={loading || !validLocalPort(draft.localPort) || !validPort(draft.remotePort)}>
            {loading ? "Starting..." : "Start"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function supportsPortForward(resource: string, row: ResourceRow) {
  return ["pods", "services", "deployments"].includes(resource) && Boolean(row.namespace);
}

export function defaultPortForwardDraft(resource: string, row: ResourceRow): PortForwardStartRequest {
  const remotePort = portChoicesForRow(row)[0] || 0;
  return {
    namespace: String(row.namespace || "default"),
    resource: resource.slice(0, -1),
    name: row.name,
    localPort: 0,
    remotePort,
  };
}

function portChoicesForRow(row: ResourceRow, selectedPort?: number) {
  const candidates = new Set<number>();
  addPortCandidates(candidates, row.ports);
  addPortCandidates(candidates, row.port);
  addPortCandidates(candidates, row.targetPort);
  addPortCandidates(candidates, row.containerPorts);
  addPortCandidates(candidates, row.servicePorts);
  if (selectedPort && validPort(selectedPort)) candidates.add(selectedPort);
  return Array.from(candidates).filter(validPort).sort((left, right) => left - right).slice(0, 12);
}

function addPortCandidates(target: Set<number>, value: unknown) {
  if (value === null || value === undefined || value === "") return;
  if (typeof value === "number") {
    if (validPort(value)) target.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => addPortCandidates(target, item));
    return;
  }
  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => addPortCandidates(target, item));
    return;
  }
  for (const match of String(value).matchAll(/\b(\d{1,5})\b/g)) {
    const port = Number(match[1]);
    if (validPort(port)) target.add(port);
  }
}

function suggestedLocalPort(_remotePort: number) {
  return randomPortForwardPort();
}

function randomPortForwardPort() {
  return 62000 + Math.floor(Math.random() * (65535 - 62000 + 1));
}

function validPort(port: number) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function validLocalPort(port: number) {
  return port === 0 || validPort(port);
}

function portForwardLocalPreview(port: number) {
  return port === 0 ? "auto" : String(port);
}

function portForwardRemotePreview(port: number) {
  return validPort(port) ? String(port) : "remote-port";
}
