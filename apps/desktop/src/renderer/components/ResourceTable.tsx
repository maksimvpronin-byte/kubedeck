import { RefreshCw, Search, Trash2, X } from "lucide-react";
import { useRef } from "react";
import type { ReactNode } from "react";
import type { ResourceRow } from "../types";
import { useUiClock } from "../hooks/useUiClock";
import { PAGE_SIZE_OPTIONS, rowKey, useResourceTableState, type ResourceTableColumn } from "../hooks/useResourceTableState";
import { formatElapsed } from "../utils/time";
import { ResourceTableColumnsMenu } from "./ResourceTableColumnsMenu";
import { ResourceTablePagination } from "./ResourceTablePagination";

export type Column = ResourceTableColumn;

interface Props {
  title: string;
  rows: ResourceRow[];
  columns: Column[];
  loading: boolean;
  onRefresh: () => void;
  onOpen?: (row: ResourceRow) => void;
  onNamespaceClick?: (namespace: string) => void;
  onBulkDelete?: (rows: ResourceRow[]) => void;
  onBulkCordon?: (rows: ResourceRow[]) => void;
  onBulkUncordon?: (rows: ResourceRow[]) => void;
  onBulkDrain?: (rows: ResourceRow[]) => void;
  selectedRow?: ResourceRow | null;
  filterLabel: string;
  refreshLabel: string;
  stateKey: string;
  labels?: Partial<{
    shownOf: string;
    page: string;
    deleteSelected: string;
    rows: string;
    of: string;
    pageSize: string;
    first: string;
    prev: string;
    next: string;
    last: string;
    emptyTitle: string;
    emptyText: string;
    emptyFilteredTitle: string;
    emptyFilteredText: string;
    clearFilter: string;
    columns: string;
    resetColumns: string;
  }>;
}

export function ResourceTable({
  title,
  rows,
  columns,
  loading,
  onRefresh,
  onOpen,
  onNamespaceClick,
  onBulkDelete,
  onBulkCordon,
  onBulkUncordon,
  onBulkDrain,
  selectedRow,
  filterLabel,
  refreshLabel,
  stateKey,
  labels,
}: Props) {
  const ui = {
    shownOf: labels?.shownOf ?? "shown of",
    page: labels?.page ?? "page",
    deleteSelected: labels?.deleteSelected ?? "Delete selected",
    rows: labels?.rows ?? "Rows",
    of: labels?.of ?? "of",
    pageSize: labels?.pageSize ?? "Page size",
    first: labels?.first ?? "First",
    prev: labels?.prev ?? "Prev",
    next: labels?.next ?? "Next",
    last: labels?.last ?? "Last",
    emptyTitle: labels?.emptyTitle ?? "No resources to display",
    emptyText: labels?.emptyText ?? "The selected namespace or scope does not contain this resource. Try another namespace or refresh.",
    emptyFilteredTitle: labels?.emptyFilteredTitle ?? "No rows match the filter",
    emptyFilteredText: labels?.emptyFilteredText ?? "Clear the filter or change the search text.",
    clearFilter: labels?.clearFilter ?? "Clear filter",
    columns: labels?.columns ?? "Columns",
    resetColumns: labels?.resetColumns ?? "Reset columns",
  };

  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const table = useResourceTableState(rows, columns, stateKey);
  const {
    tableRef, query, setQuery, sortKey, sortDirection, selected, pageSize, setPageSize,
    setPageIndex, orderedColumns, hiddenColumns, visibleColumns, visibleRows, renderedRows,
    selectedRows, selectedPageRows, totalPages, safePageIndex, pageStart, draggedColumn,
    setDraggedColumn, dragOverColumn, setDragOverColumn, widthFor, changeSort, toggleRow,
    setPageSelected, startColumnResize, startColumnDrag, dropColumn, toggleColumn, resetColumns,
  } = table;
  const now = useUiClock(columns.some((column) => column.key === "createdAt"), 1000);
  const tableWidth = 38 + visibleColumns.reduce((sum, column) => sum + widthFor(column), 0);
  const selectedRowKey = selectedRow ? rowKey(selectedRow) : "";
  const hasFilter = query.trim().length > 0;
  const filteredEmpty = rows.length > 0 && hasFilter && visibleRows.length === 0;
  const showEmptyState = !loading && renderedRows.length === 0;
  const emptyTitle = filteredEmpty ? ui.emptyFilteredTitle : ui.emptyTitle;
  const emptyText = filteredEmpty ? ui.emptyFilteredText : ui.emptyText;

  const allPageSelected = renderedRows.length > 0 && selectedPageRows.length === renderedRows.length;
  const nodeActionsVisible = selectedRows.length > 0 && Boolean(onBulkCordon || onBulkUncordon || onBulkDrain);
  const controlsDisabled = loading && rows.length === 0;

  return (
    <section className="resource-table-panel" ref={tableRef}>
      <div className="resource-table-header">
        <div>
          <h2>{title}</h2>
          <div className="muted small">
            {visibleRows.length} {ui.shownOf} {rows.length}
            {visibleRows.length > 0 ? `, ${ui.page} ${safePageIndex + 1}/${totalPages}` : ""}
          </div>
        </div>
        <div className="resource-table-actions">
          {nodeActionsVisible ? (
            <>
              {onBulkCordon ? (
                <button className="secondary-btn" type="button" onClick={() => onBulkCordon(selectedRows)} disabled={controlsDisabled}>
                  Cordon ({selectedRows.length})
                </button>
              ) : null}
              {onBulkUncordon ? (
                <button className="secondary-btn" type="button" onClick={() => onBulkUncordon(selectedRows)} disabled={controlsDisabled}>
                  Uncordon ({selectedRows.length})
                </button>
              ) : null}
              {onBulkDrain ? (
                <button className="danger-btn" type="button" onClick={() => onBulkDrain(selectedRows)} disabled={controlsDisabled}>
                  Drain ({selectedRows.length})
                </button>
              ) : null}
            </>
          ) : null}
          {onBulkDelete && selectedRows.length > 0 ? (
            <button className="danger-btn" type="button" onClick={() => onBulkDelete(selectedRows)} disabled={controlsDisabled}>
              <Trash2 size={14} /> {ui.deleteSelected} ({selectedRows.length})
            </button>
          ) : null}
          <ResourceTableColumnsMenu
            columns={columns}
            orderedColumns={orderedColumns}
            hiddenColumns={hiddenColumns}
            label={ui.columns}
            resetLabel={ui.resetColumns}
            onToggle={toggleColumn}
            onReset={resetColumns}
          />
          <div className="table-filter">
            <Search size={14} />
            <input ref={filterInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={filterLabel} />
            {hasFilter ? (
              <button
                type="button"
                className="table-filter-clear"
                aria-label={ui.clearFilter}
                title={ui.clearFilter}
                onClick={() => {
                  setQuery("");
                  filterInputRef.current?.focus();
                }}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
          <button className="secondary-btn" type="button" onClick={onRefresh} disabled={controlsDisabled}>
            <RefreshCw size={14} /> {refreshLabel}
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="resource-table" style={{ width: tableWidth }}>
          <colgroup>
            <col style={{ width: 38 }} />
            {visibleColumns.map((column) => (
              <col key={column.key} style={{ width: widthFor(column) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="select-col">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  disabled={renderedRows.length === 0}
                  onChange={(event) => setPageSelected(event.target.checked)}
                />
              </th>
              {visibleColumns.map((column) => (
                <th
                  key={column.key}
                  draggable
                  className={`${draggedColumn === column.key ? "dragging-column" : ""} ${dragOverColumn === column.key && draggedColumn !== column.key ? "drag-over-column" : ""}`.trim()}
                  onDragStart={(event) => startColumnDrag(event, column)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverColumn(column.key);
                  }}
                  onDragLeave={() => setDragOverColumn((current) => current === column.key ? "" : current)}
                  onDrop={(event) => dropColumn(event, column)}
                  onDragEnd={() => {
                    setDraggedColumn("");
                    setDragOverColumn("");
                  }}
                >
                  <button type="button" className="table-sort-button" draggable={false} onClick={() => changeSort(column.key)}>
                    <span className="table-sort-label">{column.label}</span>
                    {sortKey === column.key ? (
                      <span className="table-sort-indicator" aria-hidden="true">
                        {sortDirection === 1 ? "ASC" : "DESC"}
                      </span>
                    ) : null}
                  </button>
                  <span
                    className="column-resizer"
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    onMouseDown={(event) => startColumnResize(event, column)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {renderedRows.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  className={`${selectedRowKey === key ? "selected" : ""} ${rowHealthClass(row)}`.trim()}
                  onClick={() => onOpen?.(row)}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <td className="select-col" onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(key)} onChange={() => toggleRow(key)} />
                  </td>
                  {visibleColumns.map((column) => {
                    const cellContent = column.key === "namespace" && row.namespace ? (
                      <button
                        type="button"
                        className="link-button namespace-pill"
                        onClick={(event) => {
                          event.stopPropagation();
                          onNamespaceClick?.(String(row.namespace));
                        }}
                      >
                        {String(row.namespace)}
                      </button>
                    ) : (
                      formatCell(row, column.key, now)
                    );
                    return <td key={`${key}-${column.key}`}>{cellContent}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showEmptyState ? (
        <div className="empty-state">
          <h3>{emptyTitle}</h3>
          <p>{emptyText}</p>
          {filteredEmpty ? (
            <button className="secondary-btn" type="button" onClick={() => setQuery("")}>{ui.clearFilter}</button>
          ) : null}
        </div>
      ) : null}

      <ResourceTablePagination
        rowCount={visibleRows.length}
        pageStart={pageStart}
        renderedCount={renderedRows.length}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        pageIndex={safePageIndex}
        totalPages={totalPages}
        labels={ui}
        onPageSizeChange={(size) => { setPageSize(size); setPageIndex(0); }}
        onPageChange={setPageIndex}
      />
    </section>
  );
}

function formatCell(row: ResourceRow, key: string, now: number): ReactNode {
  if (key === "phase") {
    const reason = rowHealthReason(row);
    return (
      <span>
        {String(row.phase ?? "")}
        {reason ? <span className="cell-hint">{reason}</span> : null}
      </span>
    );
  }
  if (key === "containers") return renderContainerStatus(row);
  if (key !== "createdAt") return String(row[key] ?? "");
  const createdAt = String(row.createdAt ?? "");
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return createdAt;
  return formatElapsed(Math.max(0, now - createdMs));
}

function renderContainerStatus(row: ResourceRow): ReactNode {
  const containers = normalizeContainerStatusItems(row);
  if (containers.length === 0) return "";

  return (
    <span className="container-status-cubes" aria-label={containers.map((container) => container.title).join("; ")}>
      {containers.map((container) => (
        <span
          key={container.name}
          className={`container-status-cube is-${container.tone}`}
          title={container.title}
          aria-label={container.title}
        />
      ))}
    </span>
  );
}

type ContainerTone = "ready" | "running" | "waiting" | "terminated" | "unknown";

interface ContainerStatusItem {
  name: string;
  tone: ContainerTone;
  title: string;
}

function normalizeContainerStatusItems(row: ResourceRow): ContainerStatusItem[] {
  const rawStates = row.containerStates;
  if (Array.isArray(rawStates) && rawStates.length > 0) {
    return rawStates.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const name = String(record.name || `container-${index + 1}`);
      const state = String(record.state || "unknown").toLowerCase();
      const ready = record.ready === true;
      const reason = String(record.reason || "");
      const restartCount = Number(record.restartCount ?? 0);
      const tone = containerTone(state, ready);
      const details = [
        ready ? "ready" : "not ready",
        state && state !== "unknown" ? state : "",
        reason,
        Number.isFinite(restartCount) && restartCount > 0 ? `${restartCount} restarts` : "",
      ].filter(Boolean).join(", ");
      return [{ name, tone, title: `${name}: ${details || "unknown"}` }];
    });
  }

  const rawContainers = row.containers;
  if (!Array.isArray(rawContainers)) return [];
  return rawContainers.flatMap((name, index) => {
    const label = String(name || `container-${index + 1}`);
    return label ? [{ name: label, tone: "unknown" as const, title: `${label}: unknown` }] : [];
  });
}

function containerTone(state: string, ready: boolean): ContainerTone {
  if (ready) return "ready";
  if (state === "terminated") return "terminated";
  if (state === "waiting") return "waiting";
  if (state === "running") return "running";
  return "unknown";
}

function rowHealthClass(row: ResourceRow) {
  return rowHealthReason(row) ? "resource-row-warning" : "";
}

function rowHealthReason(row: ResourceRow) {
  const phase = String(row.phase ?? "");
  const ready = String(row.ready ?? "");
  const reason = String(row.reason ?? "");
  const statusMessage = String(row.statusMessage ?? "");
  const containerProblems = String(row.containerProblems ?? "");
  const conditions = String(row.conditions ?? "");
  if (["Succeeded", "Completed"].includes(phase)) return "";
  if (containerProblems) return compactReason(containerProblems);
  if (reason || statusMessage) return compactReason(reason || statusMessage);
  if (conditions) return compactReason(conditions);
  if (phase && !["Running", "Succeeded", "Completed"].includes(phase)) return phase;
  if (phase === "Running" && ready.includes("/")) {
    const [current, total] = ready.split("/");
    if (total && current !== total) return `Ready ${ready}`;
  }
  return "";
}

function compactReason(value: string) {
  const first = value.split(";")[0]?.trim() ?? value;
  return first.length > 72 ? `${first.slice(0, 69)}...` : first;
}
