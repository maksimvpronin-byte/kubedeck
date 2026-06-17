import type { ReactNode } from "react";
import type { ResourceRow } from "../types";
import { formatAge } from "../utils/time";

interface ResourceSummaryProps {
  row: ResourceRow;
  resource: string;
  now: number;
}

type RestartDiagnostic = {
  container: string;
  restartCount: number;
  ready?: boolean;
  currentState?: string;
  currentReason?: string;
  currentMessage?: string;
  lastReason?: string;
  lastExitCode?: number | string | null;
  lastSignal?: number | string | null;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastMessage?: string;
};

type SummaryItem = {
  label: string;
  value: ReactNode;
  tone?: "default" | "warning" | "danger" | "success";
};

const HIDDEN_RAW_FIELDS = new Set([
  "kind",
  "namespace",
  "phase",
  "status",
  "createdAt",
  "age",
  "ready",
  "node",
  "restarts",
  "ports",
  "restartDiagnostics",
  "lastRestartReason",
  "lastRestartExitCode",
  "lastRestartFinishedAt",
]);

export function ResourceSummary({ row, resource, now }: ResourceSummaryProps) {
  const restartCount = numberValue(row.restarts) ?? 0;
  const isPod = isPodResource(resource);
  const diagnostics = isPod ? restartDiagnosticsFor(row) : [];
  const overview = overviewItems(row, resource, now);
  const details = Object.entries(row).filter(([key, value]) => shouldShowRawField(key, value));

  return (
    <div className="resource-summary-layout">
      <section className="resource-summary-card-grid" aria-label="Resource overview">
        {overview.map((item) => (
          <SummaryTile key={`${item.label}:${String(item.value)}`} label={item.label} tone={item.tone}>
            {item.value}
          </SummaryTile>
        ))}
      </section>

      {isPod && (diagnostics.length > 0 || restartCount > 0) ? (
        <RestartDiagnostics diagnostics={diagnostics} reportedRestartCount={restartCount} now={now} />
      ) : null}

      {details.length > 0 ? (
        <section className="resource-summary-section" aria-label="Resource fields">
          <div className="resource-summary-section-title">Details</div>
          <div className="resource-summary-details-grid">
            {details.map(([key, value]) => (
              <SummaryTile key={key} label={key} compact>
                {formatSummaryValue(value)}
              </SummaryTile>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RestartDiagnostics({ diagnostics, reportedRestartCount, now }: { diagnostics: RestartDiagnostic[]; reportedRestartCount: number; now: number }) {
  const total = diagnostics.reduce((sum, item) => sum + (numberValue(item.restartCount) ?? 0), 0) || reportedRestartCount;

  return (
    <section className="pod-restart-card" aria-label="Pod restart diagnostics">
      <div className="pod-restart-header">
        <div>
          <span className="pod-restart-eyebrow">Pod</span>
          <strong>Restart diagnostics</strong>
        </div>
        <span className={total > 0 ? "pod-restart-count is-warning" : "pod-restart-count"}>{total} restart{total === 1 ? "" : "s"}</span>
      </div>

      {diagnostics.length === 0 ? (
        <p className="pod-restart-empty">
          Kubernetes reports restarts, but no last terminated container state is available. Check Events or Previous logs.
        </p>
      ) : (
        <div className="pod-restart-list">
          {diagnostics.map((item) => {
            const exitCode = valueText(item.lastExitCode);
            const signal = valueText(item.lastSignal);
            const lastReason = valueText(item.lastReason);
            const currentReason = valueText(item.currentReason);
            const message = valueText(item.lastMessage || item.currentMessage);
            const headline = lastReason || (exitCode ? `Exit code ${exitCode}` : currentReason || "Unknown");
            const problem = isProblemRestart(item);

            return (
              <article key={`${item.container}:${item.restartCount}:${headline}`} className={problem ? "pod-restart-item is-warning" : "pod-restart-item"}>
                <div className="pod-restart-title">
                  <strong>{item.container || "container"}</strong>
                  <span>{headline}</span>
                </div>
                <div className="pod-restart-fields">
                  <DiagnosticField label="Restarts" value={String(item.restartCount ?? 0)} />
                  <DiagnosticField label="Current state" value={valueText(item.currentState) || "unknown"} />
                  <DiagnosticField label="Last reason" value={lastReason || "not reported"} />
                  <DiagnosticField label="Exit code" value={exitCode || "not reported"} />
                  {signal ? <DiagnosticField label="Signal" value={signal} /> : null}
                  {item.lastFinishedAt ? <DiagnosticField label="Finished" value={`${formatAge(item.lastFinishedAt, now)} ago`} /> : null}
                  {item.lastStartedAt && item.lastFinishedAt ? <DiagnosticField label="Duration" value={durationText(item.lastStartedAt, item.lastFinishedAt)} /> : null}
                </div>
                {message ? <p className="pod-restart-message">{message}</p> : null}
              </article>
            );
          })}
        </div>
      )}

      <p className="pod-restart-hint">For the exact stack trace, open the Logs tab and enable Previous logs for the same container.</p>
    </section>
  );
}

function DiagnosticField({ label, value }: { label: string; value: string }) {
  return (
    <div className="pod-restart-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryTile({ label, children, tone = "default", compact = false }: { label: string; children: ReactNode; tone?: SummaryItem["tone"]; compact?: boolean }) {
  const classes = ["resource-summary-tile", compact ? "is-compact" : "", tone && tone !== "default" ? `is-${tone}` : ""].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <span className="resource-summary-label">{label}</span>
      <strong className="resource-summary-value">{children}</strong>
    </div>
  );
}

function overviewItems(row: ResourceRow, resource: string, now: number): SummaryItem[] {
  const items: SummaryItem[] = [
    { label: "Kind", value: String(row.kind || singularResource(resource)) },
    { label: "Namespace", value: String(row.namespace || "_cluster") },
    { label: "Status", value: primaryStatus(row), tone: statusTone(row) },
    { label: "Age", value: formatAge(row.createdAt, now) },
  ];

  const candidates: Array<[string, unknown, SummaryItem["tone"]?]> = [
    ["Ready", row.ready, readyTone(row.ready)],
    ["Node", row.node],
    ["Restarts", row.restarts, (numberValue(row.restarts) ?? 0) > 0 ? "warning" : undefined],
    ["Last restart", row.lastRestartReason, restartTone(row.lastRestartReason, row.lastRestartExitCode)],
    ["Exit code", row.lastRestartExitCode, restartTone(row.lastRestartReason, row.lastRestartExitCode)],
    ["Ports", row.ports],
    ["Type", row.type],
    ["API Version", row.apiVersion],
    ["Group", row.group],
    ["Scope", row.scope],
    ["Versions", row.versions],
    ["Plural", row.plural],
    ["Cluster IP", row.clusterIp],
    ["Replicas", row.replicas ?? row.available ?? row.readyReplicas],
    ["Storage", row.capacity ?? row.storage],
    ["Class", row.storageClassName ?? row.storageClass],
  ];

  for (const [label, value, tone] of candidates) {
    if (value === undefined || value === null || String(value) === "") continue;
    items.push({ label, value: String(value), tone });
  }

  return items.slice(0, isPodResource(resource) ? 10 : 7);
}

function restartDiagnosticsFor(row: ResourceRow): RestartDiagnostic[] {
  const fromBackend = toRestartDiagnostics(row.restartDiagnostics);
  if (fromBackend.length > 0) return fromBackend;
  return toRestartDiagnostics(row.containerStatuses);
}

function toRestartDiagnostics(value: unknown): RestartDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      const state = asRecord(record.state);
      const waiting = asRecord(state.waiting);
      const running = asRecord(state.running);
      const terminated = asRecord(state.terminated);
      const lastState = asRecord(record.lastState);
      const lastTerminated = asRecord(lastState.terminated);
      const currentState = valueText(record.currentState) || (Object.keys(waiting).length ? "waiting" : Object.keys(terminated).length ? "terminated" : Object.keys(running).length ? "running" : "");

      return {
        container: valueText(record.container ?? record.name),
        restartCount: numberValue(record.restartCount) ?? 0,
        ready: Boolean(record.ready),
        currentState,
        currentReason: valueText(record.currentReason ?? waiting.reason ?? terminated.reason),
        currentMessage: valueText(record.currentMessage ?? waiting.message ?? terminated.message),
        lastReason: valueText(record.lastReason ?? lastTerminated.reason),
        lastExitCode: restartDiagnosticScalar(record.lastExitCode ?? lastTerminated.exitCode),
        lastSignal: restartDiagnosticScalar(record.lastSignal ?? lastTerminated.signal),
        lastStartedAt: valueText(record.lastStartedAt ?? lastTerminated.startedAt),
        lastFinishedAt: valueText(record.lastFinishedAt ?? lastTerminated.finishedAt),
        lastMessage: valueText(record.lastMessage ?? lastTerminated.message),
      };
    })
    .filter((item) => item.restartCount > 0 || Boolean(item.lastReason || item.currentReason || item.lastExitCode || item.lastSignal));
}

function shouldShowRawField(key: string, value: unknown) {
  if (HIDDEN_RAW_FIELDS.has(key)) return false;
  if (value === undefined || value === null || value === "") return false;
  return true;
}

function primaryStatus(row: ResourceRow) {
  return String(row.phase || row.status || row.type || row.reason || "unknown");
}

function statusTone(row: ResourceRow): SummaryItem["tone"] {
  const status = primaryStatus(row).toLowerCase();
  if (["running", "ready", "active", "bound", "succeeded"].some((token) => status.includes(token))) return "success";
  if (["error", "failed", "crash", "unknown", "unavailable"].some((token) => status.includes(token))) return "danger";
  if (["pending", "terminating", "waiting"].some((token) => status.includes(token))) return "warning";
  return "default";
}

function readyTone(value: unknown): SummaryItem["tone"] {
  const ready = valueText(value).toLowerCase();
  if (!ready) return undefined;
  if (ready.includes("0/") || ready === "false") return "warning";
  return "success";
}

function restartTone(reason: unknown, exitCodeValue: unknown): SummaryItem["tone"] {
  const reasonText = valueText(reason).toLowerCase();
  const exitCode = numberValue(exitCodeValue);
  if (reasonText.includes("oom") || reasonText.includes("error") || reasonText.includes("crash") || reasonText.includes("cannot")) return "danger";
  if (exitCode !== undefined && exitCode !== 0) return "warning";
  return undefined;
}

function singularResource(resource: string) {
  const normalized = resource.split(".")[0];
  if (normalized.endsWith("ies")) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith("ses")) return normalized.slice(0, -2);
  if (normalized.endsWith("s")) return normalized.slice(0, -1);
  return normalized;
}

function isPodResource(resource: string) {
  const normalized = resource.toLowerCase();
  return normalized === "pod" || normalized === "pods";
}

function isProblemRestart(item: RestartDiagnostic) {
  const reason = valueText(item.lastReason || item.currentReason).toLowerCase();
  const exitCode = numberValue(item.lastExitCode);
  if (reason === "completed" && (!exitCode || exitCode === 0)) return false;
  if (reason.includes("oom") || reason.includes("error") || reason.includes("crash") || reason.includes("cannot")) return true;
  return exitCode !== undefined && exitCode !== 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function restartDiagnosticScalar(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value;
  return String(value);
}

function valueText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function durationText(startedAt: string, finishedAt: string) {
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return "unknown";
  const seconds = Math.round((finished - started) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function formatSummaryValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.every((item) => ["string", "number", "boolean"].includes(typeof item))) {
      return value.map((item) => String(item)).join(", ");
    }
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}