import type { ReactNode } from "react";
import { useElapsedLabel } from "../../hooks/useUiClock";
import type { ResourceRow } from "../../types";
import { normalizeContainerStatusItems } from "./rowStatus";

// The second hand lives in the cell rather than in the table. Reading the clock
// at the table level re-rendered every row of every column once a second only to
// move the ages forward; here a tick reaches the ages alone, and React skips even
// those whose text did not change.
export function AgeCell({ createdAt }: { createdAt: string }) {
  const createdMs = Date.parse(createdAt);
  const valid = Number.isFinite(createdMs);
  const label = useElapsedLabel(valid ? createdMs : 0);
  return <>{valid ? label : createdAt}</>;
}

type WorkloadCondition = { label?: unknown; reason?: unknown; message?: unknown; tone?: unknown };

export function WorkloadConditions({ row }: { row: ResourceRow }) {
  const conditions = (row.workloadConditions as WorkloadCondition[]).filter((condition) => condition && condition.label);
  const replicaSummary = `Ready ${String(row.ready ?? "—")} · Updated ${String(row.updated ?? "—")} · Available ${String(row.available ?? "—")}`;
  const full = conditions
    .map((condition) => `${String(condition.label)}${condition.reason ? `: ${String(condition.reason)}` : ""}${condition.message ? ` — ${String(condition.message)}` : ""}`)
    .join("; ");
  return (
    <span className="workload-condition-list" aria-label={`${full}. ${replicaSummary}`}>
      {conditions.map((condition) => (
        <span
          className={`workload-condition is-${String(condition.tone || "neutral")}`}
          title={`${String(condition.reason || condition.label)}${condition.message ? `: ${String(condition.message)}` : ""} · ${replicaSummary}`}
          key={String(condition.label)}
        >
          {String(condition.label)}
        </span>
      ))}
    </span>
  );
}

export function renderContainerStatus(row: ResourceRow): ReactNode {
  const containers = normalizeContainerStatusItems(row);
  if (containers.length === 0) return "";

  return (
    <span className="container-status-cubes" aria-label={containers.map((container) => container.title).join("; ")}>
      {containers.map((container) => (
        <span key={container.name} className={`container-status-cube is-${container.tone}`} title={container.title} aria-label={container.title} />
      ))}
    </span>
  );
}
