import { RefreshCw, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { ResourceRow } from "../types";
import { loadUiState, saveUiState } from "../uiState";
import { useUiClock } from "../hooks/useUiClock";
import { formatElapsed, parseTimestamp } from "../utils/time";
import { ResourceTableColumnsMenu } from "./ResourceTableColumnsMenu";
import { ResourceTablePagination } from "./ResourceTablePagination";

export interface Column {
  key: string;
  label: string;
}

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 1000];
const DEFAULT_PAGE_SIZE = 200;
const COMPACT_TABLE_WIDTH = 920;
const NARROW_TABLE_WIDTH = 760;

const COMPACT_HIDDEN_COLUMNS = new Set([
  "ready",
  "restarts",
  "cpuUsage",
  "memoryUsage",
  "ports",
  "clusterIp",
  "externalIp",
  "labels",
  "conditions",
  "reason",
  "statusMessage",
  "containerProblems",
]);

const NARROW_HIDDEN_COLUMNS = new Set([
  "node",
  "storageClass",
  "accessModes",
  "capacity",
]);

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

  const tableRef = useRef<HTMLElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(columns[0]?.key ?? "name");
  const [sortDirection, setSortDirection] = useState<1 | -1>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => loadUiState().columnWidths?.[stateKey] ?? {});
  const [columnOrder, setColumnOrder] = useState<string[]>(() => normalizeColumnOrder(loadUiState().columnOrders?.[stateKey] ?? [], columns));
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => normalizeHiddenColumns(loadUiState().hiddenColumns?.[stateKey] ?? [], columns));
  const [draggedColumn, setDraggedColumn] = useState("");
  const [dragOverColumn, setDragOverColumn] = useState("");
  const now = useUiClock(columns.some((column) => column.key === "createdAt"), 1000);

  useEffect(() => {
    const element = tableRef.current;
    if (!element) return undefined;
    const updateWidth = () => setContainerWidth(element.getBoundingClientRect().width);
    updateWidth();
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const compactTable = containerWidth > 0 && containerWidth < COMPACT_TABLE_WIDTH;
  const narrowTable = containerWidth > 0 && containerWidth < NARROW_TABLE_WIDTH;
  const orderedColumns = useMemo(() => orderColumns(columns, columnOrder), [columns, columnOrder]);
  const hiddenColumnSet = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);
  const userVisibleColumns = useMemo(() => {
    const filtered = orderedColumns.filter((column) => !hiddenColumnSet.has(column.key));
    return filtered.length > 0 ? filtered : orderedColumns.slice(0, 1);
  }, [orderedColumns, hiddenColumnSet]);

  const visibleColumns = useMemo(() => {
    if (!compactTable) return userVisibleColumns;
    const hidden = new Set(COMPACT_HIDDEN_COLUMNS);
    if (narrowTable) NARROW_HIDDEN_COLUMNS.forEach((key) => hidden.add(key));
    const filtered = userVisibleColumns.filter((column) => !hidden.has(column.key));
    return filtered.length >= Math.min(3, userVisibleColumns.length) ? filtered : userVisibleColumns;
  }, [userVisibleColumns, compactTable, narrowTable]);

  useEffect(() => {
    if (visibleColumns.length === 0) return;
    if (visibleColumns.some((column) => column.key === sortKey)) return;
    const nameColumn = visibleColumns.find((column) => column.key === "name");
    setSortKey(nameColumn?.key ?? visibleColumns[0].key);
  }, [visibleColumns, sortKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const state = loadUiState();
      saveUiState({
        ...state,
        columnWidths: {
          ...(state.columnWidths ?? {}),
          [stateKey]: columnWidths,
        },
        columnOrders: {
          ...(state.columnOrders ?? {}),
          [stateKey]: normalizeColumnOrder(columnOrder, columns),
        },
        hiddenColumns: {
          ...(state.hiddenColumns ?? {}),
          [stateKey]: normalizeHiddenColumns(hiddenColumns, columns),
        },
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [columnWidths, columnOrder, hiddenColumns, columns, stateKey]);

  useEffect(() => {
    const visibleKeys = new Set(rows.map(rowKey));
    setSelected((current) => new Set(Array.from(current).filter((key) => visibleKeys.has(key))));
  }, [rows]);

  const visibleRows = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const filtered = lower
      ? rows.filter((row) => columns.some((column) => String(row[column.key] ?? "").toLowerCase().includes(lower)))
      : rows;
    return [...filtered].sort((a, b) => compareRows(a, b, sortKey) * sortDirection);
  }, [query, rows, sortKey, sortDirection, columns]);

  useEffect(() => {
    setPageIndex(0);
  }, [query, sortKey, sortDirection, pageSize, stateKey]);

  useEffect(() => {
    setPageIndex((current) => Math.min(current, Math.max(0, Math.ceil(visibleRows.length / pageSize) - 1)));
  }, [visibleRows.length, pageSize]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pageStart = safePageIndex * pageSize;
  const tableWidth = useMemo(() => 38 + visibleColumns.reduce((sum, column) => sum + widthFor(column), 0), [visibleColumns, columnWidths, compactTable, narrowTable]);
  const renderedRows = useMemo(() => visibleRows.slice(pageStart, pageStart + pageSize), [visibleRows, pageStart, pageSize]);
  const selectedRows = useMemo(() => visibleRows.filter((row) => selected.has(rowKey(row))), [visibleRows, selected]);
  const selectedPageRows = useMemo(() => renderedRows.filter((row) => selected.has(rowKey(row))), [renderedRows, selected]);
  const selectedRowKey = selectedRow ? rowKey(selectedRow) : "";
  const hasFilter = query.trim().length > 0;
  const filteredEmpty = rows.length > 0 && hasFilter && visibleRows.length === 0;
  const showEmptyState = !loading && renderedRows.length === 0;
  const emptyTitle = filteredEmpty ? ui.emptyFilteredTitle : ui.emptyTitle;
  const emptyText = filteredEmpty ? ui.emptyFilteredText : ui.emptyText;

  function changeSort(key: string) {
    if (key === sortKey) {
      setSortDirection((current) => (current === 1 ? -1 : 1));
      return;
    }
    setSortKey(key);
    setSortDirection(1);
  }

  function toggle(uid: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  function widthFor(column: Column) {
    const preferredWidth = columnWidths[column.key] ?? defaultColumnWidth(column.key);
    if (!compactTable) return preferredWidth;
    return Math.min(preferredWidth, compactColumnWidth(column.key, narrowTable));
  }

  function startColumnResize(event: ReactMouseEvent, column: Column) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthFor(column);
    const onMove = (moveEvent: globalThis.MouseEvent) => {
      const next = Math.max(48, startWidth + moveEvent.clientX - startX);
      setColumnWidths((current) => ({ ...current, [column.key]: next }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
  }

  function startColumnDrag(event: ReactDragEvent<HTMLTableCellElement>, column: Column) {
    setDraggedColumn(column.key);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", column.key);
  }

  function dropColumn(event: ReactDragEvent<HTMLTableCellElement>, target: Column) {
    event.preventDefault();
    const sourceKey = event.dataTransfer.getData("text/plain") || draggedColumn;
    setDraggedColumn("");
    setDragOverColumn("");
    if (!sourceKey || sourceKey === target.key) return;
    const baseOrder = orderColumns(columns, columnOrder).map((column) => column.key);
    setColumnOrder(moveColumnKey(baseOrder, sourceKey, target.key));
  }

  function toggleColumnVisibility(column: Column) {
    const visibleCount = columns.length - hiddenColumns.filter((key) => columns.some((item) => item.key === key)).length;
    if (!hiddenColumnSet.has(column.key) && visibleCount <= 1) return;
    setHiddenColumns((current) => (
      current.includes(column.key)
        ? current.filter((key) => key !== column.key)
        : [...current, column.key]
    ));
  }

  function resetColumns() {
    setColumnWidths({});
    setColumnOrder([]);
    setHiddenColumns([]);
  }

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
            onToggle={toggleColumnVisibility}
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
                  onChange={(event) => {
                    const pageKeys = renderedRows.map(rowKey);
                    setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) pageKeys.forEach((key) => next.add(key));
                      else pageKeys.forEach((key) => next.delete(key));
                      return next;
                    });
                  }}
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
                    <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
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

function rowKey(row: ResourceRow) {
  return row.uid || `${row.namespace ?? "_cluster"}-${row.name}`;
}

function compareRows(a: ResourceRow, b: ResourceRow, key: string) {
  if (key === "createdAt") return dateValue(a.createdAt) - dateValue(b.createdAt);
  const left = a[key];
  const right = b[key];
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

function dateValue(value: unknown) {
  return parseTimestamp(value);
}

function orderColumns(columns: Column[], order: string[]) {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const ordered = order.flatMap((key) => {
    const column = byKey.get(key);
    if (!column) return [];
    byKey.delete(key);
    return [column];
  });
  return [...ordered, ...columns.filter((column) => byKey.has(column.key))];
}

function normalizeColumnOrder(order: string[], columns: Column[]) {
  return orderColumns(columns, order).map((column) => column.key);
}

function normalizeHiddenColumns(hidden: string[], columns: Column[]) {
  const known = new Set(columns.map((column) => column.key));
  const normalized = Array.from(new Set(hidden.filter((key) => known.has(key))));
  return normalized.length >= columns.length ? normalized.slice(0, -1) : normalized;
}

function moveColumnKey(order: string[], sourceKey: string, targetKey: string) {
  const current = order.filter((key) => key !== sourceKey);
  const targetIndex = current.indexOf(targetKey);
  if (targetIndex < 0) return order;
  return [...current.slice(0, targetIndex), sourceKey, ...current.slice(targetIndex)];
}

function compactColumnWidth(key: string, narrow: boolean) {
  const widths: Record<string, number> = {
    namespace: narrow ? 94 : 104,
    name: narrow ? 150 : 168,
    phase: 96,
    createdAt: 96,
    node: 116,
    message: narrow ? 180 : 220,
    reason: narrow ? 120 : 140,
    type: 100,
  };
  return widths[key] ?? (narrow ? 96 : 110);
}

function defaultColumnWidth(key: string) {
  const widths: Record<string, number> = {
    namespace: 120,
    name: 180,
    containers: 132,
    message: 260,
    labels: 180,
    createdAt: 110,
    node: 140,
    ports: 140,
    clusterIp: 120,
    reason: 150,
    cpuUsage: 80,
    memoryUsage: 100,
  namespaceResources: 260, };
  return widths[key] ?? 120;
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
