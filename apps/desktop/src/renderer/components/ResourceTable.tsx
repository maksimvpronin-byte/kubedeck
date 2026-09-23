import { Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ResourceRow } from "../types";
import { PAGE_SIZE_OPTIONS, rowKey, useResourceTableState, type ResourceTableColumn } from "../hooks/useResourceTableState";
import { columnSortMetrics, sortKeyBelongsToColumn } from "../utils/resourceTableSortMetrics";
import { ANNOTATION_COLUMN_KEY, annotationSortMetrics } from "../utils/annotationSort";
import { ResourceTableRow, type ResourceTableRowHandlers } from "./resourceTable/ResourceTableRow";
import { DEFAULT_VIRTUAL_ROW_HEIGHT, nextRowHeight, virtualRowWindow } from "../utils/virtualRows";
import { measureColumnWidths } from "../utils/fitColumns";
import { ResourceTableColumnsMenu } from "./ResourceTableColumnsMenu";
import { ResourceTableSortMenu } from "./ResourceTableSortMenu";
import { ResourceTablePagination } from "./ResourceTablePagination";
import { SortDirectionArrow } from "./SortDirectionArrow";
import type { AsyncActionLabels } from "./AsyncActionButton";

export type Column = ResourceTableColumn;

interface Props {
  title: string;
  rows: ResourceRow[];
  columns: Column[];
  loading: boolean;
  // Why the last load of this table failed, if it did. Without it an
  // unreadable list and an empty one look the same.
  loadError?: { message: string; staleSince?: number } | null;
  onRefresh: () => void | boolean | Promise<void | boolean>;
  onOpen?: (row: ResourceRow) => void;
  onPin?: (row: ResourceRow) => void;
  onNamespaceClick?: (namespace: string) => void;
  onBulkDelete?: (rows: ResourceRow[]) => void;
  onBulkCordon?: (rows: ResourceRow[]) => void;
  onBulkUncordon?: (rows: ResourceRow[]) => void;
  onBulkDrain?: (rows: ResourceRow[]) => void;
  selectedRow?: ResourceRow | null;
  onVisibleNodeRows?: (rows: ResourceRow[]) => void;
  filterLabel: string;
  refreshLabel: string;
  refreshActionLabels?: AsyncActionLabels;
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
    fillWidth: string;
    fitColumns: string;
    fitColumnsHint: string;
    sortBy: string;
    loadingTitle: string;
    updating: string;
    loadFailedTitle: string;
    retry: string;
    staleSince: string;
    staleUnknown: string;
  }>;
}

export function ResourceTable({
  title,
  rows,
  columns,
  loading,
  loadError,
  onRefresh,
  onOpen,
  onPin,
  onNamespaceClick,
  onBulkDelete,
  onBulkCordon,
  onBulkUncordon,
  onBulkDrain,
  selectedRow,
  onVisibleNodeRows,
  filterLabel,
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
    fillWidth: labels?.fillWidth ?? "Stretch to the window width",
    fitColumns: labels?.fitColumns ?? "Fit columns to content",
    fitColumnsHint: labels?.fitColumnsHint ?? "Each column takes the width of its longest value on screen. Double-click a column border to fit just that one.",
    sortBy: labels?.sortBy ?? "Sort by",
    loadingTitle: labels?.loadingTitle ?? "Loading...",
    updating: labels?.updating ?? "updating...",
    loadFailedTitle: labels?.loadFailedTitle ?? "The list could not be loaded",
    retry: labels?.retry ?? "Retry",
    staleSince: labels?.staleSince ?? "Could not refresh. Showing the list from {time}.",
    staleUnknown: labels?.staleUnknown ?? "Could not refresh. The list shown may be out of date.",
  };

  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const table = useResourceTableState(rows, columns, stateKey);
  const {
    tableRef,
    query,
    setQuery,
    sortKey,
    sortDirection,
    selected,
    pageSize,
    setPageSize,
    setPageIndex,
    orderedColumns,
    hiddenColumns,
    visibleColumns,
    visibleRows,
    renderedRows,
    selectedRows,
    selectedPageRows,
    totalPages,
    safePageIndex,
    pageStart,
    draggedColumn,
    setDraggedColumn,
    dragOverColumn,
    setDragOverColumn,
    widthFor,
    changeSort,
    toggleRow,
    setPageSelected,
    startColumnResize,
    startColumnDrag,
    dropColumn,
    toggleColumn,
    resetColumns,
    fillWidth,
    setFillWidth,
    applyFittedWidths,
  } = table;
  const tableElementRef = useRef<HTMLTableElement | null>(null);
  const fitColumns = (only?: string) => {
    const element = tableElementRef.current;
    if (!element) return;
    applyFittedWidths(
      measureColumnWidths(
        element,
        visibleColumns.map((column) => column.key),
        only,
      ),
    );
  };
  // The table is handed fresh arrow functions on every render of the
  // application; a row that read them directly could never be skipped. They go
  // through a ref instead, so the handlers a row sees never change identity
  // while the callbacks behind them stay current.
  const callbacksRef = useRef({ onOpen, onPin, onNamespaceClick, toggleRow, setQuery });
  callbacksRef.current = { onOpen, onPin, onNamespaceClick, toggleRow, setQuery };
  const rowHandlers = useMemo<ResourceTableRowHandlers>(
    () => ({
      open: (row) => callbacksRef.current.onOpen?.(row),
      pin: (row) => callbacksRef.current.onPin?.(row),
      openNamespace: (namespace) => callbacksRef.current.onNamespaceClick?.(namespace),
      toggle: (key) => callbacksRef.current.toggleRow(key),
      filter: (query) => callbacksRef.current.setQuery(query),
    }),
    [],
  );

  // A page can be 2000 rows of a dozen cells. Past the threshold only the rows
  // near the viewport are in the DOM; the rest are two spacer rows holding the
  // scroll height, so the scrollbar and the keyboard behave as they always did.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const [rowHeight, setRowHeight] = useState(DEFAULT_VIRTUAL_ROW_HEIGHT);
  const frameRef = useRef<number | null>(null);

  const readViewport = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setViewport((current) => (current.top === element.scrollTop && current.height === element.clientHeight ? current : { top: element.scrollTop, height: element.clientHeight }));
  }, []);

  // One read per frame: a wheel gesture fires scroll events far faster than
  // the table can usefully re-render.
  const onScroll = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      readViewport();
    });
  }, [readViewport]);

  useEffect(() => {
    readViewport();
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => readViewport());
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [readViewport]);

  const rowWindow = virtualRowWindow({ rowCount: renderedRows.length, rowHeight, scrollTop: viewport.top, viewportHeight: viewport.height });
  const windowRows = rowWindow.active ? renderedRows.slice(rowWindow.start, rowWindow.end) : renderedRows;

  // Rows are measured rather than assumed: a nodes table with two lines of
  // usage in a cell is taller than a pods table.
  useLayoutEffect(() => {
    const element = scrollRef.current?.querySelector("tbody tr:not(.virtual-spacer)");
    if (!element) return;
    const measured = (element as HTMLElement).getBoundingClientRect().height;
    setRowHeight((current) => nextRowHeight(current, measured));
  }, [windowRows.length, visibleColumns]);

  const tableWidth = 38 + visibleColumns.reduce((sum, column) => sum + widthFor(column), 0);
  const annotationMetrics = useMemo(() => annotationSortMetrics(rows), [rows]);
  const metricsFor = (columnKey: string) => (columnKey === ANNOTATION_COLUMN_KEY ? annotationMetrics : columnSortMetrics(columnKey));
  const selectedRowKey = selectedRow ? rowKey(selectedRow) : "";
  const hasFilter = query.trim().length > 0;
  const filteredEmpty = rows.length > 0 && hasFilter && visibleRows.length === 0;
  // Four different answers, and the table used to give one of them for all:
  // still loading, could not load, nothing there, nothing matches the filter.
  const showLoadingState = loading && rows.length === 0;
  const showErrorState = !loading && Boolean(loadError) && rows.length === 0;
  const showEmptyState = !loading && !showErrorState && renderedRows.length === 0;
  const refreshing = loading && rows.length > 0;
  // A failed refresh that kept the last good rows says so, and how old they are.
  const showStaleNotice = !loading && Boolean(loadError) && rows.length > 0;
  const staleText =
    loadError?.staleSince !== undefined ? ui.staleSince.replace("{time}", new Date(loadError.staleSince).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) : ui.staleUnknown;
  const emptyTitle = filteredEmpty ? ui.emptyFilteredTitle : ui.emptyTitle;
  const emptyText = filteredEmpty ? ui.emptyFilteredText : ui.emptyText;

  const allPageSelected = renderedRows.length > 0 && selectedPageRows.length === renderedRows.length;
  const nodeActionsVisible = selectedRows.length > 0 && Boolean(onBulkCordon || onBulkUncordon || onBulkDrain);
  const controlsDisabled = loading && rows.length === 0;
  const nodeUsageVisible = visibleColumns.some((column) => column.key === "nodeResources");

  useEffect(() => {
    if (nodeUsageVisible) onVisibleNodeRows?.(renderedRows);
  }, [nodeUsageVisible, onVisibleNodeRows, renderedRows]);

  return (
    <section className="resource-table-panel" ref={tableRef}>
      <div className="resource-table-header">
        <div>
          <h2>{title}</h2>
          <div className="muted small">
            {visibleRows.length} {ui.shownOf} {rows.length}
            {visibleRows.length > 0 ? `, ${ui.page} ${safePageIndex + 1}/${totalPages}` : ""}
            {refreshing ? (
              <span className="resource-table-updating" role="status">
                {" · "}
                {ui.updating}
              </span>
            ) : null}
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
          <div className="table-view-controls">
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
            <ResourceTableColumnsMenu
              columns={columns}
              orderedColumns={orderedColumns}
              hiddenColumns={hiddenColumns}
              label={ui.columns}
              resetLabel={ui.resetColumns}
              onToggle={toggleColumn}
              onReset={resetColumns}
              fillWidth={fillWidth}
              fillWidthLabel={ui.fillWidth}
              fitLabel={ui.fitColumns}
              fitHint={ui.fitColumnsHint}
              onFillWidthChange={setFillWidth}
              onFit={() => fitColumns()}
            />
          </div>
        </div>
      </div>

      {showStaleNotice ? (
        <div className="resource-table-stale" role="alert">
          <span>
            <strong>{staleText}</strong> {loadError?.message}
          </span>
          <button className="secondary-btn" type="button" onClick={() => void onRefresh()}>
            {ui.retry}
          </button>
        </div>
      ) : null}

      <div className="table-scroll" ref={scrollRef} onScroll={onScroll}>
        <table ref={tableElementRef} className={`resource-table${fillWidth ? " is-fill" : ""}`} style={{ width: tableWidth }}>
          <colgroup>
            <col style={{ width: 38 }} />
            {visibleColumns.map((column) => (
              <col key={column.key} style={{ width: widthFor(column) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="select-col">
                <input type="checkbox" checked={allPageSelected} disabled={renderedRows.length === 0} onChange={(event) => setPageSelected(event.target.checked)} />
              </th>
              {visibleColumns.map((column) => (
                <th
                  key={column.key}
                  draggable
                  // The direction is drawn as an arrow, so the cell carries it
                  // for anyone who cannot see the arrow.
                  aria-sort={sortKeyBelongsToColumn(column.key, sortKey) ? (sortDirection === 1 ? "ascending" : "descending") : undefined}
                  className={`${draggedColumn === column.key ? "dragging-column" : ""} ${dragOverColumn === column.key && draggedColumn !== column.key ? "drag-over-column" : ""}`.trim()}
                  onDragStart={(event) => startColumnDrag(event, column)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverColumn(column.key);
                  }}
                  onDragLeave={() => setDragOverColumn((current) => (current === column.key ? "" : current))}
                  onDrop={(event) => dropColumn(event, column)}
                  onDragEnd={() => {
                    setDraggedColumn("");
                    setDragOverColumn("");
                  }}
                >
                  {metricsFor(column.key).length ? (
                    <ResourceTableSortMenu label={column.label} metrics={metricsFor(column.key)} sortKey={sortKey} sortDirection={sortDirection} sortByLabel={ui.sortBy} onSelect={changeSort} />
                  ) : (
                    <button type="button" className="table-sort-button" draggable={false} onClick={() => changeSort(column.key)}>
                      <span className="table-sort-label">{column.label}</span>
                      {sortKey === column.key ? <SortDirectionArrow direction={sortDirection} /> : null}
                    </button>
                  )}
                  <span
                    className="column-resizer"
                    draggable={false}
                    title={ui.fitColumnsHint}
                    onDragStart={(event) => event.preventDefault()}
                    onMouseDown={(event) => startColumnResize(event, column)}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      fitColumns(column.key);
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowWindow.paddingTop > 0 ? <tr className="virtual-spacer" aria-hidden="true" style={{ height: rowWindow.paddingTop }} /> : null}
            {windowRows.map((row) => {
              const key = rowKey(row);
              return <ResourceTableRow key={key} rowKey={key} row={row} columns={visibleColumns} selected={selected.has(key)} active={selectedRowKey === key} handlers={rowHandlers} />;
            })}
            {rowWindow.paddingBottom > 0 ? <tr className="virtual-spacer" aria-hidden="true" style={{ height: rowWindow.paddingBottom }} /> : null}
          </tbody>
        </table>
      </div>

      {showLoadingState ? (
        <div className="empty-state" role="status">
          <h3>{ui.loadingTitle}</h3>
        </div>
      ) : null}

      {showErrorState ? (
        <div className="empty-state resource-table-load-error" role="alert">
          <h3>{ui.loadFailedTitle}</h3>
          <p>{loadError?.message}</p>
          <button className="secondary-btn" type="button" onClick={() => void onRefresh()}>
            {ui.retry}
          </button>
        </div>
      ) : null}

      {showEmptyState ? (
        <div className="empty-state">
          <h3>{emptyTitle}</h3>
          <p>{emptyText}</p>
          {filteredEmpty ? (
            <button className="secondary-btn" type="button" onClick={() => setQuery("")}>
              {ui.clearFilter}
            </button>
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
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPageIndex(0);
        }}
        onPageChange={setPageIndex}
      />
    </section>
  );
}
