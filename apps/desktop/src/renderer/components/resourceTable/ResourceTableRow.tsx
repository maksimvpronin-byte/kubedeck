import { memo } from "react";
import type { ResourceRow } from "../../types";
import type { ResourceTableColumn } from "../../hooks/useResourceTableState";
import { formatCell } from "./formatCell";

// Handlers the table hands to every row. They are built once and read the
// current callbacks through a ref, so a row is not re-rendered just because its
// parent rebuilt an arrow function - which is what the table's own props do on
// every render of the application.
export interface ResourceTableRowHandlers {
  open: (row: ResourceRow) => void;
  pin: (row: ResourceRow) => void;
  openNamespace: (namespace: string) => void;
  toggle: (key: string) => void;
  filter: (query: string) => void;
}

interface Props {
  rowKey: string;
  row: ResourceRow;
  columns: ResourceTableColumn[];
  selected: boolean;
  active: boolean;
  handlers: ResourceTableRowHandlers;
}

// A page of this table is 200 rows of a dozen cells by default, and every one of
// them used to be rebuilt whenever anything in the application changed state -
// dragging a column edge, ticking one checkbox, a usage refresh that touched
// three pods. The row only depends on what is passed here, so React can skip
// the ones that did not change.
function Row({ rowKey: key, row, columns, selected, active, handlers }: Props) {
  return (
    <tr className={active ? "selected" : ""} onClick={() => handlers.open(row)} onDoubleClick={() => handlers.pin(row)} onContextMenu={(event) => event.preventDefault()}>
      <td className="select-col" onClick={(event) => event.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={() => handlers.toggle(key)} />
      </td>
      {columns.map((column) => (
        <td key={`${key}-${column.key}`}>
          {column.key === "namespace" && row.namespace ? (
            <button
              type="button"
              className="link-button namespace-pill"
              onClick={(event) => {
                event.stopPropagation();
                handlers.openNamespace(String(row.namespace));
              }}
            >
              {String(row.namespace)}
            </button>
          ) : (
            formatCell(row, column.key, handlers.filter)
          )}
        </td>
      ))}
    </tr>
  );
}

export const ResourceTableRow = memo(Row);
