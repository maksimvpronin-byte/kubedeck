import type { ResourceRow } from "../types";
import { formatAge } from "../utils/time";

interface ResourceSummaryProps {
  row: ResourceRow;
  resource: string;
  now: number;
}

export function ResourceSummary({ row, resource, now }: ResourceSummaryProps) {
  return (
    <>
      <ResourceOverview row={row} resource={resource} now={now} />
      <dl className="summary-grid">
        {Object.entries(row).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function ResourceOverview({ row, resource, now }: ResourceSummaryProps) {
  const facts = keyFacts(row, resource);
  return (
    <section className="resource-overview">
      <div>
        <span>Kind</span>
        <strong>{String(row.kind || singularResource(resource))}</strong>
      </div>
      <div>
        <span>Namespace</span>
        <strong>{String(row.namespace || "_cluster")}</strong>
      </div>
      <div>
        <span>Status</span>
        <strong>{primaryStatus(row)}</strong>
      </div>
      <div>
        <span>Age</span>
        <strong title={String(row.createdAt || "")}>{formatAge(row.createdAt, now)}</strong>
      </div>
      {facts.map((fact) => (
        <div key={fact.label}>
          <span>{fact.label}</span>
          <strong>{fact.value}</strong>
        </div>
      ))}
    </section>
  );
}

function keyFacts(row: ResourceRow, resource: string) {
  const candidates: Array<[string, unknown]> = [
    ["Ready", row.ready],
    ["Node", row.node],
    ["Restarts", row.restarts],
    ["Type", row.type],
    ["API Version", row.apiVersion],
    ["Group", row.group],
    ["Scope", row.scope],
    ["Versions", row.versions],
    ["Plural", row.plural],
    ["Cluster IP", row.clusterIp],
    ["Ports", row.ports],
    ["Replicas", row.replicas ?? row.available ?? row.readyReplicas],
    ["Storage", row.capacity ?? row.storage],
    ["Class", row.storageClassName ?? row.storageClass],
  ];
  return candidates
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    .slice(0, resource === "pods" ? 4 : 3)
    .map(([label, value]) => ({ label, value: String(value) }));
}

function primaryStatus(row: ResourceRow) {
  return String(row.phase || row.status || row.type || row.reason || "unknown");
}

function singularResource(resource: string) {
  const normalized = resource.split(".")[0];
  if (normalized.endsWith("ies")) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith("ses")) return normalized.slice(0, -2);
  if (normalized.endsWith("s")) return normalized.slice(0, -1);
  return normalized;
}
