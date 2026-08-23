import type { ResourceRow } from "../../types";
import { metricPercent, ResourceUsageBar } from "../ResourceUsageBar";
import { formatByteValue, formatCpuValue, unclampedPercent } from "./rowStatus";

export function NodeResourceUsage({ row }: { row: ResourceRow }) {
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

export function NamespaceResourceUsage({ row }: { row: ResourceRow }) {
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

export function PodResourceUsage({ row }: { row: ResourceRow }) {
  return (
    <span className="node-resource-usage">
      <PodUsageBar
        label="CPU"
        tone="cpu"
        used={row.cpuUsage}
        limitPercent={row.podCpuUsagePercent}
        requestPercent={row.podCpuRequestPercent}
        limit={formatCpuValue(row.podCpuLimitValue)}
        request={formatCpuValue(row.podCpuRequestValue)}
      />
      <PodUsageBar
        label="RAM"
        tone="memory"
        used={row.memoryUsage}
        limitPercent={row.podMemoryUsagePercent}
        requestPercent={row.podMemoryRequestPercent}
        limit={formatByteValue(row.podMemoryLimitValue)}
        request={formatByteValue(row.podMemoryRequestValue)}
      />
    </span>
  );
}

// CPU limits are omitted far more often than memory limits, so a limit-only bar
// left most pods with no visible CPU reading at all. The request is the next
// meaningful baseline, and when neither is set the raw usage is shown instead of
// an empty bar — the number is what the reader came for.
function PodUsageBar({
  label,
  tone,
  used,
  limitPercent,
  requestPercent,
  limit,
  request,
}: {
  label: string;
  tone: string;
  used: unknown;
  limitPercent: unknown;
  requestPercent: unknown;
  limit: string;
  request: string;
}) {
  const usedText = String(used ?? "");
  const againstLimit = metricPercent(limitPercent);
  if (againstLimit !== null) {
    return <ResourceUsageBar label={label} tone={tone} percent={againstLimit} used={used} denominator={limit} denominatorLabel="limit" />;
  }

  const againstRequest = unclampedPercent(requestPercent);
  if (againstRequest !== null) {
    return (
      <ResourceUsageBar
        label={label}
        tone={tone}
        variant="soft"
        percent={againstRequest}
        used={used}
        denominator={request}
        denominatorLabel="request"
        details={`${label}: ${usedText || "—"} used · ${request} request · ${againstRequest}% of request · no limit set`}
      />
    );
  }

  return (
    <ResourceUsageBar
      label={label}
      tone={tone}
      percent={null}
      used={used}
      unavailableLabel={usedText || "N/A"}
      details={usedText ? `${label}: ${usedText} used · no limit or request set` : `${label}: metrics N/A`}
    />
  );
}
