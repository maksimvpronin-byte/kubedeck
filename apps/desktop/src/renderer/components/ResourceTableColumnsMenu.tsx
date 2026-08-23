import { Columns3 } from "lucide-react";
import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "../hooks/useAnchoredPopover";
import type { Column } from "./ResourceTable";

interface Props {
  columns: Column[];
  orderedColumns: Column[];
  hiddenColumns: string[];
  label: string;
  resetLabel: string;
  onToggle: (column: Column) => void;
  onReset: () => void;
}

// The popover is regularly taller than the panel it opens from - a cluster has a
// handful of nodes, not a page of pods - and the panel clips what overflows it,
// so it is rendered into the body and placed from the trigger's rectangle.
const POPOVER_WIDTH = 240;
const POPOVER_HEIGHT = 360;

export function ResourceTableColumnsMenu({ columns, orderedColumns, hiddenColumns, label, resetLabel, onToggle, onReset }: Props) {
  const { placement, open, triggerRef, popoverRef, toggle } = useAnchoredPopover(POPOVER_WIDTH, POPOVER_HEIGHT);
  const hidden = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);
  const visibleCount = columns.length - hiddenColumns.filter((key) => columns.some((item) => item.key === key)).length;

  return (
    <div className="table-columns-menu">
      <button
        ref={triggerRef}
        className={`secondary-btn table-columns-trigger ${open ? "is-open" : ""}`}
        type="button"
        title="Choose columns"
        data-tooltip="Choose columns"
        aria-label="Choose visible columns"
        aria-expanded={open}
        onClick={toggle}
      >
        <Columns3 size={16} />
      </button>
      {placement
        ? createPortal(
            <div className="table-columns-popover" ref={popoverRef} style={{ top: placement.top, left: placement.left, maxHeight: placement.maxHeight }}>
              <div className="table-columns-popover-header">
                <strong>{label}</strong>
                <button type="button" onClick={onReset}>
                  {resetLabel}
                </button>
              </div>
              <div className="table-columns-options">
                {orderedColumns.map((column) => {
                  const checked = !hidden.has(column.key);
                  return (
                    <label key={column.key}>
                      <input type="checkbox" checked={checked} disabled={checked && visibleCount <= 1} onChange={() => onToggle(column)} />
                      <span>{column.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
