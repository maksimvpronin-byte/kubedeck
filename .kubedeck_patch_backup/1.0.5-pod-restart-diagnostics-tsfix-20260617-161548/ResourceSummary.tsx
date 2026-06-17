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

const HIDDEN_RAW_FIELDS = new Set([
  "restartDiagnostics",
  "lastRestartReason",
  "lastRestartExitCode",
  "lastRestartFinishedAt",
]);

export function ResourceSummary({ row, resource, now }: ResourceSummaryProps) {
  const restartDiagnostics = isPodResource(resource) ? restartDiagnosticsFor(row) : [];
  const restartCount = numberValue(row.restarts) ?? 0;

  return (
    <>
      <ResourceOverview row={row} resource={resource} now={now} />
      {isPodResource(resource) && (restartDiagnostics.length > 0 || restartCount > 0) ? (
        <RestartDiagnostics diagnostics={restartDiagnostics} reportedRestartCount={restartCount} now={now} />
      ) : null}
      {Object.entries(row)
        .filter(([key]) => !HIDDEN_RAW_FIELDS.has(key))
        .map(([key, value]) => (
          <SummaryCard key={key} label={key}>
            {formatSummaryValue(value)}
          </SummaryCard>
        ))}
    </>
  );
}

function ResourceOverview({ row, resource, now }: ResourceSummaryProps) {
  const facts = keyFacts(row, resource);
  return (
    <>
      <SummaryCard label="Kind">{String(row.kind || singularResource(resource))}</SummaryCard>
      <SummaryCard label="Namespace">{String(row.namespace || "_cluster")}</SummaryCard>
      <SummaryCard label="Status">{primaryStatus(row)}</SummaryCard>
      <SummaryCard label="Age">{formatAge(row.createdAt, now)}</SummaryCard>
      {facts.map((fact) => (
        <SummaryCard key={`${fact.label}:${fact.value}`} label={fact.label}>
          {fact.value}
        </SummaryCard>
      ))}
    </>
  );
}

function RestartDiagnostics({ diagnostics, reportedRestartCount, now }: { diagnostics: RestartDiagnostic[]; reportedRestartCount: number; now: number }) {
  const total = diagnostics.reduce((sum, item) => sum + (numberValue(item.restartCount) ?? 0), 0) || reportedRestartCount;

  return (
    <section className="summary-card restart-diagnostics-card">
      <div className="restart-diagnostics-header">
        <div>
          <span className="restart-diagnostics-eyebrow">Pod</span>
          <strong>Restart diagnostics</strong>
        </div>
        <span className={total > 0 ? "restart-count-badge is-warning" : "restart-count-badge"}>{total} restart{total === 1 ? "" : "s"}</span>
      </div>

      {diagnostics.length === 0 ? (
        <p className="restart-diagnostics-empty">
          Kubernetes reports restarts, but no last terminated container state is available. Check the Events tab or Previous logs.
        </p>
      ) : (
        <div className="restart-diagnostics-list">
          {diagnostics.map((item) => {
            const exitCode = valueText(item.lastExitCode);
            const signal = valueText(item.lastSignal);
            const lastReason = valueText(item.lastReason);
            const currentReason = valueText(item.currentReason);
            const message = valueText(item.lastMessage || item.currentMessage);
            const headline = lastReason || (exitCode ? `Exit code ${exitCode}` : currentReason || "No last terminated state");
            const problem = isProblemRestart(item);

            return (
              <article key={`${item.container}:${item.restartCount}:${headline}`} className={problem ? "restart-diagnostic is-warning" : "restart-diagnostic"}>
                <div className="restart-diagnostic-title">
                  <strong>{item.container || "container"}</strong>
                  <span>{headline}</span>
                </div>
                <div className="restart-diagnostic-grid">
                  <DiagnosticField label="Restarts" value={String(item.restartCount ?? 0)} />
                  <DiagnosticField label="Current state" value={valueText(item.currentState) || "unknown"} />
                  <DiagnosticField label="Last reason" value={lastReason || "not reported"} />
                  <DiagnosticField label="Exit code" value={exitCode || "not reported"} />
                  {signal ? <DiagnosticField label="Signal" value={signal} /> : null}
                  {item.lastFinishedAt ? <DiagnosticField label="Finished" value={`${formatAge(item.lastFinishedAt, now)} ago`} /> : null}
                  {item.lastStartedAt && item.lastFinishedAt ? <DiagnosticField label="Duration" value={durationText(item.lastStartedAt, item.lastFinishedAt)} /> : null}
                </div>
                {message ? <p className="restart-diagnostic-message">{message}</p> : null}
              </article>
            );
          })}
        </div>
      )}

      <p className="restart-diagnostics-hint">For the exact stack trace, open the Logs tab and enable Previous logs for the same container.</p>
    </section>
  );
}

function DiagnosticField({ label, value }: { label: string; value: string }) {
  return (
    <div className="restart-diagnostic-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryCard({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`summary-card ${className}`.trim()}>
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function keyFacts(row: ResourceRow, resource: string) {
  const candidates: Array<[string, unknown]> = [
    ["Ready", row.ready],
    ["Node", row.node],
    ["Restarts", row.restarts],
    ["Last restart", row.lastRestartReason],
    ["Exit code", row.lastRestartExitCode],
    ["Type", row.type],
    ["API Version", row.apiVersion],
    ["Group", row.group],
    ["Scope", row.scope],
    ["Versions", row.versions],
    ["Plural", row.plural],
    ["Cluster IP", row.clusterIp],
    ["Ports", row.ports],
    ["Replicas", row.replicas ?? row.available ?? row.readyReplicas],
    ["Storage", row.capacity ?? row.storage],
    ["Class", row.storageClassName ?? row.storageClass],
  ];
  return candidates
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    .slice(0, resource === "pods" ? 6 : 3)
    .map(([label, value]) => ({ label, value: String(value) }));
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
        lastExitCode: record.lastExitCode ?? lastTerminated.exitCode ?? null,
        lastSignal: record.lastSignal ?? lastTerminated.signal ?? null,
        lastStartedAt: valueText(record.lastStartedAt ?? lastTerminated.startedAt),
        lastFinishedAt: valueText(record.lastFinishedAt ?? lastTerminated.finishedAt),
        lastMessage: valueText(record.lastMessage ?? lastTerminated.message),
      };
    })
    .filter((item) => item.restartCount > 0 || Boolean(item.lastReason || item.currentReason || item.lastExitCode || item.lastSignal));
}

function primaryStatus(row: ResourceRow) {
  return String(row.phase || row.status || row.type || row.reason || "unknown");
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
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}