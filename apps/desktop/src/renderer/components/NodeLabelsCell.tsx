import { createPortal } from "react-dom";
import { useAnchoredPopover } from "../hooks/useAnchoredPopover";
import { annotationItems } from "../utils/annotationSort";
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
  const { placement, open, triggerRef, popoverRef, toggle, close } = useAnchoredPopover(POPOVER_WIDTH, POPOVER_HEIGHT);
  const visible = labels.slice(0, CHIP_LIMIT);
  const hidden = labels.length - visible.length;

  if (labels.length === 0) return null;

  // Every click in the cell has to be stopped: the row underneath opens the
  // resource, and filtering by a label is not a request to open a node.
  const filterBy = (label: NodeLabel) => {
    onFilter?.(labelText(label));
    close();
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
            toggle();
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

// Annotations are off the table by default and hold no chips: their values are
// JSON documents and command lines, and none of that reads at the width of a
// column. What the cell offers is how many there are and a way to read them.
export function NodeAnnotationsCell({ row, onFilter }: { row: ResourceRow; onFilter?: (query: string) => void }) {
  const annotations = annotationItems(row);
  const { placement, open, triggerRef, popoverRef, toggle, close } = useAnchoredPopover(POPOVER_WIDTH, POPOVER_HEIGHT);

  if (annotations.length === 0) return null;

  const filterBy = (key: string, value: string) => {
    onFilter?.(value ? `${key}=${value}` : key);
    close();
  };

  return (
    <span className="node-label-list">
      <button
        type="button"
        ref={triggerRef}
        className={`node-label-more ${open ? "is-open" : ""}`}
        aria-expanded={open}
        aria-label={`Show ${annotations.length} annotations`}
        title={`Show ${annotations.length} annotations`}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
      >
        {annotations.length} annotation{annotations.length === 1 ? "" : "s"}
      </button>
      {placement
        ? createPortal(
            <div className="node-label-popover" ref={popoverRef} style={{ top: placement.top, left: placement.left, maxHeight: placement.maxHeight }} onClick={(event) => event.stopPropagation()}>
              <div className="node-label-popover-header">
                <strong>{String(row.name || "Annotations")}</strong>
                <span>{annotations.length} annotations</span>
              </div>
              <div className="node-label-popover-list">
                {annotations.map((annotation) => (
                  <button type="button" key={annotation.key} title={`Filter by ${annotation.key}`} onClick={() => filterBy(annotation.key, annotation.value)}>
                    <code>{annotation.key}</code>
                    <code className="node-label-popover-value">{annotation.value || "(empty)"}</code>
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
