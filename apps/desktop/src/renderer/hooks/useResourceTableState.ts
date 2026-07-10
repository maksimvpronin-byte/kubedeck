import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import type { ResourceRow } from "../types";
import { loadUiState, saveUiState } from "../uiState";
import { parseTimestamp } from "../utils/time";

export interface ResourceTableColumn { key: string; label: string }

export const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 1000];
const DEFAULT_PAGE_SIZE = 200;
const COMPACT_TABLE_WIDTH = 920;
const NARROW_TABLE_WIDTH = 760;
const COMPACT_HIDDEN_COLUMNS = new Set(["ready", "restarts", "cpuUsage", "memoryUsage", "ports", "clusterIp", "externalIp", "labels", "conditions", "reason", "statusMessage", "containerProblems"]);
const NARROW_HIDDEN_COLUMNS = new Set(["node", "storageClass", "accessModes", "capacity"]);

export function rowKey(row: ResourceRow) {
  return row.uid || `${row.namespace ?? "_cluster"}-${row.name}`;
}

export function orderColumns(columns: ResourceTableColumn[], order: string[]) {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const ordered = order.flatMap((key) => {
    const column = byKey.get(key);
    if (!column) return [];
    byKey.delete(key);
    return [column];
  });
  return [...ordered, ...columns.filter((column) => byKey.has(column.key))];
}

export function normalizeColumnOrder(order: string[], columns: ResourceTableColumn[]) {
  return orderColumns(columns, order).map((column) => column.key);
}

export function normalizeHiddenColumns(hidden: string[], columns: ResourceTableColumn[]) {
  const known = new Set(columns.map((column) => column.key));
  const normalized = Array.from(new Set(hidden.filter((key) => known.has(key))));
  return normalized.length >= columns.length ? normalized.slice(0, -1) : normalized;
}

export function moveColumnKey(order: string[], sourceKey: string, targetKey: string) {
  const current = order.filter((key) => key !== sourceKey);
  const targetIndex = current.indexOf(targetKey);
  if (targetIndex < 0) return order;
  return [...current.slice(0, targetIndex), sourceKey, ...current.slice(targetIndex)];
}

function compareRows(left: ResourceRow, right: ResourceRow, key: string) {
  if (key === "createdAt") return parseTimestamp(left.createdAt) - parseTimestamp(right.createdAt);
  const leftValue = left[key];
  const rightValue = right[key];
  if (typeof leftValue === "number" && typeof rightValue === "number") return leftValue - rightValue;
  return String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

function compactColumnWidth(key: string, narrow: boolean) {
  const widths: Record<string, number> = { namespace: narrow ? 94 : 104, name: narrow ? 150 : 168, phase: 96, createdAt: 96, node: 116, message: narrow ? 180 : 220, reason: narrow ? 120 : 140, type: 100 };
  return widths[key] ?? (narrow ? 96 : 110);
}

function defaultColumnWidth(key: string) {
  const widths: Record<string, number> = { namespace: 120, name: 180, containers: 132, message: 260, labels: 180, createdAt: 110, node: 140, ports: 140, clusterIp: 120, reason: 150, cpuUsage: 80, memoryUsage: 100, namespaceResources: 260 };
  return widths[key] ?? 120;
}

export function useResourceTableState(rows: ResourceRow[], columns: ResourceTableColumn[], stateKey: string) {
  const tableRef = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    const element = tableRef.current;
    if (!element) return undefined;
    const update = () => setContainerWidth(element.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver((entries) => { if (entries[0]) setContainerWidth(entries[0].contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const compact = containerWidth > 0 && containerWidth < COMPACT_TABLE_WIDTH;
  const narrow = containerWidth > 0 && containerWidth < NARROW_TABLE_WIDTH;
  const orderedColumns = useMemo(() => orderColumns(columns, columnOrder), [columns, columnOrder]);
  const hiddenColumnSet = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);
  const userVisibleColumns = useMemo(() => {
    const filtered = orderedColumns.filter((column) => !hiddenColumnSet.has(column.key));
    return filtered.length ? filtered : orderedColumns.slice(0, 1);
  }, [orderedColumns, hiddenColumnSet]);
  const visibleColumns = useMemo(() => {
    if (!compact) return userVisibleColumns;
    const hidden = new Set(COMPACT_HIDDEN_COLUMNS);
    if (narrow) NARROW_HIDDEN_COLUMNS.forEach((key) => hidden.add(key));
    const filtered = userVisibleColumns.filter((column) => !hidden.has(column.key));
    return filtered.length >= Math.min(3, userVisibleColumns.length) ? filtered : userVisibleColumns;
  }, [userVisibleColumns, compact, narrow]);

  useEffect(() => {
    if (visibleColumns.length && !visibleColumns.some((column) => column.key === sortKey)) setSortKey(visibleColumns.find((column) => column.key === "name")?.key ?? visibleColumns[0].key);
  }, [visibleColumns, sortKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const state = loadUiState();
      saveUiState({ ...state, columnWidths: { ...(state.columnWidths ?? {}), [stateKey]: columnWidths }, columnOrders: { ...(state.columnOrders ?? {}), [stateKey]: normalizeColumnOrder(columnOrder, columns) }, hiddenColumns: { ...(state.hiddenColumns ?? {}), [stateKey]: normalizeHiddenColumns(hiddenColumns, columns) } });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [columnWidths, columnOrder, hiddenColumns, columns, stateKey]);
  useEffect(() => setSelected((current) => new Set(Array.from(current).filter((key) => new Set(rows.map(rowKey)).has(key)))), [rows]);

  const visibleRows = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const filtered = lower ? rows.filter((row) => columns.some((column) => String(row[column.key] ?? "").toLowerCase().includes(lower))) : rows;
    return [...filtered].sort((left, right) => compareRows(left, right, sortKey) * sortDirection);
  }, [query, rows, sortKey, sortDirection, columns]);
  useEffect(() => setPageIndex(0), [query, sortKey, sortDirection, pageSize, stateKey]);
  useEffect(() => setPageIndex((current) => Math.min(current, Math.max(0, Math.ceil(visibleRows.length / pageSize) - 1))), [visibleRows.length, pageSize]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pageStart = safePageIndex * pageSize;
  const renderedRows = visibleRows.slice(pageStart, pageStart + pageSize);
  const selectedRows = visibleRows.filter((row) => selected.has(rowKey(row)));
  const selectedPageRows = renderedRows.filter((row) => selected.has(rowKey(row)));

  const widthFor = (column: ResourceTableColumn) => {
    const preferred = columnWidths[column.key] ?? defaultColumnWidth(column.key);
    return compact ? Math.min(preferred, compactColumnWidth(column.key, narrow)) : preferred;
  };
  const changeSort = (key: string) => {
    if (key === sortKey) setSortDirection((current) => current === 1 ? -1 : 1);
    else { setSortKey(key); setSortDirection(1); }
  };
  const toggleRow = (key: string) => setSelected((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const setPageSelected = (checked: boolean) => setSelected((current) => { const next = new Set(current); renderedRows.map(rowKey).forEach((key) => checked ? next.add(key) : next.delete(key)); return next; });
  const startColumnResize = (event: ReactMouseEvent, column: ResourceTableColumn) => {
    event.preventDefault(); event.stopPropagation();
    const startX = event.clientX; const startWidth = widthFor(column);
    const move = (moveEvent: MouseEvent) => setColumnWidths((current) => ({ ...current, [column.key]: Math.max(48, startWidth + moveEvent.clientX - startX) }));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up, { once: true });
  };
  const startColumnDrag = (event: ReactDragEvent<HTMLTableCellElement>, column: ResourceTableColumn) => { setDraggedColumn(column.key); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", column.key); };
  const dropColumn = (event: ReactDragEvent<HTMLTableCellElement>, target: ResourceTableColumn) => {
    event.preventDefault(); const source = event.dataTransfer.getData("text/plain") || draggedColumn;
    setDraggedColumn(""); setDragOverColumn("");
    if (source && source !== target.key) setColumnOrder(moveColumnKey(orderColumns(columns, columnOrder).map((column) => column.key), source, target.key));
  };
  const toggleColumn = (column: ResourceTableColumn) => {
    const visibleCount = columns.length - hiddenColumns.filter((key) => columns.some((item) => item.key === key)).length;
    if (!hiddenColumnSet.has(column.key) && visibleCount <= 1) return;
    setHiddenColumns((current) => current.includes(column.key) ? current.filter((key) => key !== column.key) : [...current, column.key]);
  };
  const resetColumns = () => { setColumnWidths({}); setColumnOrder([]); setHiddenColumns([]); };

  return {
    tableRef, query, setQuery, sortKey, sortDirection, selected, setSelected, pageSize, setPageSize,
    setPageIndex, columnWidths, orderedColumns, hiddenColumns, visibleColumns, visibleRows, renderedRows,
    selectedRows, selectedPageRows, totalPages, safePageIndex, pageStart, draggedColumn, setDraggedColumn,
    dragOverColumn, setDragOverColumn, widthFor, changeSort, toggleRow, setPageSelected, startColumnResize,
    startColumnDrag, dropColumn, toggleColumn, resetColumns,
  };
}
