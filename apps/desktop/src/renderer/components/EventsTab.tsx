import type { ErrorInfo, ResourceRow } from "../types";
import { formatAgeAgo } from "../utils/time";
import { ErrorPanel } from "./ErrorPanel";

type EventTypeFilter = "all" | "warning" | "normal";
type EventSortOrder = "newest" | "oldest";

interface EventsTabProps {
  events: ResourceRow[];
  loading: boolean;
  error: ErrorInfo | null;
  copyLabel: string;
  typeFilter: EventTypeFilter;
  onTypeFilterChange: (value: EventTypeFilter) => void;
  sort: EventSortOrder;
  onSortChange: (value: EventSortOrder) => void;
  onOpenRelated: (resource: string, namespace: string, name: string) => void;
  now: number;
}

export function EventsTab({
  events,
  loading,
  error,
  copyLabel,
  typeFilter,
  onTypeFilterChange,
  sort,
  onSortChange,
  onOpenRelated,
  now,
}: EventsTabProps) {
  const filteredEvents = events
    .filter((event) => {
      if (typeFilter === "all") return true;
      return readEventString(event, "type").toLowerCase() === typeFilter;
    })
    .sort((left, right) => {
      const leftTime = eventTimeValue(left);
      const rightTime = eventTimeValue(right);
      return sort === "newest" ? rightTime - leftTime : leftTime - rightTime;
    });

  const warningCount = events.filter((event) => readEventString(event, "type").toLowerCase() === "warning").length;
  const normalCount = events.filter((event) => readEventString(event, "type").toLowerCase() === "normal").length;

  return (
    <section className="drawer-panel-stack">
      <div className="drawer-filterbar">
        <div className="segmented-control" aria-label="Event type filter">
          <button className={typeFilter === "all" ? "active" : ""} onClick={() => onTypeFilterChange("all")}>All {events.length}</button>
          <button className={typeFilter === "warning" ? "active" : ""} onClick={() => onTypeFilterChange("warning")}>Warning {warningCount}</button>
          <button className={typeFilter === "normal" ? "active" : ""} onClick={() => onTypeFilterChange("normal")}>Normal {normalCount}</button>
        </div>
        <label className="compact-select">
          Sort
          <select value={sort} onChange={(event) => onSortChange(event.target.value as EventSortOrder)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>
      {loading ? <div className="muted">Loading...</div> : null}
      <ErrorPanel error={error} copyLabel={copyLabel} />
      <div className="event-list event-list-polished">
        {filteredEvents.length === 0 ? <p className="muted">No matching events.</p> : null}
        {filteredEvents.map((event) => (
          <EventCard event={event} key={event.uid || `${event.name}-${event.reason}-${event.lastTimestamp}`} onOpenRelated={onOpenRelated} now={now} />
        ))}
      </div>
    </section>
  );
}

function EventCard({ event, onOpenRelated, now }: { event: ResourceRow; onOpenRelated: (resource: string, namespace: string, name: string) => void; now: number }) {
  const type = readEventString(event, "type") || "Normal";
  const reason = readEventString(event, "reason") || "Event";
  const message = readEventString(event, "message") || "No message.";
  const count = readEventNumber(event, "count");
  const involved = eventInvolvedObject(event);
  const relatedResource = involved.kind ? resourceForKind(involved.kind) : undefined;
  const canOpen = Boolean(relatedResource && involved.name);
  const timestamp = readEventString(event, "lastTimestamp") || readEventString(event, "createdAt") || readEventString(event, "eventTime");

  return (
    <article className={`event-card event-card-${type.toLowerCase()}`}>
      <header className="event-card-header">
        <div>
          <strong>{reason}</strong>
          <span>{type}{count > 1 ? ` · ${count}x` : ""}</span>
        </div>
        {timestamp ? <time title={timestamp}>{formatAgeAgo(timestamp, now)}</time> : null}
      </header>
      <p>{message}</p>
      <footer className="event-card-footer">
        {involved.label ? <span className="pill">{involved.label}</span> : null}
        {canOpen && relatedResource ? (
          <button className="inline-action" onClick={() => onOpenRelated(relatedResource, involved.namespace || "_cluster", involved.name)}>
            Open involved object
          </button>
        ) : null}
      </footer>
    </article>
  );
}

function eventInvolvedObject(event: ResourceRow) {
  const parsedObject = parseKindName(readEventString(event, "object"));
  const involvedKind = readEventString(event, "involvedKind") || parsedObject.kind;
  const involvedName = readEventString(event, "involvedName") || parsedObject.name;
  const involvedNamespace = readEventString(event, "involvedNamespace") || readEventString(event, "namespace") || "_cluster";
  const label = involvedKind && involvedName ? `${involvedKind}/${involvedName}` : readEventString(event, "object");
  return { kind: involvedKind, name: involvedName, namespace: involvedNamespace, label };
}

function parseKindName(value: string) {
  const [kind = "", ...nameParts] = value.split("/");
  return { kind, name: nameParts.join("/") };
}

function eventTimeValue(event: ResourceRow) {
  const value = readEventString(event, "lastTimestamp") || readEventString(event, "eventTime") || readEventString(event, "createdAt");
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readEventString(row: ResourceRow, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

function readEventNumber(row: ResourceRow, key: string) {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function resourceForKind(kind: unknown) {
  const map: Record<string, string> = {
    Pod: "pods",
    ReplicaSet: "replicasets",
    Deployment: "deployments",
    StatefulSet: "statefulsets",
    DaemonSet: "daemonsets",
    Job: "jobs",
    CronJob: "cronjobs",
    Service: "services",
    ConfigMap: "configmaps",
    Secret: "secrets",
    ServiceAccount: "serviceaccounts",
    Role: "roles",
    RoleBinding: "rolebindings",
    ClusterRole: "clusterroles",
    ClusterRoleBinding: "clusterrolebindings",
    Node: "nodes",
    Ingress: "ingresses",
    Endpoints: "endpoints",
    EndpointSlice: "endpointslices",
    PersistentVolumeClaim: "persistentvolumeclaims",
    PersistentVolume: "persistentvolumes",
    StorageClass: "storageclasses",
    Namespace: "namespaces",
  };
  return map[String(kind ?? "")];
}
