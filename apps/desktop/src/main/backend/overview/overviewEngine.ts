import { buildProblemRows, summarizeProblems, type ProblemSourceRows } from "../problems/problemEngine";
import { parseCpuMillicores, parseMemoryBytes } from "../resources/metrics";

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function number(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function record(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readyPair(value: unknown): [number, number] {
  const match = text(value).match(/^(\d+)\/(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

function workloadTone(resource: string, row: Row): "healthy" | "pending" | "danger" {
  const phase = text(row.phase || row.status).toLowerCase();
  const reason = text(row.reason || row.containerProblems || row.conditions).toLowerCase();
  if (/failed|crashloopbackoff|imagepullbackoff|errimagepull|oomkilled|evicted|unavailable/.test(`${phase} ${reason}`)) return "danger";
  if (resource === "pods") {
    const [ready, total] = readyPair(row.ready);
    if (phase === "running" && total > 0 && ready === total) return "healthy";
    if (/succeeded|completed/.test(phase)) return "healthy";
    return "pending";
  }
  if (resource === "jobs") {
    if (/complete|completed|succeeded/.test(phase) || number(row.succeeded) > 0) return "healthy";
    if (number(row.failed) > 0) return "danger";
    return "pending";
  }
  const [ready, desired] = readyPair(row.ready);
  if (desired > 0 && ready === desired) return "healthy";
  return "pending";
}

function workloadSummary(resource: string, rows: Row[]) {
  const counts = { resource, healthy: 0, pending: 0, danger: 0, total: rows.length };
  for (const row of rows) counts[workloadTone(resource, row)] += 1;
  return counts;
}

type ServiceRole = "controlPlane" | "etcd" | "ingress";

function nodeRoleTokens(node: Row): string[] {
  const labels = record(node.labels);
  const tokens = Object.entries(labels)
    .filter(([key]) => key.startsWith("node-role.kubernetes.io/"))
    .map(([key]) => key.slice("node-role.kubernetes.io/".length));
  const legacyRole = text(labels["kubernetes.io/role"]).trim();
  if (legacyRole) tokens.push(legacyRole);
  for (const taint of Array.isArray(node.taints) ? node.taints : []) {
    const key = text(record(taint).key);
    if (key.startsWith("node-role.kubernetes.io/")) tokens.push(key.slice("node-role.kubernetes.io/".length));
  }
  return [...new Set(tokens.map((token) => token.toLowerCase()).filter(Boolean))];
}

function serviceRole(node: Row): ServiceRole | null {
  const roles = nodeRoleTokens(node);
  if (roles.some((role) => role === "control-plane" || role === "master")) return "controlPlane";
  if (roles.some((role) => role === "etcd")) return "etcd";
  if (roles.some((role) => /(^|[-_.])ingress($|[-_.])/.test(role))) return "ingress";
  return null;
}

function workerRole(node: Row): string {
  const roles = nodeRoleTokens(node).filter((role) => !["worker", "node"].includes(role));
  return roles.length ? roles.sort().join(" + ") : "workers";
}

function aggregateResource(
  nodes: Row[],
  allocatableKey: string,
  usageKey: string,
  parser: (value: unknown) => number | null,
) {
  const allocatable = nodes.map((node) => parser(node[allocatableKey]));
  const used = nodes.map((node) => parser(node[usageKey]));
  const measuredNodes = used.filter((value) => value !== null).length;
  const total = allocatable.every((value) => value !== null) ? allocatable.reduce<number>((sum, value) => sum + (value ?? 0), 0) : undefined;
  const usedTotal = measuredNodes === nodes.length ? used.reduce<number>((sum, value) => sum + (value ?? 0), 0) : undefined;
  return {
    used: usedTotal,
    available: total !== undefined && usedTotal !== undefined ? Math.max(0, total - usedTotal) : undefined,
    allocatable: total,
    measuredNodes,
  };
}

function aggregateCapacityGroup(id: string, name: string, nodes: Row[]) {
  return {
    id,
    name,
    nodes: nodes.length,
    readyNodes: nodes.filter((node) => /^ready$/i.test(text(node.status))).length,
    pressuredNodes: nodes.filter((node) => /pressure|notready/i.test(`${text(node.status)} ${text(node.pressure)}`)).length,
    cpu: aggregateResource(nodes, "cpuAllocatableRaw", "cpuUsageRaw", parseCpuMillicores),
    memory: aggregateResource(nodes, "memoryAllocatableRaw", "memoryUsageRaw", parseMemoryBytes),
    storage: aggregateResource(nodes, "diskObservedCapacityRaw", "diskUsageRaw", parseMemoryBytes),
  };
}

function groupedCapacity(nodes: Row[], key: string, value: (node: Row) => string) {
  const grouped = new Map<string, Row[]>();
  for (const node of nodes) {
    const group = value(node) || "unlabelled";
    grouped.set(group, [...(grouped.get(group) ?? []), node]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, rows]) => aggregateCapacityGroup(`${key}:${name}`, name, rows));
}

function labelName(key: string): string {
  const aliases: Record<string, string> = {
    "topology.kubernetes.io/zone": "Zone",
    "topology.kubernetes.io/region": "Region",
    "node.kubernetes.io/instance-type": "Instance type",
  };
  return aliases[key] ?? key.split("/").at(-1) ?? key;
}

function groupingLabels(nodes: Row[]) {
  const ignored = new Set(["kubernetes.io/hostname", "kubernetes.io/os", "kubernetes.io/arch", "beta.kubernetes.io/os", "beta.kubernetes.io/arch"]);
  const labels = new Map<string, Set<string>>();
  for (const node of nodes) {
    for (const [key, rawValue] of Object.entries(record(node.labels))) {
      if (key.startsWith("node-role.kubernetes.io/") || ignored.has(key)) continue;
      const value = text(rawValue).trim();
      if (!value) continue;
      const values = labels.get(key) ?? new Set<string>();
      values.add(value);
      labels.set(key, values);
    }
  }
  const priority = (key: string) => key === "topology.kubernetes.io/zone" ? 0 : key === "topology.kubernetes.io/region" ? 1 : key === "node.kubernetes.io/instance-type" ? 2 : /contour|pool|group|environment|stage/i.test(key) ? 3 : 10;
  return [...labels.entries()]
    .filter(([, values]) => values.size > 1 && values.size <= 12)
    .sort(([left], [right]) => priority(left) - priority(right) || left.localeCompare(right))
    .slice(0, 12)
    .map(([key]) => ({ key, label: labelName(key) }));
}

function capacity(nodes: Row[]) {
  const excluded = { controlPlane: 0, etcd: 0, ingress: 0 };
  const serviceNodes = new Map<ServiceRole, Row[]>();
  const workers = nodes.filter((node) => {
    const role = serviceRole(node);
    if (role) {
      excluded[role] += 1;
      serviceNodes.set(role, [...(serviceNodes.get(role) ?? []), node]);
    }
    return role === null;
  });
  const serviceNames: Record<ServiceRole, string> = {
    controlPlane: "control-plane",
    etcd: "etcd",
    ingress: "ingress",
  };
  const serviceGroups = (["controlPlane", "etcd", "ingress"] as ServiceRole[])
    .filter((role) => serviceNodes.has(role))
    .map((role) => aggregateCapacityGroup(`service:${role}`, serviceNames[role], serviceNodes.get(role) ?? []));
  const views = [
    { key: "role", label: "Node role", groups: [...groupedCapacity(workers, "role", workerRole), ...serviceGroups] },
    ...groupingLabels(workers).map(({ key, label }) => ({
      key: `label:${key}`,
      label,
      groups: [...groupedCapacity(workers, key, (node) => text(record(node.labels)[key]).trim()), ...serviceGroups],
    })),
  ];
  return {
    workerNodes: workers.length,
    totalNodes: nodes.length,
    excluded,
    views,
  };
}

function clusterProfile(nodes: Row[], sources: ProblemSourceRows) {
  const unique = (key: string) => [...new Set(nodes.map((row) => text(row[key])).filter(Boolean))].sort();
  const namespaces = new Set<string>();
  for (const rows of Object.values(sources)) {
    for (const row of rows ?? []) {
      const namespace = text(row.namespace);
      if (namespace) namespaces.add(namespace);
    }
  }
  return {
    namespaces: namespaces.size,
    schedulingDisabled: nodes.filter((row) => Boolean(row.unschedulable)).length,
    kubernetesVersions: unique("kubeletVersion"),
    operatingSystems: unique("osImage"),
    architectures: unique("architecture"),
    containerRuntimes: unique("containerRuntime"),
  };
}

export function buildOverviewSnapshot(
  clusterId: string,
  namespaces: string[],
  sources: ProblemSourceRows,
  errors: Array<Record<string, unknown>>,
  restartThreshold = 3,
) {
  const problems = buildProblemRows(sources.pods ?? [], sources.deployments ?? [], sources.events ?? [], sources.nodes ?? [], sources.persistentvolumeclaims ?? [], restartThreshold);
  const problemSummary = summarizeProblems(problems, sources, errors);
  const workloads = ["pods", "deployments", "statefulsets", "daemonsets", "jobs"].map((resource) => workloadSummary(resource, sources[resource] ?? []));
  const nodes = sources.nodes ?? [];
  const nodesReady = nodes.filter((row) => /^ready$/i.test(text(row.status))).length;
  const healthy = workloads.reduce((sum, item) => sum + item.healthy, 0);
  const total = workloads.reduce((sum, item) => sum + item.total, 0);
  const pending = workloads.reduce((sum, item) => sum + item.pending, 0);
  const danger = workloads.reduce((sum, item) => sum + item.danger, 0);
  const tone = errors.length ? "neutral" : problemSummary.critical || danger || nodesReady < nodes.length ? "danger" : problemSummary.warning || pending ? "pending" : "success";
  return {
    generatedAt: new Date().toISOString(),
    scope: { clusterId, namespaces },
    verdict: {
      tone,
      reasonCodes: errors.length ? ["partial-data"] : tone === "danger" ? ["active-failures"] : tone === "pending" ? ["changes-in-progress"] : ["healthy"],
    },
    summary: {
      nodesReady,
      nodesTotal: nodes.length,
      workloadsHealthy: healthy,
      workloadsTotal: total,
      podsReady: workloads[0].healthy,
      podsTotal: workloads[0].total,
      critical: problemSummary.critical,
      warning: problemSummary.warning,
    },
    capacity: capacity(nodes),
    clusterProfile: clusterProfile(nodes, sources),
    workloads,
    sources: problemSummary.sources,
    errors,
  };
}
