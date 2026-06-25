export type ProblemSeverity = "Critical" | "Warning" | "Info";

export interface ProblemRow {
  uid: string;
  severity: ProblemSeverity;
  kind: string;
  resource: string;
  namespace: string;
  name: string;
  reason: string;
  message: string;
  createdAt: string;
  category: string;
  categoryLabel: string;
  impact: string;
  targetKind: string;
  targetResource: string;
  targetNamespace: string;
  targetName: string;
}

export interface ProblemSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  errors: number;
  generatedAt: string;
  sources: Record<string, number>;
  categories: Record<string, number>;
  kinds: Record<string, number>;
}

export type ProblemSourceRows = Record<string, Array<Record<string, unknown>>>;

const CATEGORY_LABELS: Record<string, string> = {
  crashLoop: "CrashLoopBackOff",
  imagePull: "ImagePull",
  scheduling: "Scheduling",
  node: "Node health",
  storage: "Storage / volume",
  restarts: "Restart loop",
  probe: "Probe failure",
  deployment: "Deployment availability",
  event: "Warning event",
  podPhase: "Pod phase",
  generic: "Generic",
};

const KIND_TO_RESOURCE: Record<string, string> = {
  pod: "pods",
  deployment: "deployments",
  replicaset: "replicasets",
  statefulset: "statefulsets",
  daemonset: "daemonsets",
  job: "jobs",
  cronjob: "cronjobs",
  service: "services",
  ingress: "ingresses",
  node: "nodes",
  persistentvolumeclaim: "persistentvolumeclaims",
  persistentvolume: "persistentvolumes",
  configmap: "configmaps",
  secret: "secrets",
};

function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function integer(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function parseReadyPair(value: unknown): [number, number] {
  const parts = text(value).split("/", 2);
  if (parts.length !== 2) return [0, 0];
  const ready = Number.parseInt(parts[0], 10);
  const desired = Number.parseInt(parts[1], 10);
  return [Number.isFinite(ready) ? ready : 0, Number.isFinite(desired) ? desired : 0];
}

export function classifyProblem(kind: string, reason: string, message: string): string {
  const value = `${kind} ${reason} ${message}`.toLowerCase();
  if (["crashloop", "back-off restarting", "backoff restarting"].some((token) => value.includes(token))) {
    return "crashLoop";
  }
  if ([
    "imagepull",
    "errimagepull",
    "image pull",
    "pull image",
    "pull access denied",
    "manifest unknown",
    "repository does not exist",
  ].some((token) => value.includes(token))) {
    return "imagePull";
  }
  if ([
    "failedscheduling",
    "unschedulable",
    "0/",
    "nodes are available",
    "preemption",
    "taint",
    "toleration",
    "affinity",
    "insufficient",
    "node(s) didn't match",
  ].some((token) => value.includes(token))) {
    return "scheduling";
  }
  if ([
    "failedmount",
    "mountvolume",
    "attachvolume",
    "detachvolume",
    "persistentvolume",
    "storageclass",
    "pvc",
    "volume",
    "multi-attach",
  ].some((token) => value.includes(token))) {
    return "storage";
  }
  if ([
    "nodepressure",
    "node pressure",
    "notready",
    "node not ready",
    "diskpressure",
    "memorypressure",
    "pidpressure",
    "kubelet",
  ].some((token) => value.includes(token))) {
    return "node";
  }
  if ([
    "readiness probe",
    "liveness probe",
    "startup probe",
    "probe failed",
    "unhealthy",
  ].some((token) => value.includes(token))) {
    return "probe";
  }
  if (["oomkilled", "restart", "restarts", "terminated"].some((token) => value.includes(token))) {
    return "restarts";
  }
  if (value.includes("unavailable replicas")) return "deployment";
  if (kind.toLowerCase() === "event") return "event";
  if (value.includes("pod phase")) return "podPhase";
  return "generic";
}

function severityForCategory(category: string, fallback: ProblemSeverity): ProblemSeverity {
  return ["crashLoop", "imagePull", "node"].includes(category) ? "Critical" : fallback;
}

function impactForCategory(category: string): string {
  if (["crashLoop", "imagePull", "scheduling", "probe"].includes(category)) {
    return "Workload may be unavailable or degraded.";
  }
  if (category === "node") {
    return "Node capacity or kubelet health can affect multiple workloads.";
  }
  if (category === "storage") {
    return "Pod startup or application writes may be blocked by storage state.";
  }
  if (category === "deployment") {
    return "Desired replicas are not fully available.";
  }
  if (category === "restarts") {
    return "Container instability may cause request failures or data loss.";
  }
  return "Open the resource and inspect status, events and related resources.";
}

function resourceForKind(kind: string): string {
  return KIND_TO_RESOURCE[kind.toLowerCase()] ?? "events";
}

function problemRow(
  uid: string,
  severity: ProblemSeverity,
  kind: string,
  resource: string,
  namespace: unknown,
  name: unknown,
  reason: string,
  message: string,
  createdAt: unknown = "",
  options: {
    category?: string;
    targetKind?: string;
    targetResource?: string;
    targetNamespace?: unknown;
    targetName?: unknown;
  } = {},
): ProblemRow {
  const category = options.category ?? classifyProblem(kind, reason, message);
  return {
    uid,
    severity,
    kind,
    resource,
    namespace: text(namespace),
    name: text(name),
    reason,
    message,
    createdAt: text(createdAt),
    category,
    categoryLabel: CATEGORY_LABELS[category] ?? CATEGORY_LABELS.generic,
    impact: impactForCategory(category),
    targetKind: options.targetKind ?? kind,
    targetResource: options.targetResource ?? resource,
    targetNamespace: options.targetNamespace === undefined ? text(namespace) : text(options.targetNamespace),
    targetName: options.targetName === undefined ? text(name) : text(options.targetName),
  };
}

function problemSortKey(row: ProblemRow): [number, number, string] {
  const severityOrder: Record<ProblemSeverity, number> = {
    Critical: 0,
    Warning: 1,
    Info: 2,
  };
  const timestamp = Date.parse(row.createdAt);
  return [severityOrder[row.severity] ?? 9, Number.isFinite(timestamp) ? -timestamp : 0, row.name];
}

function compareProblems(left: ProblemRow, right: ProblemRow): number {
  const a = problemSortKey(left);
  const b = problemSortKey(right);
  return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
}

function deduplicateProblems(items: ProblemRow[]): ProblemRow[] {
  const seen = new Set<string>();
  const result: ProblemRow[] = [];
  for (const item of items) {
    const key = item.uid || `${item.kind}|${item.namespace}|${item.name}|${item.reason}|${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function buildProblemRows(
  pods: Array<Record<string, unknown>>,
  deployments: Array<Record<string, unknown>>,
  events: Array<Record<string, unknown>>,
  nodes: Array<Record<string, unknown>>,
  pvcs: Array<Record<string, unknown>>,
  restartThreshold: number,
): ProblemRow[] {
  const results: ProblemRow[] = [];
  const threshold = Math.max(1, Math.trunc(restartThreshold || 3));

  for (const pod of pods) {
    const phase = text(pod.phase);
    const restarts = integer(pod.restarts);
    const uid = text(pod.uid);
    if (phase && !["Running", "Succeeded", "Completed"].includes(phase)) {
      const severity: ProblemSeverity = ["Failed", "Unknown"].includes(phase) ? "Critical" : "Warning";
      const category = phase === "Pending" ? "scheduling" : "podPhase";
      results.push(problemRow(
        `pod-phase-${uid}`,
        severity,
        "Pod",
        "pods",
        pod.namespace,
        pod.name,
        "Pod phase",
        phase,
        pod.createdAt,
        { category },
      ));
    }
    if (restarts >= threshold) {
      const severity: ProblemSeverity = restarts >= threshold * 3 ? "Critical" : "Warning";
      results.push(problemRow(
        `pod-restarts-${uid}`,
        severity,
        "Pod",
        "pods",
        pod.namespace,
        pod.name,
        "Restart threshold",
        `${restarts} restarts`,
        pod.createdAt,
        { category: "restarts" },
      ));
    }
    if (pod.reason || pod.statusMessage) {
      const reason = text(pod.reason) || "Pod status";
      const message = text(pod.statusMessage) || reason;
      const category = classifyProblem("Pod", reason, message);
      results.push(problemRow(
        `pod-status-${uid}`,
        severityForCategory(category, "Warning"),
        "Pod",
        "pods",
        pod.namespace,
        pod.name,
        reason,
        message,
        pod.createdAt,
        { category },
      ));
    }
    if (pod.containerProblems) {
      const message = text(pod.containerProblems);
      const category = classifyProblem("Pod", "Container problem", message);
      results.push(problemRow(
        `pod-containers-${uid}`,
        severityForCategory(category, "Warning"),
        "Pod",
        "pods",
        pod.namespace,
        pod.name,
        "Container problem",
        message,
        pod.createdAt,
        { category },
      ));
    }
    if (pod.conditions) {
      const message = text(pod.conditions);
      const category = classifyProblem("Pod", "Pod conditions", message);
      results.push(problemRow(
        `pod-conditions-${uid}`,
        severityForCategory(category, "Warning"),
        "Pod",
        "pods",
        pod.namespace,
        pod.name,
        "Pod conditions",
        message,
        pod.createdAt,
        { category },
      ));
    }
  }

  for (const deployment of deployments) {
    const [ready, desired] = parseReadyPair(deployment.ready);
    if (desired > 0 && ready < desired) {
      results.push(problemRow(
        `deployment-ready-${text(deployment.uid)}`,
        "Warning",
        "Deployment",
        "deployments",
        deployment.namespace,
        deployment.name,
        "Unavailable replicas",
        text(deployment.ready),
        deployment.createdAt,
        { category: "deployment" },
      ));
    }
  }

  for (const event of events) {
    if (text(event.type).toLowerCase() !== "warning") continue;
    const reason = text(event.reason) || "Warning";
    const message = text(event.message);
    const category = classifyProblem("Event", reason, message);
    const targetKind = text(event.involvedKind);
    const targetNamespace = text(event.involvedNamespace) || text(event.namespace);
    results.push(problemRow(
      `event-${text(event.uid)}`,
      severityForCategory(category, "Warning"),
      "Event",
      "events",
      event.namespace,
      event.name,
      reason,
      message,
      text(event.lastTimestamp) || text(event.createdAt),
      {
        category,
        targetKind,
        targetResource: resourceForKind(targetKind),
        targetNamespace,
        targetName: event.involvedName,
      },
    ));
  }

  for (const node of nodes) {
    if (text(node.status) !== "Ready") {
      results.push(problemRow(
        `node-ready-${text(node.uid)}`,
        "Critical",
        "Node",
        "nodes",
        "_cluster",
        node.name,
        "Node not ready",
        text(node.status),
        node.createdAt,
        { category: "node" },
      ));
    }
    if (node.pressure) {
      results.push(problemRow(
        `node-pressure-${text(node.uid)}`,
        "Critical",
        "Node",
        "nodes",
        "_cluster",
        node.name,
        "Node pressure",
        text(node.pressure),
        node.createdAt,
        { category: "node" },
      ));
    }
  }

  for (const pvc of pvcs) {
    const status = text(pvc.status);
    if (status && status !== "Bound") {
      results.push(problemRow(
        `pvc-${text(pvc.uid)}`,
        "Warning",
        "PersistentVolumeClaim",
        "persistentvolumeclaims",
        pvc.namespace,
        pvc.name,
        "PVC not bound",
        status,
        pvc.createdAt,
        { category: "storage" },
      ));
    }
  }

  return deduplicateProblems(results).sort(compareProblems);
}

function countBy(items: ProblemRow[], key: "category" | "kind"): Record<string, number> {
  const values = new Map<string, number>();
  for (const item of items) {
    const value = text(item[key]) || "unknown";
    values.set(value, (values.get(value) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...values.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

export function summarizeProblems(
  items: ProblemRow[],
  sources: ProblemSourceRows,
  errors: Array<Record<string, unknown>>,
  now: () => Date = () => new Date(),
): ProblemSummary {
  return {
    total: items.length,
    critical: items.filter((item) => item.severity === "Critical").length,
    warning: items.filter((item) => item.severity === "Warning").length,
    info: items.filter((item) => item.severity === "Info").length,
    errors: errors.length,
    generatedAt: now().toISOString(),
    sources: Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, value.length])),
    categories: countBy(items, "category"),
    kinds: countBy(items, "kind"),
  };
}
