import { RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { ResourceRow } from "../types";
import { loadUiState, saveUiState } from "../uiState";
import { useUiClock } from "../hooks/useUiClock";
import { formatElapsed, parseTimestamp } from "../utils/time";

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
  };

  const tableRef = useRef<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(columns[0]?.key ?? "name");
  const [sortDirection, setSortDirection] = useState<1 | -1>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => loadUiState().columnWidths?.[stateKey] ?? {});
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

  const visibleColumns = useMemo(() => {
    if (!compactTable) return columns;
    const hidden = new Set(COMPACT_HIDDEN_COLUMNS);
    if (narrowTable) NARROW_HIDDEN_COLUMNS.forEach((key) => hidden.add(key));
    const filtered = columns.filter((column) => !hidden.has(column.key));
    return filtered.length >= Math.min(3, columns.length) ? filtered : columns;
  }, [columns, compactTable, narrowTable]);

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
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [columnWidths, stateKey]);

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
          <div className="table-filter">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={filterLabel} />
          </div>
          <button className="secondary-btn" type="button" onClick={onRefresh} disabled={controlsDisabled}>
            <RefreshCw size={14} /> {refreshLabel}
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="resource-table">
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
                <th key={column.key} style={{ width: widthFor(column) }}>
                  <button type="button" className="table-sort-button" onClick={() => changeSort(column.key)}>
                    <span className="table-sort-label">{column.label}</span>
                    {sortKey === column.key ? (
                      <span className="table-sort-indicator" aria-hidden="true">
                        {sortDirection === 1 ? "ASC" : "DESC"}
                      </span>
                    ) : null}
                  </button>
                  <span className="column-resizer" onMouseDown={(event) => startColumnResize(event, column)} />
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

      <div className="table-footer">
        <span>
          {ui.rows} {visibleRows.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + renderedRows.length, visibleRows.length)} {ui.of} {visibleRows.length}
        </span>
        <label>
          {ui.pageSize}{" "}
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPageIndex(0); }}>
            {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <div className="pagination-actions">
          <button className="secondary-btn" type="button" onClick={() => setPageIndex(0)} disabled={safePageIndex === 0}>{ui.first}</button>
          <button className="secondary-btn" type="button" onClick={() => setPageIndex((current) => Math.max(0, current - 1))} disabled={safePageIndex === 0}>{ui.prev}</button>
          <span>{safePageIndex + 1} / {totalPages}</span>
          <button className="secondary-btn" type="button" onClick={() => setPageIndex((current) => Math.min(totalPages - 1, current + 1))} disabled={safePageIndex >= totalPages - 1}>{ui.next}</button>
          <button className="secondary-btn" type="button" onClick={() => setPageIndex(totalPages - 1)} disabled={safePageIndex >= totalPages - 1}>{ui.last}</button>
        </div>
      </div>
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
    message: 260,
    labels: 180,
    createdAt: 110,
    node: 140,
    ports: 140,
    clusterIp: 120,
    reason: 150,
    cpuUsage: 80,
    memoryUsage: 100,
  };
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
  if (key !== "createdAt") return String(row[key] ?? "");
  const createdAt = String(row.createdAt ?? "");
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return createdAt;
  return formatElapsed(Math.max(0, now - createdMs));
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