import type { ErrorInfo, RelatedLink, ResourceRow } from "../types";
import { ErrorPanel } from "./ErrorPanel";

interface RelatedTabProps {
  pod: ResourceRow;
  relatedLinks: RelatedLink[];
  loading: boolean;
  error: ErrorInfo | null;
  copyLabel: string;
  sources: Record<string, number>;
  errors: Array<ErrorInfo & { resource?: string; namespace?: string }>;
  resourceFilter: string;
  onResourceFilterChange: (value: string) => void;
  onOpenRelated: (resource: string, namespace: string, name: string) => void;
  onDeletePods: (rows: ResourceRow[]) => void;
  sourceResource: string;
}

export function RelatedTab({
  pod,
  relatedLinks,
  loading,
  error,
  copyLabel,
  sources,
  errors,
  resourceFilter,
  onResourceFilterChange,
  onOpenRelated,
  onDeletePods,
  sourceResource,
}: RelatedTabProps) {
  const ownerLinks = ownerReferences(pod).map((owner) => {
    const resource = resourceForKind(owner.kind) || "";
    return {
      key: `owner:${owner.kind}:${owner.name}:${owner.uid || ""}`,
      resource,
      namespace: String(pod.namespace || "_cluster"),
      name: String(owner.name || ""),
      kind: String(owner.kind || "Owner"),
      relation: owner.controller ? "controller ownerRef" : "ownerRef",
      detail: owner.uid ? `uid: ${owner.uid}` : undefined,
    } satisfies RelatedLink;
  });

  const allLinks = [...ownerLinks, ...dedupeRelatedLinks(relatedLinks)];
  const resourceOptions = Array.from(new Set(allLinks.map((link) => link.resource || link.kind).filter(Boolean))).sort();
  const visibleLinks = resourceFilter === "all" ? allLinks : allLinks.filter((link) => (link.resource || link.kind) === resourceFilter);
  const groups = groupRelatedLinks(visibleLinks);
  const relationSummary = summarizeRelationGroups(allLinks);
  const pvcPods = sourceResource.startsWith("persistentvolumeclaim") ? allLinks.filter((link) => link.resource === "pods" && link.relation === "mounts this PVC") : [];

  return (
    <section className="drawer-panel-stack">
      <div className="drawer-filterbar related-toolbar">
        <label className="compact-select">
          Resource
          <select value={resourceFilter} onChange={(event) => onResourceFilterChange(event.target.value)}>
            <option value="all">All related ({allLinks.length})</option>
            {resourceOptions.map((option) => (
              <option value={option} key={option}>{displayResource(option)} ({allLinks.filter((link) => (link.resource || link.kind) === option).length})</option>
            ))}
          </select>
        </label>
        <button className="icon-text" disabled={allLinks.length === 0} onClick={() => copyRelatedMap(pod, allLinks)}>Copy map</button>
        {pvcPods.length ? <button className="danger" onClick={() => onDeletePods(pvcPods.map((link) => ({ uid: link.key, name: link.name, namespace: link.namespace, kind: "Pod" })))}>Delete all listed Pods ({pvcPods.length})</button> : null}
      </div>
      {relationSummary.length ? <RelationSummaryChips items={relationSummary} /> : null}
      {loading ? <div className="muted">Loading...</div> : null}
      <ErrorPanel error={error} copyLabel={copyLabel} />
      <RelatedDiagnostics sources={sources} errors={errors} />
      {groups.length === 0 && !loading ? <p className="muted">No related resources.</p> : null}
      <div className="related-group-list">
        {groups.map((group) => (
          <section className="related-group" key={group.key}>
            <header>
              <h3>{displayResource(group.key)}</h3>
              <span>{group.items.length}</span>
            </header>
            <div className="event-list">
              {group.items.map((link) => (
                <RelatedResourceCard link={link} key={link.key} onOpenRelated={onOpenRelated} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function RelationSummaryChips({ items }: { items: Array<{ key: string; label: string; count: number }> }) {
  return (
    <div className="related-relation-summary">
      {items.map((item) => (
        <span className={`relation-summary-chip ${relationClassName(item.key).replace("relation-badge", "")}`.trim()} key={item.key}>
          {item.label}: {item.count}
        </span>
      ))}
    </div>
  );
}

function summarizeRelationGroups(links: RelatedLink[]) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const link of links) {
    const key = relationGroup(link.relation);
    const current = counts.get(key) || { label: relationGroupLabel(key), count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return Array.from(counts.entries())
    .map(([key, value]) => ({ key, label: value.label, count: value.count }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function relationGroup(relation: string) {
  const lower = relation.toLowerCase();
  if (lower.includes("owner") || lower.includes("control")) return "owner";
  if (lower.includes("selector") || lower.includes("select") || lower.includes("target") || lower.includes("endpoint") || lower.includes("route")) return "network";
  if (lower.includes("mount") || lower.includes("volume") || lower.includes("storage") || lower.includes("pvc")) return "storage";
  if (lower.includes("role") || lower.includes("serviceaccount") || lower.includes("permission")) return "rbac";
  if (lower.includes("secret") || lower.includes("config") || lower.includes("env")) return "config";
  return "other";
}

function relationGroupLabel(group: string) {
  const labels: Record<string, string> = {
    owner: "Ownership",
    network: "Network",
    storage: "Storage",
    rbac: "RBAC",
    config: "Config",
    other: "Other",
  };
  return labels[group] || group;
}

function copyRelatedMap(row: ResourceRow, links: RelatedLink[]) {
  if (!navigator.clipboard) return;
  const title = `${row.namespace && row.namespace !== "_cluster" ? `${row.namespace}/` : ""}${row.name}`;
  const lines = [
    `Resource: ${title}`,
    `Related resources: ${links.length}`,
    "",
    ...links.map((link) => {
      const namespace = link.namespace && link.namespace !== "_cluster" ? `${link.namespace}/` : "cluster/";
      const detail = link.detail ? ` (${link.detail})` : "";
      return `- ${link.kind} ${namespace}${link.name}: ${link.relation}${detail}`;
    }),
  ];
  void navigator.clipboard.writeText(lines.join("\n"));
}

function RelatedResourceCard({ link, onOpenRelated }: { link: RelatedLink; onOpenRelated: (resource: string, namespace: string, name: string) => void }) {
  const canOpen = Boolean(link.resource && link.name);
  return (
    <button className="related-card related-card-polished" disabled={!canOpen} onClick={() => onOpenRelated(link.resource, link.namespace || "_cluster", link.name)}>
      <div className="related-card-main">
        <strong>{link.kind}/{link.name}</strong>
        <span className="related-namespace">{link.namespace && link.namespace !== "_cluster" ? link.namespace : "cluster-scoped"}</span>
      </div>
      <div className="related-relation-row">
        <span className={relationClassName(link.relation)}>{link.relation}</span>
        {link.detail ? <code>{link.detail}</code> : null}
      </div>
    </button>
  );
}

function dedupeRelatedLinks(links: RelatedLink[]) {
  const seen = new Set<string>();
  const result: RelatedLink[] = [];
  for (const link of links) {
    const key = `${link.resource}|${link.namespace}|${link.name}|${link.relation}|${link.detail || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result;
}

function groupRelatedLinks(links: RelatedLink[]) {
  const groups = new Map<string, RelatedLink[]>();
  for (const link of links) {
    const key = link.resource || link.kind || "related";
    const items = groups.get(key) || [];
    items.push(link);
    groups.set(key, items);
  }
  return Array.from(groups.entries())
    .map(([key, items]) => ({ key, items: items.sort((left, right) => left.name.localeCompare(right.name)) }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function relationClassName(relation: string) {
  const lower = relation.toLowerCase();
  if (lower.includes("owner") || lower.includes("control")) return "relation-badge relation-owner";
  if (lower.includes("selector") || lower.includes("select") || lower.includes("target") || lower.includes("endpoint") || lower.includes("route")) return "relation-badge relation-selector";
  if (lower.includes("mount") || lower.includes("volume") || lower.includes("storage") || lower.includes("pvc")) return "relation-badge relation-storage";
  if (lower.includes("role") || lower.includes("serviceaccount") || lower.includes("permission")) return "relation-badge relation-rbac";
  if (lower.includes("secret") || lower.includes("config") || lower.includes("env")) return "relation-badge relation-config";
  return "relation-badge";
}

function RelatedDiagnostics({ sources, errors }: { sources: Record<string, number>; errors: Array<ErrorInfo & { resource?: string; namespace?: string }> }) {
  const sourceEntries = Object.entries(sources).filter(([, count]) => count > 0);
  if (sourceEntries.length === 0 && errors.length === 0) return null;
  return (
    <section className="related-diagnostics">
      {sourceEntries.length ? (
        <div className="related-sources">
          <span className="muted">Scanned:</span>
          {sourceEntries.slice(0, 8).map(([resource, count]) => (
            <span className="pill" key={resource}>{resource}: {count}</span>
          ))}
          {sourceEntries.length > 8 ? <span className="pill">+{sourceEntries.length - 8}</span> : null}
        </div>
      ) : null}
      {errors.length ? (
        <details className="related-errors">
          <summary>{errors.length} source{errors.length === 1 ? "" : "s"} failed</summary>
          {errors.slice(0, 5).map((err, index) => (
            <p key={`${err.resource || "source"}-${index}`}>
              <strong>{err.resource || "resource"}</strong>{err.namespace ? `/${err.namespace}` : ""}: {err.message}
            </p>
          ))}
        </details>
      ) : null}
    </section>
  );
}

function ownerReferences(row: ResourceRow): Array<{ kind?: string; name?: string; uid?: string; controller?: boolean }> {
  return Array.isArray(row.ownerReferences) ? row.ownerReferences as Array<{ kind?: string; name?: string; uid?: string; controller?: boolean }> : [];
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

function displayResource(resource: string) {
  return resource.split(".")[0]
    .replace(/-/g, " ")
    .replace(/(^|\s)\S/g, (part) => part.toUpperCase());
}
