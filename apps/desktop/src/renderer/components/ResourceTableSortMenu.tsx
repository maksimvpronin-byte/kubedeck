import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ColumnSortMetric } from "../utils/resourceTableSortMetrics";
import { SortDirectionArrow } from "./SortDirectionArrow";

interface Props {
  label: string;
  metrics: ColumnSortMetric[];
  sortKey: string;
  sortDirection: 1 | -1;
  sortByLabel: string;
  onSelect: (metricKey: string) => void;
}

// The header of a usage column asks which of its values to sort by, because the
// cell shows several. Picking the value that is already active flips the
// direction, so it behaves like every other header once a choice is made.
export function ResourceTableSortMenu({ label, metrics, sortKey, sortDirection, sortByLabel, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const active = metrics.find((metric) => metric.key === sortKey) ?? null;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="table-sort-menu" ref={menuRef}>
      <button
        type="button"
        className="table-sort-button"
        draggable={false}
        aria-expanded={open}
        aria-label={active ? `${label}: ${sortByLabel} ${active.label}` : `${label}: ${sortByLabel}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="table-sort-label">{label}</span>
        {active ? (
          <>
            <span className="table-sort-metric">{active.label}</span>
            <SortDirectionArrow direction={sortDirection} />
          </>
        ) : (
          <ChevronDown className="table-sort-caret" size={12} aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div className="table-sort-popover">
          <div className="table-sort-popover-header">{sortByLabel}</div>
          {metrics.map((metric) => (
            <button
              key={metric.key}
              type="button"
              className={metric.key === sortKey ? "is-active" : ""}
              onClick={() => {
                onSelect(metric.key);
                setOpen(false);
              }}
            >
              <span>{metric.label}</span>
              {metric.key === sortKey ? <SortDirectionArrow direction={sortDirection} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
