import { Search, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { ResourceRow } from "../types";
import { useUiClock } from "../hooks/useUiClock";
import { canonicalPhase, PAGE_SIZE_OPTIONS, rowKey, useResourceTableState, type ResourceTableColumn } from "../hooks/useResourceTableState";
import { formatElapsed } from "../utils/time";
import { ResourceTableColumnsMenu } from "./ResourceTableColumnsMenu";
import { ResourceTablePagination } from "./ResourceTablePagination";
import type { AsyncActionLabels } from "./AsyncActionButton";
import { metricPercent, ResourceUsageBar } from "./ResourceUsageBar";

export type Column = ResourceTableColumn;

interface Props {
  title: string;
  rows: ResourceRow[];
  columns: Column[];
  loading: boolean;
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
  }>;
}

export function ResourceTable({
  title,
  rows,
  columns,
  loading,
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
  } = table;
  const now = useUiClock(
    columns.some((column) => column.key === "createdAt"),
    1000,
  );
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
          />
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
                <input type="checkbox" checked={allPageSelected} disabled={renderedRows.length === 0} onChange={(event) => setPageSelected(event.target.checked)} />
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
                  onDragLeave={() => setDragOverColumn((current) => (current === column.key ? "" : current))}
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
                  <span className="column-resizer" draggable={false} onDragStart={(event) => event.preventDefault()} onMouseDown={(event) => startColumnResize(event, column)} />
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
                  onDoubleClick={() => onPin?.(row)}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <td className="select-col" onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(key)} onChange={() => toggleRow(key)} />
                  </td>
                  {visibleColumns.map((column) => {
                    const cellContent =
                      column.key === "namespace" && row.namespace ? (
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

function formatCell(row: ResourceRow, key: string, now: number): ReactNode {
  if (key === "phase") {
    const reason = rowHealthReason(row);
    const phase = canonicalPhase(row);
    return (
      <span className="phase-value" title={reason || undefined} aria-label={reason ? `${phase}: ${reason}` : phase} tabIndex={reason ? 0 : undefined}>
        {phase}
      </span>
    );
  }
  if (key === "containers") return renderContainerStatus(row);
  if (key === "nodeResources") return <NodeResourceUsage row={row} />;
  if (key === "namespaceResources") return <NamespaceResourceUsage row={row} />;
  if (key === "podResources") return <PodResourceUsage row={row} />;
  if (key === "status" && Array.isArray(row.workloadConditions)) return <WorkloadConditions row={row} />;
  if (key === "labelsText" && Array.isArray(row.nodeLabelItems)) return <NodeLabels row={row} />;
  if (key !== "createdAt") return String(row[key] ?? "");
  const createdAt = String(row.createdAt ?? "");
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return createdAt;
  return formatElapsed(Math.max(0, now - createdMs));
}

function NodeResourceUsage({ row }: { row: ResourceRow }) {
  return (
    <span className="node-resource-usage">
      <ResourceUsageBar label="CPU" tone="cpu" percent={metricPercent(row.cpuUsagePercent)} used={row.cpuUsage} free={row.cpuAvailable} allocatable={row.cpuAllocatable} />
      <ResourceUsageBar label="RAM" tone="memory" percent={metricPercent(row.memoryUsagePercent)} used={row.memoryUsage} free={row.memoryAvailable} allocatable={row.memoryAllocatable} />
      <ResourceUsageBar
        label="Disk"
        tone="disk"
        percent={metricPercent(row.diskUsagePercent)}
        used={row.diskUsage}
        free={row.diskAvailable}
        allocatable={row.diskObservedCapacity}
        denominatorLabel="capacity"
        unavailableLabel={row.diskLoading ? "…" : "N/A"}
      />
    </span>
  );
}

function NamespaceResourceUsage({ row }: { row: ResourceRow }) {
  const cpuPercent = metricPercent(row.namespaceCpuUsagePercent);
  const memoryPercent = metricPercent(row.namespaceMemoryUsagePercent);
  const storagePercent = metricPercent(row.namespaceStorageUsagePercent);
  return (
    <span className="node-resource-usage">
      <ResourceUsageBar
        label="CPU"
        tone="cpu"
        percent={cpuPercent}
        used={row.namespaceCpuUsed}
        denominator={row.namespaceCpuQuota}
        denominatorLabel="quota"
        unavailableLabel={row.namespaceCpuQuota === "no quota" ? "No quota" : "N/A"}
      />
      <ResourceUsageBar
        label="RAM"
        tone="memory"
        percent={memoryPercent}
        used={row.namespaceMemoryUsed}
        denominator={row.namespaceMemoryQuota}
        denominatorLabel="quota"
        unavailableLabel={row.namespaceMemoryQuota === "no quota" ? "No quota" : "N/A"}
      />
      <ResourceUsageBar
        label="Storage"
        tone="disk"
        percent={storagePercent}
        used={row.namespaceStorageUsed}
        denominator={row.namespaceStorageQuota}
        denominatorLabel="quota"
        unavailableLabel={row.namespaceStorageQuota === "no quota" ? "No quota" : "N/A"}
      />
    </span>
  );
}

function PodResourceUsage({ row }: { row: ResourceRow }) {
  const cpuLimit = formatCpuValue(row.podCpuLimitValue);
  const memoryLimit = formatByteValue(row.podMemoryLimitValue);
  return (
    <span className="node-resource-usage">
      <ResourceUsageBar
        label="CPU"
        tone="cpu"
        percent={metricPercent(row.podCpuUsagePercent)}
        used={row.cpuUsage}
        denominator={cpuLimit}
        denominatorLabel="limit"
        unavailableLabel={row.cpuUsage ? "No limit" : "N/A"}
      />
      <ResourceUsageBar
        label="RAM"
        tone="memory"
        percent={metricPercent(row.podMemoryUsagePercent)}
        used={row.memoryUsage}
        denominator={memoryLimit}
        denominatorLabel="limit"
        unavailableLabel={row.memoryUsage ? "No limit" : "N/A"}
      />
    </span>
  );
}

function formatCpuValue(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return parsed % 1000 === 0 ? String(parsed / 1000) : `${Math.round(parsed * 100) / 100}m`;
}

function formatByteValue(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  for (const [label, divisor] of [
    ["GiB", 1024 ** 3],
    ["MiB", 1024 ** 2],
    ["KiB", 1024],
  ] as const) {
    if (parsed >= divisor) return `${Math.round((parsed / divisor) * 100) / 100} ${label}`;
  }
  return `${parsed} B`;
}

type WorkloadCondition = { label?: unknown; reason?: unknown; message?: unknown; tone?: unknown };

function WorkloadConditions({ row }: { row: ResourceRow }) {
  const conditions = (row.workloadConditions as WorkloadCondition[]).filter((condition) => condition && condition.label);
  const replicaSummary = `Ready ${String(row.ready ?? "—")} · Updated ${String(row.updated ?? "—")} · Available ${String(row.available ?? "—")}`;
  const full = conditions
    .map((condition) => `${String(condition.label)}${condition.reason ? `: ${String(condition.reason)}` : ""}${condition.message ? ` — ${String(condition.message)}` : ""}`)
    .join("; ");
  return (
    <span className="workload-condition-list" aria-label={`${full}. ${replicaSummary}`}>
      {conditions.map((condition) => (
        <span
          className={`workload-condition is-${String(condition.tone || "neutral")}`}
          title={`${String(condition.reason || condition.label)}${condition.message ? `: ${String(condition.message)}` : ""} · ${replicaSummary}`}
          key={String(condition.label)}
        >
          {String(condition.label)}
        </span>
      ))}
    </span>
  );
}

type NodeLabel = { key?: unknown; label?: unknown; value?: unknown; full?: unknown };

function NodeLabels({ row }: { row: ResourceRow }) {
  const labels = (row.nodeLabelItems as NodeLabel[]).filter(Boolean);
  const visible = labels.slice(0, 3);
  const full = labels
    .map((label) => String(label.full || label.key || ""))
    .filter(Boolean)
    .join(", ");
  return (
    <span className="node-label-list" aria-label={full || "No labels"}>
      {visible.map((label) => (
        <span className="node-label-chip" title={String(label.full || "")} key={String(label.key)}>
          {String(label.label || label.key)}
          {label.value ? `: ${String(label.value)}` : ""}
        </span>
      ))}
      {labels.length > visible.length ? (
        <span className="node-label-more" title={full} tabIndex={0}>
          +{labels.length - visible.length}
        </span>
      ) : null}
    </span>
  );
}

function renderContainerStatus(row: ResourceRow): ReactNode {
  const containers = normalizeContainerStatusItems(row);
  if (containers.length === 0) return "";

  return (
    <span className="container-status-cubes" aria-label={containers.map((container) => container.title).join("; ")}>
      {containers.map((container) => (
        <span key={container.name} className={`container-status-cube is-${container.tone}`} title={container.title} aria-label={container.title} />
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
      const details = [ready ? "ready" : "not ready", state && state !== "unknown" ? state : "", reason, Number.isFinite(restartCount) && restartCount > 0 ? `${restartCount} restarts` : ""]
        .filter(Boolean)
        .join(", ");
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
