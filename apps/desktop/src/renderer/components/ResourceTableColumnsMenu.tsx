import { Columns3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

export function ResourceTableColumnsMenu({ columns, orderedColumns, hiddenColumns, label, resetLabel, onToggle, onReset }: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const hidden = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);
  const visibleCount = columns.length - hiddenColumns.filter((key) => columns.some((item) => item.key === key)).length;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="table-columns-menu" ref={menuRef}>
      <button
        className={`secondary-btn table-columns-trigger ${open ? "is-open" : ""}`}
        type="button"
        title="Choose columns"
        data-tooltip="Choose columns"
        aria-label="Choose visible columns"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Columns3 size={16} />
      </button>
      {open ? (
        <div className="table-columns-popover">
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
        </div>
      ) : null}
    </div>
  );
}
