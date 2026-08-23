import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeAnchoredPopover, type PopoverPlacement } from "../utils/popoverPlacement";
import type { ResourceRow } from "../types";

export interface NodeLabel {
  key?: unknown;
  label?: unknown;
  value?: unknown;
  full?: unknown;
}

const CHIP_LIMIT = 2;
const POPOVER_WIDTH = 340;
const POPOVER_HEIGHT = 320;

function labelText(label: NodeLabel): string {
  return String(label.full || label.key || "");
}

// A cell has room for three chips at most, and the rest used to live in a
// native tooltip: a comma-joined blob that cannot be read, selected or copied.
// The remainder opens as a popover instead, rendered into the body so the
// table's own clipping cannot cut it off.
export function NodeLabelsCell({ row, onFilter }: { row: ResourceRow; onFilter?: (query: string) => void }) {
  const labels = ((row.nodeLabelItems as NodeLabel[]) ?? []).filter(Boolean);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);
  const open = placement !== null;
  const visible = labels.slice(0, CHIP_LIMIT);
  const hidden = labels.length - visible.length;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setPlacement(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlacement(null);
    };
    const reposition = () => {
      if (triggerRef.current) setPlacement(placeAnchoredPopover(triggerRef.current, POPOVER_WIDTH, POPOVER_HEIGHT));
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

  if (labels.length === 0) return null;

  // Every click in the cell has to be stopped: the row underneath opens the
  // resource, and filtering by a label is not a request to open a node.
  const filterBy = (label: NodeLabel) => {
    onFilter?.(labelText(label));
    setPlacement(null);
  };

  return (
    <span className="node-label-list">
      {visible.map((label) => (
        <button
          type="button"
          className="node-label-chip"
          title={`Filter by ${labelText(label)}`}
          key={String(label.key)}
          onClick={(event) => {
            event.stopPropagation();
            filterBy(label);
          }}
        >
          {String(label.label || label.key)}
          {label.value ? `: ${String(label.value)}` : ""}
        </button>
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          ref={triggerRef}
          className={`node-label-more ${open ? "is-open" : ""}`}
          aria-expanded={open}
          aria-label={`Show all ${labels.length} labels`}
          title={`Show all ${labels.length} labels`}
          onClick={(event) => {
            event.stopPropagation();
            const trigger = triggerRef.current;
            setPlacement((current) => (current || !trigger ? null : placeAnchoredPopover(trigger, POPOVER_WIDTH, POPOVER_HEIGHT)));
          }}
        >
          +{hidden}
        </button>
      ) : null}
      {placement
        ? createPortal(
            <div className="node-label-popover" ref={popoverRef} style={{ top: placement.top, left: placement.left, maxHeight: placement.maxHeight }} onClick={(event) => event.stopPropagation()}>
              <div className="node-label-popover-header">
                <strong>{String(row.name || "Labels")}</strong>
                <span>{labels.length} labels</span>
              </div>
              <div className="node-label-popover-list">
                {labels.map((label) => (
                  <button type="button" key={String(label.key)} title={`Filter by ${labelText(label)}`} onClick={() => filterBy(label)}>
                    <code>{labelText(label)}</code>
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

// Roles are the suffixes of valueless labels, which is why they read as their
// own words rather than as "Role: true".
export function NodeRolesCell({ row }: { row: ResourceRow }) {
  const roles = String(row.roles || "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  if (roles.length === 0) return null;
  return (
    <span className="node-role-list">
      {roles.map((role) => (
        <span className={`node-role-chip ${role === "control-plane" || role === "master" ? "is-control-plane" : ""}`} key={role}>
          {role}
        </span>
      ))}
    </span>
  );
}
