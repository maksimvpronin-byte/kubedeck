import type { UsageAggregate, UsageHistoryPoint, UsageHistoryResponse } from "../types";

type Metric = "cpu" | "memory";

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
        <span>
          p50 {format(stat.p50)} · p95 {format(stat.p95)} · max {format(stat.max)}
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
              <span className="usage-history-bar" key={point.start} title={`${new Date(point.start).toLocaleTimeString()} · avg ${format(average)} · max ${format(peak)}`}>
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
  const aggregate = history.pod;
  if (!aggregate || history.points.length === 0) {
    return (
      <section className="resource-summary-section" aria-label="Usage history">
        <div className="resource-summary-section-title">Usage history</div>
        <p className="resource-summary-empty">No samples recorded yet. KubeDeck collects usage while it is running, so the first points appear within a few minutes.</p>
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
      </div>
      <UsageHistoryMetric label="CPU" metric="cpu" points={history.points} aggregate={aggregate} request={cpuRequest} limit={cpuLimit} format={formatCpuMillicores} />
      <UsageHistoryMetric label="Memory" metric="memory" points={history.points} aggregate={aggregate} request={memoryRequest} limit={memoryLimit} format={formatMemoryBytes} />
      {history.workload && history.workloadPods > 1 ? (
        <p className="usage-history-workload">
          Across the whole {history.workloadKey}: CPU p95 {formatCpuMillicores(history.workload.cpu.p95)}, peak {formatCpuMillicores(history.workload.cpu.max)}; memory p95{" "}
          {formatMemoryBytes(history.workload.memory.p95)}, peak {formatMemoryBytes(history.workload.memory.max)}.
        </p>
      ) : null}
    </section>
  );
}
