import type { ReactNode } from "react";
import { canonicalPhase } from "../../hooks/useResourceTableState";
import type { ResourceRow } from "../../types";
import { ANNOTATION_COLUMN_KEY } from "../../utils/annotationSort";
import { kubernetesStatusTone } from "../../utils/kubernetesStatusTone";
import { NodeAnnotationsCell, NodeLabelsCell, NodeRolesCell } from "../NodeLabelsCell";
import { rowHealthReason } from "./rowStatus";
import { AgeCell, renderContainerStatus, WorkloadConditions } from "./StatusCells";
import { NamespaceResourceUsage, NodeResourceUsage, PodResourceUsage } from "./UsageCells";

// Which cell a column key renders. Everything the table draws inside a row goes
// through here, so the table itself never has to know about a resource kind.
export function formatCell(row: ResourceRow, key: string, onFilter?: (query: string) => void): ReactNode {
  if (key === "phase") {
    const reason = rowHealthReason(row);
    const phase = canonicalPhase(row);
    return (
      <span className={`phase-value is-${kubernetesStatusTone(row)}`} title={reason || undefined} aria-label={reason ? `${phase}: ${reason}` : phase} tabIndex={reason ? 0 : undefined}>
        {phase}
      </span>
    );
  }
  if (key === "containers") return renderContainerStatus(row);
  if (key === "nodeResources") return <NodeResourceUsage row={row} />;
  if (key === "namespaceResources") return <NamespaceResourceUsage row={row} />;
  if (key === "podResources") return <PodResourceUsage row={row} />;
  if (key === "status" && Array.isArray(row.workloadConditions)) return <WorkloadConditions row={row} />;
  if (key === "labelsText" && Array.isArray(row.nodeLabelItems)) return <NodeLabelsCell row={row} onFilter={onFilter} />;
  if (key === "roles" && row.roles !== undefined) return <NodeRolesCell row={row} />;
  if (key === ANNOTATION_COLUMN_KEY) return <NodeAnnotationsCell row={row} onFilter={onFilter} />;
  if (key !== "createdAt") return String(row[key] ?? "");
  return <AgeCell createdAt={String(row.createdAt ?? "")} />;
}
