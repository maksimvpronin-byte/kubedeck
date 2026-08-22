import { Columns3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const POPOVER_WIDTH = 240;
const VIEWPORT_MARGIN = 12;
const TRIGGER_GAP = 6;

interface Placement {
  top: number;
  left: number;
  maxHeight: number;
}

// The popover is regularly taller than the panel it opens from - a cluster has a
// handful of nodes, not a page of pods, and the panel is only as tall as its
// table. `.resource-table-panel` clips what overflows it, and its
// `container-type` makes it the containing block even for a fixed child, so the
// popover has to leave the panel's subtree entirely to be seen whole.
function placePopover(trigger: HTMLElement): Placement {
  const bounds = trigger.getBoundingClientRect();
  const below = window.innerHeight - bounds.bottom - TRIGGER_GAP - VIEWPORT_MARGIN;
  const above = bounds.top - TRIGGER_GAP - VIEWPORT_MARGIN;
  const upward = below < 220 && above > below;
  const maxHeight = Math.max(120, Math.min(360, upward ? above : below));
  return {
    top: upward ? Math.max(VIEWPORT_MARGIN, bounds.top - TRIGGER_GAP - maxHeight) : bounds.bottom + TRIGGER_GAP,
    left: Math.max(VIEWPORT_MARGIN, Math.min(bounds.right - POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN - POPOVER_WIDTH)),
    maxHeight,
  };
}

export function ResourceTableColumnsMenu({ columns, orderedColumns, hiddenColumns, label, resetLabel, onToggle, onReset }: Props) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const open = placement !== null;
  const hidden = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);
  const visibleCount = columns.length - hiddenColumns.filter((key) => columns.some((item) => item.key === key)).length;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      // The trigger closes through its own click handler; swallowing its
      // pointerdown here would reopen the popover on the click that follows.
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setPlacement(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlacement(null);
    };
    const reposition = () => {
      if (triggerRef.current) setPlacement(placePopover(triggerRef.current));
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const toggleOpen = () => {
    const trigger = triggerRef.current;
    setPlacement((current) => (current || !trigger ? null : placePopover(trigger)));
  };

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
        onClick={toggleOpen}
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
