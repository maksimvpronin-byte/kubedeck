import type { ReactNode } from "react";
import type { ResourceRow } from "../types";
import { formatAge } from "../utils/time";
import { metricPercent, ResourceUsageBar } from "./ResourceUsageBar";

interface Props {
  row: ResourceRow;
  resource: string;
  now: number;
  events?: ResourceRow[];
}

type Tone = "default" | "warning" | "danger" | "success";
type Fact = { label: string; value: ReactNode; tone?: Tone };

export function ResourceSummary({ row, resource, now, events = [] }: Props) {
  const facts = summaryFacts(row, resource, now);
  const containers = isPod(resource) ? containerRows(row) : [];
  const failures = isPod(resource) ? restartFailures(row) : [];
  const warnings = warningEvents(events).slice(0, 5);
  const quota = isQuota(resource) ? quotaRows(row.quotaUsage) : [];
  const workloadConditions = Array.isArray(row.workloadConditions) ? row.workloadConditions as Array<{ label: string; reason?: string; message?: string; tone?: string }> : [];

  return (
    <div className="resource-summary-layout">
      <section className="resource-summary-card-grid" aria-label="Operational summary">
        {facts.map((item) => (
          <SummaryTile key={item.label} {...item} />
        ))}
      </section>

      {workloadConditions.length ? (
        <section className="resource-summary-section" aria-label="Workload conditions">
          <div className="resource-summary-section-title">Conditions</div>
          <div className="workload-condition-list summary-workload-conditions">
            {workloadConditions.map((condition) => (
              <span className={`workload-condition is-${condition.tone || "neutral"}`} title={`${condition.reason || condition.label}${condition.message ? `: ${condition.message}` : ""}`} key={condition.label}>
                {condition.label}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {containers.length ? (
        <section className="resource-summary-section" aria-label="Containers">
          <div className="resource-summary-section-title">Containers</div>
          <div className="summary-container-list">
            {containers.map((item) => (
              <div className={`summary-container-row is-${item.tone}`} key={item.name}>
                <strong>{item.name}</strong>
                <span>{item.state}</span>
                <span>{item.ready ? "Ready" : "Not ready"}</span>
                {item.restarts ? (
                  <span>
                    {item.restarts} restart{item.restarts === 1 ? "" : "s"}
                  </span>
                ) : null}
                {item.reason ? <small title={item.message}>{item.reason}</small> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {failures.length ? (
        <section className="resource-summary-section" aria-label="Last container failures">
          <div className="resource-summary-section-title">Last failure</div>
          <div className="summary-problem-list">
            {failures.map((item) => (
              <div className="summary-problem-row" key={`${item.container}:${item.reason}`}>
                <strong>{item.container}</strong>
                <span>
                  {item.reason}
                  {item.exitCode ? ` · exit ${item.exitCode}` : ""}
                </span>
                {item.finished ? <small>{formatAge(item.finished, now)} ago</small> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {quota.length ? <QuotaUsage rows={quota} /> : null}

      {warnings.length ? (
        <section className="resource-summary-section" aria-label="Recent warning events">
          <div className="resource-summary-section-title">Recent warnings</div>
          <div className="summary-warning-list">
            {warnings.map((event, index) => (
              <div className="summary-warning-row" key={`${String(event.uid || event.reason)}:${index}`}>
                <strong>{String(event.reason || "Warning")}</strong>
                <span>{String(event.message || "")}</span>
                <small>{formatAge(event.createdAt, now)} ago</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!facts.length && !containers.length && !quota.length ? <p className="resource-summary-empty">No operational summary is available. Use YAML or Describe for full details.</p> : null}
    </div>
  );
}

function summaryFacts(row: ResourceRow, resource: string, now: number): Fact[] {
  const kind = baseResource(resource);
  const status = primaryStatus(row);
  const facts: Fact[] = [];
  addFact(facts, "Status", status, statusTone(status));
  addFact(facts, "Age", row.createdAt ? formatAge(row.createdAt, now) : "");

  if (kind === "pod") {
    addFact(facts, "Ready", row.ready, readyTone(row.ready));
    addFact(facts, "Restarts", nonZero(row.restarts), "warning");
    addFact(facts, "Node", row.node);
    addFact(facts, "Pod IP", row.podIp);
    if (String(row.serviceAccountName || "") !== "default") addFact(facts, "Service account", row.serviceAccountName);
    addFact(facts, "Owner", ownerText(row.ownerReferences));
    return facts;
  }

  if (["deployment", "statefulset", "daemonset", "replicaset"].includes(kind)) {
    addFact(facts, "Ready", row.ready, readyTone(row.ready));
    addFact(facts, "Desired", row.desired ?? row.replicas);
    addFact(facts, "Available", row.available);
    addFact(facts, "Updated", row.updated);
    addFact(facts, "Images", row.images);
    return facts;
  }

  if (kind === "service") {
    addFact(facts, "Type", row.type);
    addFact(facts, "Cluster IP", row.clusterIp);
    addFact(facts, "External", row.externalIp ?? row.externalAddress);
    addFact(facts, "Ports", row.ports);
    addFact(facts, "Selector", row.selectorText);
    addFact(facts, "Ready endpoints", row.readyEndpoints, Number(row.readyEndpoints) === 0 ? "warning" : undefined);
    return facts;
  }

  if (kind === "ingress") {
    addFact(facts, "Class", row.className);
    addFact(facts, "Hosts", row.hosts);
    addFact(facts, "Addresses", row.addressesText ?? row.address);
    addFact(facts, "Backends", row.backendServicesText);
    addFact(facts, "TLS", row.tlsHosts);
    return facts;
  }

  if (kind === "node") {
    addFact(facts, "Scheduling", row.unschedulable ? "Cordoned" : "Schedulable", row.unschedulable ? "warning" : undefined);
    addFact(facts, "Pressure", row.pressure, row.pressure ? "warning" : undefined);
    addFact(facts, "Internal IP", row.internalIp);
    addFact(facts, "Kubelet", row.kubeletVersion);
    addFact(facts, "Runtime", row.containerRuntime);
    addFact(facts, "Platform", [row.osImage || row.os, row.architecture].filter(Boolean).join(" · "));
    addFact(facts, "CPU", <ResourceUsageBar label="CPU" tone="cpu" percent={metricPercent(row.cpuUsagePercent)} used={row.cpuUsage} free={row.cpuAvailable} allocatable={row.cpuAllocatable ?? row.cpuCapacity} />);
    addFact(facts, "Memory", <ResourceUsageBar label="RAM" tone="memory" percent={metricPercent(row.memoryUsagePercent)} used={row.memoryUsage} free={row.memoryAvailable} allocatable={row.memoryAllocatable ?? row.memoryCapacity} />);
    addFact(facts, "Disk", <ResourceUsageBar label="Disk" tone="disk" percent={usagePercent(row.diskUsage, row.diskObservedCapacity ?? row.diskAllocatable ?? row.diskCapacity)} used={row.diskUsage} free={row.diskAvailable} allocatable={row.diskObservedCapacity ?? row.diskAllocatable ?? row.diskCapacity} />);
    addFact(facts, "Pods", capacityText(row.podsAllocatable, row.podsCapacity));
    return facts;
  }

  if (["configmap", "secret"].includes(kind)) {
    if (kind === "secret") addFact(facts, "Type", row.type);
    addFact(facts, "Keys", row.keyCount ?? row.keysCount);
    addFact(facts, "Key names", row.keyNames ?? row.keys);
    if (row.immutable === true) addFact(facts, "Immutable", "Yes");
    return facts;
  }

  if (["persistentvolumeclaim", "persistentvolume"].includes(kind)) {
    addFact(facts, "Capacity", row.capacity ?? row.storage);
    addFact(facts, "Access modes", row.accessModes);
    addFact(facts, "Storage class", row.storageClassName ?? row.storageClass);
    addFact(facts, kind === "persistentvolume" ? "Claim" : "Volume", row.claim ?? row.volumeName);
    addFact(facts, "Reclaim policy", row.reclaimPolicy);
    return facts;
  }

  if (kind === "storageclass") {
    addFact(facts, "Provisioner", row.provisioner);
    addFact(facts, "Reclaim policy", row.reclaimPolicy);
    addFact(facts, "Binding mode", row.volumeBindingMode);
    addFact(facts, "Expansion", row.allowVolumeExpansion === true ? "Allowed" : row.allowVolumeExpansion === false ? "Disabled" : "");
    return facts;
  }

  if (["job", "cronjob"].includes(kind)) {
    addFact(facts, "Active", row.active);
    addFact(facts, "Succeeded", row.succeeded);
    addFact(facts, "Failed", nonZero(row.failed), "danger");
    addFact(facts, "Completions", row.completions);
    addFact(facts, "Schedule", row.schedule);
    addFact(facts, "Last schedule", row.lastScheduleTime ? formatAge(row.lastScheduleTime, now) : "");
    return facts;
  }

  if (["role", "clusterrole"].includes(kind)) {
    addFact(facts, "Rules", Array.isArray(row.rules) ? row.rules.length : row.ruleCount);
    addFact(facts, "Permissions", row.rulesText);
    return facts;
  }

  if (["rolebinding", "clusterrolebinding"].includes(kind)) {
    addFact(facts, "Role", [row.roleRefKind, row.roleRefName].filter(Boolean).join("/"));
    addFact(facts, "Subjects", Array.isArray(row.subjects) ? row.subjects.length : row.subjectCount);
    addFact(facts, "Members", row.subjectsText);
    return facts;
  }

  if (kind === "serviceaccount") {
    addFact(facts, "Secrets", row.secrets);
    addFact(facts, "Image pull secrets", row.imagePullSecrets);
    return facts;
  }

  if (kind === "customresourcedefinition") {
    addFact(facts, "Kind", row.kind);
    addFact(facts, "Group", row.group);
    addFact(facts, "Plural", row.plural);
    addFact(facts, "Scope", row.scope);
    addFact(facts, "Versions", row.versions);
    addFact(facts, "Short names", row.shortNames);
    return facts;
  }

  if (kind === "resourcequota") {
    addFact(facts, "Scopes", arrayText(row.scopes));
    return facts;
  }

  addFact(facts, "Type", row.type);
  return facts;
}

function SummaryTile({ label, value, tone = "default" }: Fact) {
  return (
    <div className={`resource-summary-tile${tone === "default" ? "" : ` is-${tone}`}`}>
      <span className="resource-summary-label">{label}</span>
      <strong className="resource-summary-value">{value}</strong>
    </div>
  );
}

function addFact(items: Fact[], label: string, value: unknown, tone?: Tone) {
  if (value === undefined || value === null || value === "" || value === "unknown" || value === "0/0") return;
  items.push({ label, value: value as ReactNode, tone });
}

function containerRows(row: ResourceRow) {
  if (!Array.isArray(row.containerStates)) return [];
  return row.containerStates.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const state = String(item.state || "unknown");
    const ready = item.ready === true;
    const reason = String(item.reason || "");
    return [
      {
        name: String(item.name || `container-${index + 1}`),
        state,
        ready,
        reason,
        message: String(item.message || ""),
        restarts: Number(item.restartCount || 0),
        tone: ready ? "success" : reason || state === "terminated" ? "danger" : "warning",
      },
    ];
  });
}

function restartFailures(row: ResourceRow) {
  if (!Array.isArray(row.restartDiagnostics)) return [];
  return row.restartDiagnostics.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const exitCode = Number(item.lastExitCode);
    const reason = String(item.lastReason || "");
    if ((!Number.isFinite(exitCode) || exitCode === 0) && (!reason || reason.toLowerCase() === "completed")) return [];
    return [
      { container: String(item.container || "container"), reason: reason || "Terminated", exitCode: Number.isFinite(exitCode) ? String(exitCode) : "", finished: String(item.lastFinishedAt || "") },
    ];
  });
}

function warningEvents(events: ResourceRow[]) {
  const seen = new Set<string>();
  return events
    .filter((event) => {
      if (String(event.type || "").toLowerCase() !== "warning") return false;
      const key = `${String(event.reason || "")}:${String(event.message || "")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")));
}

function QuotaUsage({ rows }: { rows: Array<{ resource: string; used: string; hard: string; displayUsed: string; displayHard: string; ratio: number | null }> }) {
  return (
    <section className="resource-summary-section quota-usage">
      <div className="resource-summary-section-title">Quota usage</div>
      {rows.map((row) => (
        <div className={`quota-usage-row is-${row.ratio !== null && row.ratio >= 95 ? "danger" : row.ratio !== null && row.ratio >= 80 ? "warning" : "normal"}`} key={row.resource}>
          <div>
            <strong title={row.resource}>{row.resource}</strong>
            <span title={`${row.used} / ${row.hard || "—"}`}>
              {row.displayUsed} / {row.displayHard || "—"}
            </span>
          </div>
          {row.ratio === null ? null : (
            <>
              <div className="quota-usage-track" title={`${row.resource}: ${row.used} / ${row.hard}`} aria-label={`${row.resource}: ${row.used} of ${row.hard}`}>
                <span style={{ width: `${Math.min(100, row.ratio)}%` }} />
              </div>
              <b>{Math.round(row.ratio)}%</b>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

function quotaRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const used = String(item.used || "0");
      const hard = String(item.hard || "");
      const resource = String(item.resource || "resource");
      return [{ resource, used, hard, displayUsed: formatQuotaQuantity(resource, used), displayHard: formatQuotaQuantity(resource, hard), ratio: quantityRatio(used, hard) }];
    })
    .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
}

export function quantityRatio(used: string, hard: string) {
  const left = parseKubeQuantity(used);
  const right = parseKubeQuantity(hard);
  return left === null || right === null || right <= 0 ? null : (left / right) * 100;
}

export function formatQuotaQuantity(resource: string, value: string) {
  if (!value || value === "0" || !/(memory|storage)/i.test(resource)) return value;
  const bytes = parseKubeQuantity(value);
  if (bytes === null) return value;
  const units: Array<[string, number]> = [["TiB", 1024 ** 4], ["GiB", 1024 ** 3], ["MiB", 1024 ** 2], ["KiB", 1024]];
  const [suffix, divisor] = units.find(([, threshold]) => bytes >= threshold) ?? ["B", 1];
  const rounded = Math.round((bytes / divisor) * 100) / 100;
  return `${rounded} ${suffix}`;
}

function parseKubeQuantity(value: string) {
  const match = value.match(/^(-?\d+(?:\.\d+)?)(m|Ki|Mi|Gi|Ti|k|K|M|G|T)?$/);
  if (!match) return null;
  const factors: Record<string, number> = { m: 0.001, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4 };
  return Number(match[1]) * (factors[match[2] || ""] || 1);
}

function usagePercent(used: unknown, total: unknown) {
  const left = parseDisplayBytes(used);
  const right = parseDisplayBytes(total);
  return left === null || right === null || right <= 0 ? null : Math.max(0, Math.min(100, Math.round((left / right) * 100)));
}

function parseDisplayBytes(value: unknown) {
  const match = String(value ?? "").match(/^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB)$/);
  if (!match) return null;
  const factors: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };
  return Number(match[1]) * factors[match[2]];
}

function primaryStatus(row: ResourceRow) {
  return String(row.phase || row.status || row.type || "");
}
function statusTone(status: string): Tone {
  const value = status.toLowerCase();
  if (/running|ready|active|bound|succeeded/.test(value)) return "success";
  if (/error|fail|crash|unavailable|notready/.test(value)) return "danger";
  if (/pending|terminating|waiting|cordon/.test(value)) return "warning";
  return "default";
}
function readyTone(value: unknown): Tone | undefined {
  const ready = String(value || "").toLowerCase();
  return ready.includes("0/") || ready === "false" ? "warning" : ready ? "success" : undefined;
}
function nonZero(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : "";
}
function capacityText(allocatable: unknown, capacity: unknown) {
  return allocatable || capacity ? `${String(allocatable || "—")} / ${String(capacity || "—")}` : "";
}

function ownerText(value: unknown) {
  if (!Array.isArray(value)) return "";
  const owner = value.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
  return owner ? [owner.kind, owner.name].filter(Boolean).join("/") : "";
}
function arrayText(value: unknown) {
  return Array.isArray(value) ? value.join(", ") : value;
}
function baseResource(resource: string) {
  const value = resource.toLowerCase().split(".")[0];
  if (value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.endsWith("ses")) return value.slice(0, -2);
  if (value.endsWith("s")) return value.slice(0, -1);
  return value;
}
function isPod(resource: string) {
  return baseResource(resource) === "pod";
}
function isQuota(resource: string) {
  return baseResource(resource) === "resourcequota";
}
