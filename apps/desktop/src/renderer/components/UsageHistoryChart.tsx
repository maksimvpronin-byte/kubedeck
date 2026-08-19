import { useState } from "react";
import type { UsageAggregate, UsageHistoryPoint, UsageHistoryResponse } from "../types";

type Metric = "cpu" | "memory";
type Range = "fine" | "full";

interface Props {
  history: UsageHistoryResponse;
  cpuRequest: number | null;
  cpuLimit: number | null;
  memoryRequest: number | null;
  memoryLimit: number | null;
}

export function formatCpuMillicores(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return `${Math.round((value / 1000) * 100) / 100} cores`;
  return `${Math.round(value * 10) / 10}m`;
}

export function formatMemoryBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const units: Array<[string, number]> = [
    ["GiB", 1024 ** 3],
    ["MiB", 1024 ** 2],
    ["KiB", 1024],
  ];
  const [suffix, divisor] = units.find(([, threshold]) => value >= threshold) ?? ["B", 1];
  return `${Math.round((value / divisor) * 10) / 10} ${suffix}`;
}

export function formatWindow(aggregate: UsageAggregate | null): string {
  if (!aggregate || aggregate.firstSampleAt === null || aggregate.lastSampleAt === null) return "";
  const spanMs = aggregate.lastSampleAt - aggregate.firstSampleAt;
  const hours = spanMs / 3_600_000;
  if (hours >= 1) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.max(1, Math.round(spanMs / 60_000))} min`;
}

// KubeDeck samples this itself, so a thin window is the normal state right
// after a first launch rather than an error. Saying how much of the retention
// window is actually covered keeps the numbers honest.
export function coverageLabel(aggregate: UsageAggregate | null): string {
  if (!aggregate) return "";
  const percent = Math.round(aggregate.coverage * 100);
  return percent >= 1 ? `${percent}% of 24 h` : "<1% of 24 h";
}

// A 15-second bucket holds one scrape, so its average and its maximum are the
// same number twice. Only a bucket that actually pooled several readings has
// an average worth naming, and there the sample count says how solid it is.
function pointTitle(point: UsageHistoryPoint, average: string, peak: string): string {
  const time = new Date(point.start).toLocaleTimeString();
  if (point.samples <= 1) return `${time} · ${average}`;
  return `${time} · avg ${average} · max ${peak} · ${point.samples} samples`;
}

function metricValue(point: UsageHistoryPoint, metric: Metric, peak: boolean): number | null {
  if (metric === "cpu") return peak ? point.cpuMax : point.cpuAvg;
  return peak ? point.memoryMax : point.memoryAvg;
}

function UsageHistoryMetric({
  label,
  metric,
  points,
  aggregate,
  request,
  limit,
  format,
}: {
  label: string;
  metric: Metric;
  points: UsageHistoryPoint[];
  aggregate: UsageAggregate | null;
  request: number | null;
  limit: number | null;
  format: (value: number | null) => string;
}) {
  const stat = metric === "cpu" ? aggregate?.cpu : aggregate?.memory;
  const peaks = points.map((point) => metricValue(point, metric, true) ?? 0);
  const observedPeak = peaks.length ? Math.max(...peaks) : 0;
  // The scale has to hold the request and limit too, or a pod sitting far
  // below its request would draw a full bar and look saturated.
  const scale = Math.max(observedPeak, request ?? 0, limit ?? 0) || 1;
  const ratio = (value: number | null) => (value === null ? null : Math.max(0, Math.min(100, (value / scale) * 100)));

  if (!stat || points.length === 0) return null;

  return (
    <div className="usage-history-metric">
      <div className="usage-history-metric-head">
        <strong>{label}</strong>
        {/* Always the full recorded window, even while the chart shows the
            live tail: these are the numbers the sizing verdict rests on, and
            recomputing them per view would make two different p95 values. */}
        <span>
          p50 {format(stat.p50)} · p95 {format(stat.p95)} · max {format(stat.max)} <em>over the whole window</em>
        </span>
      </div>
      <div className="usage-history-plot" role="img" aria-label={`${label}: p50 ${format(stat.p50)}, p95 ${format(stat.p95)}, max ${format(stat.max)}`}>
        {request !== null ? <span className="usage-history-marker is-request" style={{ bottom: `${ratio(request)}%` }} title={`request ${format(request)}`} /> : null}
        {limit !== null ? <span className="usage-history-marker is-limit" style={{ bottom: `${ratio(limit)}%` }} title={`limit ${format(limit)}`} /> : null}
        <div className="usage-history-bars">
          {points.map((point) => {
            const average = metricValue(point, metric, false);
            const peak = metricValue(point, metric, true);
            return (
              <span className="usage-history-bar" key={point.start} title={pointTitle(point, format(average), format(peak))}>
                <span className="usage-history-bar-peak" style={{ height: `${ratio(peak) ?? 0}%` }} />
                <span className="usage-history-bar-avg" style={{ height: `${ratio(average) ?? 0}%` }} />
              </span>
            );
          })}
        </div>
      </div>
      <div className="usage-history-legend">
        <span>request {format(request)}</span>
        <span>limit {format(limit)}</span>
      </div>
    </div>
  );
}

export function UsageHistoryChart({ history, cpuRequest, cpuLimit, memoryRequest, memoryLimit }: Props) {
  // The live view is the one people open this panel for, so it is the default.
  // The full window stays one click away, and its bars are five-minute
  // averages - the same points every percentile above is computed from.
  const [range, setRange] = useState<Range>("fine");
  const aggregate = history.pod;
  const finePoints = history.finePoints ?? [];
  const fineAvailable = finePoints.length > 0;
  const points = range === "fine" && fineAvailable ? finePoints : history.points;

  if (!aggregate || history.points.length === 0) {
    return (
      <section className="resource-summary-section" aria-label="Usage history">
        <div className="resource-summary-section-title">Usage history</div>
        <p className="resource-summary-empty">
          No samples recorded yet. KubeDeck records usage every 15 seconds while it runs, matching how often metrics-server publishes, and metrics-server itself needs two scrapes before it can report
          CPU for a freshly created pod. The first points appear shortly, and this panel refreshes on its own.
        </p>
      </section>
    );
  }

  return (
    <section className="resource-summary-section usage-history" aria-label="Usage history">
      <div className="resource-summary-section-title">
        Usage history
        <span className="usage-history-scope">
          {formatWindow(aggregate)} recorded · {coverageLabel(aggregate)}
          {history.workload && history.workloadPods > 1 ? ` · ${history.workloadKey} across ${history.workloadPods} pods` : ""}
        </span>
        {fineAvailable ? (
          <span className="usage-history-range" role="group" aria-label="Chart window">
            <button type="button" className={range === "fine" ? "is-active" : ""} onClick={() => setRange("fine")} aria-pressed={range === "fine"}>
              {Math.round(history.fineRetentionMs / 60_000)} min
            </button>
            <button type="button" className={range === "full" ? "is-active" : ""} onClick={() => setRange("full")} aria-pressed={range === "full"}>
              {Math.round(history.retentionMs / 3_600_000)} h
            </button>
          </span>
        ) : null}
      </div>
      <UsageHistoryMetric label="CPU" metric="cpu" points={points} aggregate={aggregate} request={cpuRequest} limit={cpuLimit} format={formatCpuMillicores} />
      <UsageHistoryMetric label="Memory" metric="memory" points={points} aggregate={aggregate} request={memoryRequest} limit={memoryLimit} format={formatMemoryBytes} />
      {history.workload && history.workloadPods > 1 ? (
        <p className="usage-history-workload">
          Across the whole {history.workloadKey}: CPU p95 {formatCpuMillicores(history.workload.cpu.p95)}, peak {formatCpuMillicores(history.workload.cpu.max)}; memory p95{" "}
          {formatMemoryBytes(history.workload.memory.p95)}, peak {formatMemoryBytes(history.workload.memory.max)}.
        </p>
      ) : null}
    </section>
  );
}
