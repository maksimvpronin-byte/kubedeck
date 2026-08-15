export function ResourceUsageBar({
  label,
  tone,
  percent,
  used,
  free,
  allocatable,
  denominator,
  denominatorLabel = "allocatable",
  unavailableLabel = "N/A",
  details: explicitDetails,
  variant,
}: {
  label: string;
  tone: string;
  percent: number | null;
  used: unknown;
  free?: unknown;
  allocatable?: unknown;
  denominator?: unknown;
  denominatorLabel?: string;
  unavailableLabel?: string;
  details?: string;
  /** "soft" marks a bar measured against a request rather than a hard limit. */
  variant?: "soft";
}) {
  const total = denominator ?? allocatable;
  const details =
    explicitDetails ??
    (percent === null
      ? `${label}: ${String(used || "metrics N/A")}${used ? " used" : ""} · ${unavailableLabel}`
      : `${label}: ${String(used || "—")} used${free ? ` · ${String(free)} free` : ""} · ${String(total || "—")} ${denominatorLabel} · ${percent}%`);
  // A ratio against a request can exceed 100%. The track still stops at full
  // width, but the reading keeps the real number.
  const over = percent !== null && percent > 100;
  const classNames = ["resource-usage-bar", `is-${tone}`, variant === "soft" ? "is-soft" : "", over ? "is-over" : ""].filter(Boolean).join(" ");
  return (
    <span className={classNames} title={details}>
      <span className="resource-usage-label">{label}</span>
      <span
        className="resource-usage-track"
        role={percent === null ? undefined : "progressbar"}
        aria-label={details}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuemax={percent === null ? undefined : Math.max(100, percent)}
        aria-valuenow={percent ?? undefined}
      >
        {percent === null ? null : <span style={{ width: `${Math.min(100, percent)}%` }} />}
      </span>
      <small>{percent === null ? unavailableLabel : `${percent}%`}</small>
    </span>
  );
}

export function metricPercent(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? "").replace("%", ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : null;
}
