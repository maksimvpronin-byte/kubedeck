export type JsonObject = Record<string, unknown>;
export type ResourceRow = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

function records(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cpuMillicores(value: unknown): number | null {
  const raw = text(value).trim();
  if (!raw) return null;
  const parsed = raw.endsWith("m") ? Number(raw.slice(0, -1)) : raw.endsWith("u") ? Number(raw.slice(0, -1)) / 1000 : raw.endsWith("n") ? Number(raw.slice(0, -1)) / 1_000_000 : Number(raw) * 1000;
  return Number.isFinite(parsed) ? parsed : null;
}

function memoryBytes(value: unknown): number | null {
  const raw = text(value).trim();
  if (!raw) return null;
  const units: Array<[string, number]> = [
    ["Ki", 1024],
    ["Mi", 1024 ** 2],
    ["Gi", 1024 ** 3],
    ["Ti", 1024 ** 4],
    ["K", 1000],
    ["M", 1000 ** 2],
    ["G", 1000 ** 3],
    ["T", 1000 ** 4],
  ];
  for (const [suffix, multiplier] of units) {
    if (!raw.endsWith(suffix)) continue;
    const parsed = Number(raw.slice(0, -suffix.length));
    return Number.isFinite(parsed) ? parsed * multiplier : null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function containerResource(container: JsonObject, section: "requests" | "limits", resource: "cpu" | "memory"): number | null {
  const resources = record(container.resources);
  const values = record(resources[section]);
  return resource === "cpu" ? cpuMillicores(values.cpu) : memoryBytes(values.memory);
}

function effectivePodResource(spec: JsonObject, section: "requests" | "limits", resource: "cpu" | "memory"): number | null {
  const containers = records(spec.containers);
  const regularValues = containers.map((container) => containerResource(container, section, resource));
  if (section === "limits" && regularValues.some((value) => value === null)) return null;
  const regularTotal = regularValues.reduce<number>((total, value) => total + (value ?? 0), 0);
  const initMaximum = records(spec.initContainers).reduce((maximum, container) => Math.max(maximum, containerResource(container, section, resource) ?? 0), 0);
  const overhead = resource === "cpu" ? cpuMillicores(record(spec.overhead).cpu) : memoryBytes(record(spec.overhead).memory);
  return Math.max(regularTotal, initMaximum) + (overhead ?? 0);
}

export function meta(item: JsonObject): ResourceRow {
  const metadata = record(item.metadata);
  const labels = record(metadata.labels);
  return {
    uid: text(metadata.uid),
    name: text(metadata.name),
    namespace: text(metadata.namespace),
    createdAt: text(metadata.creationTimestamp),
    deletionTimestamp: text(metadata.deletionTimestamp),
    generation: numberValue(metadata.generation),
    labels,
    labelsText: Object.entries(labels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(", "),
    ownerReferences: records(metadata.ownerReferences),
  };
}

const NODE_LABEL_ALIASES: Record<string, { label: string; priority: number; stable?: string }> = {
  "node-role.kubernetes.io/control-plane": { label: "Role", priority: 1 },
  "node-role.kubernetes.io/master": { label: "Role", priority: 1 },
  "node-role.kubernetes.io/worker": { label: "Role", priority: 1 },
  "topology.kubernetes.io/region": { label: "Region", priority: 2 },
  "failure-domain.beta.kubernetes.io/region": { label: "Region", priority: 2, stable: "topology.kubernetes.io/region" },
  "topology.kubernetes.io/zone": { label: "Zone", priority: 3 },
  "failure-domain.beta.kubernetes.io/zone": { label: "Zone", priority: 3, stable: "topology.kubernetes.io/zone" },
  "node.kubernetes.io/instance-type": { label: "Type", priority: 4 },
  "beta.kubernetes.io/instance-type": { label: "Type", priority: 4, stable: "node.kubernetes.io/instance-type" },
  "kubernetes.io/os": { label: "OS", priority: 5 },
  "beta.kubernetes.io/os": { label: "OS", priority: 5, stable: "kubernetes.io/os" },
  "kubernetes.io/arch": { label: "Arch", priority: 6 },
  "beta.kubernetes.io/arch": { label: "Arch", priority: 6, stable: "kubernetes.io/arch" },
  "kubernetes.io/hostname": { label: "Hostname", priority: 7 },
};

export interface NodeLabelItem {
  key: string;
  label: string;
  value: string;
  full: string;
  priority: number;
}

export function nodeLabelItems(labelsValue: unknown, nodeName: string): NodeLabelItem[] {
  const labels = record(labelsValue);
  const suffixCounts = new Map<string, number>();
  for (const key of Object.keys(labels)) {
    const suffix = key.split("/").at(-1) ?? key;
    suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
  }

  return Object.entries(labels)
    .filter(([key, value]) => {
      const alias = NODE_LABEL_ALIASES[key];
      if (alias?.stable && labels[alias.stable] === value) return false;
      return !(key === "kubernetes.io/hostname" && String(value) === nodeName);
    })
    .map(([key, value]) => {
      const raw = String(value);
      const alias = NODE_LABEL_ALIASES[key];
      const suffix = key.split("/").at(-1) ?? key;
      const role = key.startsWith("node-role.kubernetes.io/") ? suffix : "";
      return {
        key,
        label: alias?.label ?? (suffixCounts.get(suffix) === 1 ? suffix : key),
        value: raw || role,
        full: raw ? `${key}=${raw}` : key,
        priority: alias?.priority ?? 100,
      };
    })
    .sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key));
}

type WorkloadConditionItem = {
  type: string;
  label: string;
  status: string;
  reason: string;
  message: string;
  tone: "success" | "info" | "warning" | "danger" | "neutral";
  lastUpdateTime: string;
  lastTransitionTime: string;
};

const WORKLOAD_CONDITION_PRIORITY: Record<string, number> = {
  Terminating: 1,
  ReplicaFailure: 2,
  ProgressDeadlineExceeded: 2,
  Unavailable: 3,
  Available: 4,
  Progressing: 5,
};

export function workloadConditionItems(item: JsonObject): WorkloadConditionItem[] {
  const metadata = record(item.metadata);
  const spec = record(item.spec);
  const status = record(item.status);
  const result: WorkloadConditionItem[] = [];
  if (metadata.deletionTimestamp) {
    result.push({ type: "Terminating", label: "Terminating", status: "True", reason: "", message: "", tone: "warning", lastUpdateTime: "", lastTransitionTime: "" });
  }
  for (const condition of records(status.conditions)) {
    const type = text(condition.type);
    const conditionStatus = text(condition.status);
    const reason = text(condition.reason);
    let label = type;
    let tone: WorkloadConditionItem["tone"] = "neutral";
    if (conditionStatus === "True") {
      tone = type === "Available" ? "success" : type === "Progressing" ? "info" : type === "ReplicaFailure" ? "danger" : "neutral";
    } else if (type === "Progressing" && reason === "ProgressDeadlineExceeded") {
      label = reason;
      tone = "danger";
    } else if (type === "Available" && conditionStatus === "False") {
      label = "Unavailable";
      tone = "danger";
    } else if (conditionStatus !== "Unknown") {
      continue;
    }
    result.push({
      type,
      label,
      status: conditionStatus,
      reason,
      message: text(condition.message),
      tone,
      lastUpdateTime: text(condition.lastUpdateTime),
      lastTransitionTime: text(condition.lastTransitionTime),
    });
  }
  if (!result.length) {
    const desired = Math.trunc(numberValue(spec.replicas));
    const ready = Math.trunc(numberValue(status.readyReplicas));
    const available = Math.trunc(numberValue(status.availableReplicas));
    const label = desired === 0 ? "Scaled to zero" : desired > 0 && ready >= desired && available >= desired ? "Available" : Object.keys(status).length ? "Progressing" : "Unknown";
    result.push({
      type: label,
      label,
      status: "Unknown",
      reason: "",
      message: "",
      tone: label === "Available" ? "success" : label === "Progressing" ? "info" : "neutral",
      lastUpdateTime: "",
      lastTransitionTime: "",
    });
  }
  return result
    .filter((condition, index, items) => items.findIndex((item) => item.label === condition.label) === index)
    .sort((left, right) => (WORKLOAD_CONDITION_PRIORITY[left.label] ?? 100) - (WORKLOAD_CONDITION_PRIORITY[right.label] ?? 100) || left.label.localeCompare(right.label));
}

function formatContainerPorts(containers: JsonObject[]): string {
  const ports: string[] = [];

  for (const container of containers) {
    for (const port of records(container.ports)) {
      const containerPort = port.containerPort;
      if (containerPort === undefined || containerPort === null || containerPort === "") {
        continue;
      }

      const protocol = text(port.protocol, "TCP");
      const name = text(port.name);
      const label = `${String(containerPort)}/${protocol}`;
      ports.push(name ? `${label} (${name})` : label);
    }
  }

  return ports.join(", ");
}

export interface RestartDiagnostic {
  container: string;
  restartCount: number;
  ready: boolean;
  currentState: string;
  currentReason: string;
  currentMessage: string;
  lastReason: string;
  lastExitCode: unknown;
  lastSignal: unknown;
  lastStartedAt: string;
  lastFinishedAt: string;
  lastMessage: string;
}

export function podRestartDiagnostics(containerStatuses: JsonObject[]): RestartDiagnostic[] {
  const diagnostics: RestartDiagnostic[] = [];

  for (const container of containerStatuses) {
    const restartCount = Math.trunc(numberValue(container.restartCount));
    const state = record(container.state);
    const waiting = record(state.waiting);
    const running = record(state.running);
    const terminated = record(state.terminated);
    const lastState = record(container.lastState);
    const lastTerminated = record(lastState.terminated);

    let currentState = "";
    if (Object.keys(waiting).length > 0) currentState = "waiting";
    else if (Object.keys(terminated).length > 0) currentState = "terminated";
    else if (Object.keys(running).length > 0) currentState = "running";

    if (restartCount === 0 && Object.keys(lastTerminated).length === 0 && Object.keys(waiting).length === 0 && Object.keys(terminated).length === 0) {
      continue;
    }

    diagnostics.push({
      container: text(container.name),
      restartCount,
      ready: container.ready === true,
      currentState,
      currentReason: text(waiting.reason) || text(terminated.reason),
      currentMessage: text(waiting.message) || text(terminated.message),
      lastReason: text(lastTerminated.reason),
      lastExitCode: lastTerminated.exitCode ?? "",
      lastSignal: lastTerminated.signal ?? "",
      lastStartedAt: text(lastTerminated.startedAt),
      lastFinishedAt: text(lastTerminated.finishedAt),
      lastMessage: text(lastTerminated.message),
    });
  }

  return diagnostics;
}

function containerStateSummary(containerName: string, status: JsonObject | undefined): JsonObject {
  const state = record(status?.state);
  const waiting = record(state.waiting);
  const running = record(state.running);
  const terminated = record(state.terminated);
  const ready = status?.ready === true;

  let currentState = "unknown";
  if (Object.keys(waiting).length > 0) currentState = "waiting";
  else if (Object.keys(terminated).length > 0) currentState = "terminated";
  else if (Object.keys(running).length > 0) currentState = ready ? "ready" : "running";
  else if (ready) currentState = "ready";

  return {
    name: containerName,
    ready,
    state: currentState,
    reason: text(waiting.reason) || text(terminated.reason),
    message: text(waiting.message) || text(terminated.message),
    restartCount: Math.trunc(numberValue(status?.restartCount)),
  };
}

function firstRestartDiagnosticValue(diagnostics: RestartDiagnostic[], key: keyof RestartDiagnostic): unknown {
  for (const diagnostic of diagnostics) {
    const value = diagnostic[key];
    if (diagnostic.restartCount > 0 && value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  for (const diagnostic of diagnostics) {
    const value = diagnostic[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return "";
}

export function podSummary(item: JsonObject): ResourceRow {
  const status = record(item.status);
  const spec = record(item.spec);
  const containerStatuses = records(status.containerStatuses);
  const specContainers = records(spec.containers);
  const containerStatusByName = new Map(containerStatuses.map((container) => [text(container.name), container]));
  const restarts = containerStatuses.reduce((total, container) => total + Math.trunc(numberValue(container.restartCount)), 0);
  const restartDiagnostics = podRestartDiagnostics(containerStatuses);
  const ready = containerStatuses.filter((container) => container.ready === true).length;
  const desiredContainers = Math.max(containerStatuses.length, specContainers.length);

  const containerStates: JsonObject[] = [];
  const seenContainers = new Set<string>();
  for (const container of specContainers) {
    const name = text(container.name);
    if (!name) continue;
    seenContainers.add(name);
    containerStates.push(containerStateSummary(name, containerStatusByName.get(name)));
    const image = text(container.image);
    if (image) containerStates[containerStates.length - 1].image = image;
  }
  for (const container of containerStatuses) {
    const name = text(container.name);
    if (!name || seenContainers.has(name)) continue;
    containerStates.push(containerStateSummary(name, container));
  }

  const containerProblems: string[] = [];
  for (const container of containerStatuses) {
    const state = record(container.state);
    const waiting = record(state.waiting);
    const terminated = record(state.terminated);
    const reason = text(waiting.reason) || text(terminated.reason);
    const message = text(waiting.message) || text(terminated.message);
    if (reason || message) {
      containerProblems.push(`${text(container.name)}: ${reason} ${message}`.trim());
    }
  }

  const conditionSummary: string[] = [];
  for (const condition of records(status.conditions)) {
    if (condition.status !== "True") {
      conditionSummary.push(`${text(condition.type)}=${text(condition.status)} ${text(condition.reason)} ${text(condition.message)}`.trim());
    }
  }

  const base = meta(item);
  const deleting = Boolean(base.deletionTimestamp);
  const podCpuRequestValue = effectivePodResource(spec, "requests", "cpu");
  const podCpuLimitValue = effectivePodResource(spec, "limits", "cpu");
  const podMemoryRequestValue = effectivePodResource(spec, "requests", "memory");
  const podMemoryLimitValue = effectivePodResource(spec, "limits", "memory");
  return {
    ...base,
    phase: deleting ? "Terminating" : text(status.phase),
    status: deleting ? "Terminating" : text(status.phase),
    ready: `${ready}/${desiredContainers}`,
    restarts,
    node: text(spec.nodeName),
    serviceAccountName: text(spec.serviceAccountName, "default"),
    podIp: text(status.podIP),
    reason: text(status.reason),
    statusMessage: text(status.message),
    containerProblems: containerProblems.join("; "),
    conditions: conditionSummary.join("; "),
    containers: specContainers.map((container) => text(container.name)).filter(Boolean),
    containerStates,
    restartDiagnostics,
    lastRestartReason: firstRestartDiagnosticValue(restartDiagnostics, "lastReason"),
    lastRestartExitCode: firstRestartDiagnosticValue(restartDiagnostics, "lastExitCode"),
    lastRestartFinishedAt: firstRestartDiagnosticValue(restartDiagnostics, "lastFinishedAt"),
    ports: formatContainerPorts(specContainers),
    cpuUsage: "",
    memoryUsage: "",
    podCpuRequestValue,
    podCpuLimitValue,
    podMemoryRequestValue,
    podMemoryLimitValue,
  };
}

function formatSubjects(subjects: JsonObject[]): string {
  return subjects
    .map((subject) => {
      const kind = text(subject.kind);
      const namespace = text(subject.namespace);
      const name = text(subject.name);
      return `${kind}/${namespace ? `${namespace}/` : ""}${name}`.replace(/^\/|\/$/g, "");
    })
    .join(", ");
}

function formatPolicyRules(rules: JsonObject[]): string {
  return rules
    .map((rule) => {
      const verbs = strings(rule.verbs).join(",");
      const resources = strings(rule.resources).join(",");
      const apiGroups = strings(rule.apiGroups).join(",");
      return `${verbs} ${apiGroups}/${resources}`.trim();
    })
    .join("; ");
}

export function serviceAccountSummary(item: JsonObject): ResourceRow {
  const secrets = records(item.secrets);
  const imagePullSecrets = records(item.imagePullSecrets);
  return {
    ...meta(item),
    secrets: secrets
      .map((secret) => text(secret.name))
      .filter(Boolean)
      .join(", "),
    imagePullSecrets: imagePullSecrets
      .map((secret) => text(secret.name))
      .filter(Boolean)
      .join(", "),
  };
}

export function roleSummary(item: JsonObject): ResourceRow {
  const rules = records(item.rules);
  return {
    ...meta(item),
    rules,
    rulesText: formatPolicyRules(rules),
  };
}

export function roleBindingSummary(item: JsonObject): ResourceRow {
  const subjects = records(item.subjects);
  const roleRef = record(item.roleRef);
  return {
    ...meta(item),
    subjects,
    subjectsText: formatSubjects(subjects),
    roleRef,
    roleRefKind: text(roleRef.kind),
    roleRefName: text(roleRef.name),
  };
}

export function deploymentSummary(item: JsonObject): ResourceRow {
  const status = record(item.status);
  const spec = record(item.spec);
  const template = record(spec.template);
  const podSpec = record(template.spec);
  const workloadConditions = workloadConditionItems(item);
  const desired = Math.trunc(numberValue(spec.replicas));
  const ready = Math.trunc(numberValue(status.readyReplicas));
  const updated = Math.trunc(numberValue(status.updatedReplicas));
  const available = Math.trunc(numberValue(status.availableReplicas));
  return {
    ...meta(item),
    ready: `${ready}/${desired}`,
    desired,
    current: Math.trunc(numberValue(status.replicas ?? status.currentReplicas)),
    updated,
    available,
    unavailable: Math.trunc(numberValue(status.unavailableReplicas)),
    observedGeneration: Math.trunc(numberValue(status.observedGeneration)),
    images: records(podSpec.containers)
      .map((container) => text(container.image))
      .filter(Boolean)
      .join(", "),
    workloadConditions,
    workloadConditionsText: workloadConditions.map((condition) => `${condition.label} ${condition.reason} ${condition.message}`.trim()).join("; "),
    status: workloadConditions.map((condition) => condition.label).join(", "),
    conditions: workloadConditions
      .filter((condition) => condition.tone === "danger" || condition.tone === "warning")
      .map((condition) => `${condition.label}: ${condition.reason} ${condition.message}`.trim())
      .join("; "),
  };
}

export function serviceSummary(item: JsonObject): ResourceRow {
  const spec = record(item.spec);
  const ports = records(spec.ports);
  const selector = record(spec.selector);
  return {
    ...meta(item),
    type: text(spec.type),
    clusterIp: text(spec.clusterIP),
    ports: ports
      .map((port) => {
        const name = text(port.name);
        const source = String(port.port ?? "");
        const target = String(port.targetPort ?? source);
        const protocol = text(port.protocol, "TCP");
        return `${name ? `${name} · ` : ""}${source} → ${target}/${protocol}`;
      })
      .filter(Boolean)
      .join(", "),
    selector,
    selectorText: Object.entries(selector)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(", "),
  };
}

function serviceNameFromBackend(backend: JsonObject): string {
  const service = record(backend.service);
  return text(service.name) || text(backend.serviceName);
}

function ingressBackendServices(spec: JsonObject): string[] {
  const names: string[] = [];
  const defaultName = serviceNameFromBackend(record(spec.defaultBackend));
  if (defaultName) names.push(defaultName);

  for (const rule of records(spec.rules)) {
    const http = record(rule.http);
    for (const path of records(http.paths)) {
      const backendName = serviceNameFromBackend(record(path.backend));
      if (backendName) names.push(backendName);
    }
  }

  return names;
}

export function ingressSummary(item: JsonObject): ResourceRow {
  const spec = record(item.spec);
  const status = record(item.status);
  const loadBalancer = record(status.loadBalancer);
  const services = [...new Set(ingressBackendServices(spec))].sort();
  return {
    ...meta(item),
    kind: text(item.kind, "Ingress"),
    className: text(spec.ingressClassName),
    hosts: records(spec.rules)
      .map((rule) => text(rule.host))
      .filter(Boolean)
      .join(", "),
    backendServices: services,
    backendServicesText: services.join(", "),
    routes: records(spec.rules)
      .flatMap((rule) => records(record(rule.http).paths).map((path) => `${text(rule.host) || "*"}${text(path.path, "/")} → ${serviceNameFromBackend(record(path.backend))}`))
      .join(", "),
    tlsHosts: records(spec.tls)
      .flatMap((tls) => strings(tls.hosts))
      .join(", "),
    addressesText: records(loadBalancer.ingress)
      .map((address) => text(address.ip) || text(address.hostname))
      .filter(Boolean)
      .join(", "),
  };
}

export function keyValueSummary(item: JsonObject): ResourceRow {
  const data = record(item.data);
  const stringData = record(item.stringData);
  const keys = Array.from(new Set([...Object.keys(data), ...Object.keys(stringData)])).sort();
  return {
    ...meta(item),
    kind: text(item.kind),
    type: text(item.type),
    immutable: item.immutable === true,
    keyCount: keys.length,
    keyNames: keys.join(", "),
  };
}

export function jobSummary(item: JsonObject): ResourceRow {
  const spec = record(item.spec);
  const status = record(item.status);
  return {
    ...meta(item),
    status: numberValue(status.failed) > 0 ? "Failed" : numberValue(status.active) > 0 ? "Running" : numberValue(status.succeeded) > 0 ? "Succeeded" : "Pending",
    active: Math.trunc(numberValue(status.active)),
    succeeded: Math.trunc(numberValue(status.succeeded)),
    failed: Math.trunc(numberValue(status.failed)),
    completions: spec.completions,
    schedule: spec.schedule,
    lastScheduleTime: text(status.lastScheduleTime),
  };
}

export function storageSummary(item: JsonObject): ResourceRow {
  const spec = record(item.spec);
  const status = record(item.status);
  const resources = record(spec.resources);
  const requests = record(resources.requests);
  const claimRef = record(spec.claimRef);
  return {
    ...meta(item),
    status: text(status.phase),
    capacity: String(record(status.capacity).storage ?? record(spec.capacity).storage ?? requests.storage ?? ""),
    accessModes: strings(spec.accessModes).join(", "),
    storageClassName: text(spec.storageClassName),
    volumeName: text(spec.volumeName),
    claim: [text(claimRef.namespace), text(claimRef.name)].filter(Boolean).join("/"),
    reclaimPolicy: text(spec.persistentVolumeReclaimPolicy) || text(item.reclaimPolicy),
    provisioner: text(item.provisioner),
    volumeBindingMode: text(item.volumeBindingMode),
    allowVolumeExpansion: item.allowVolumeExpansion,
  };
}

export function crdSummary(item: JsonObject): ResourceRow {
  const spec = record(item.spec);
  const names = record(spec.names);
  const servedVersions = records(spec.versions)
    .filter((version) => version.served === true)
    .map((version) => text(version.name))
    .filter(Boolean);
  const plural = text(names.plural);
  const group = text(spec.group);

  return {
    ...meta(item),
    kind: text(names.kind),
    plural,
    singular: text(names.singular),
    shortNames: strings(names.shortNames).join(", "),
    group,
    scope: text(spec.scope),
    versions: servedVersions.join(", "),
    resourceName: `${plural}.${group}`.replace(/^\./, "").replace(/\.$/, ""),
  };
}

export function eventSummary(item: JsonObject): ResourceRow {
  const base = meta(item);
  const involved = record(item.involvedObject);
  const series = record(item.series);
  const source = record(item.source);
  const eventTime = text(item.lastTimestamp) || text(item.eventTime) || text(item.firstTimestamp) || text(base.createdAt);

  return {
    ...base,
    type: text(item.type),
    reason: text(item.reason),
    message: text(item.message),
    object: `${text(involved.kind)}/${text(involved.name)}`,
    involvedKind: text(involved.kind),
    involvedName: text(involved.name),
    involvedNamespace: text(involved.namespace) || text(base.namespace),
    involvedApiVersion: text(involved.apiVersion),
    count: item.count ?? series.count ?? 1,
    source: text(source.component) || text(item.reportingController),
    createdAt: eventTime,
    lastTimestamp: eventTime,
  };
}

function formatBytesQuantity(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const suffixes: Array<[string, number]> = [
    ["Ki", 1024],
    ["Mi", 1024 ** 2],
    ["Gi", 1024 ** 3],
    ["Ti", 1024 ** 4],
  ];

  for (const [suffix, multiplier] of suffixes) {
    if (raw.endsWith(suffix)) {
      const numeric = Number(raw.slice(0, -suffix.length));
      return Number.isFinite(numeric) ? `${((numeric * multiplier) / 1024 ** 3).toFixed(2)} GiB` : raw;
    }
  }

  if (/^\d+$/.test(raw)) {
    return `${(Number(raw) / 1024 ** 3).toFixed(2)} GiB`;
  }

  return raw;
}

export function nodeSummary(item: JsonObject): ResourceRow {
  const status = record(item.status);
  const spec = record(item.spec);
  const capacity = record(status.capacity);
  const allocatable = record(status.allocatable);
  const nodeInfo = record(status.nodeInfo);
  const addresses = records(status.addresses);
  const addressByType = new Map<string, string>();

  for (const address of addresses) {
    const value = text(address.address);
    if (value) addressByType.set(text(address.type), value);
  }

  const conditions = records(status.conditions);
  const ready = conditions.find((condition) => condition.type === "Ready") ?? {};
  const pressure = conditions
    .filter((condition) => condition.type !== "Ready" && condition.status === "True")
    .map((condition) => `${text(condition.type)}: ${text(condition.reason)} ${text(condition.message)}`.trim());
  const labels = record(record(item.metadata).labels);
  const displayLabels = nodeLabelItems(labels, text(record(item.metadata).name));

  return {
    ...meta(item),
    status: (ready.status === "True" ? "Ready" : "NotReady") + (spec.unschedulable === true ? ", SchedulingDisabled" : ""),
    unschedulable: spec.unschedulable === true,
    internalIp: addressByType.get("InternalIP") ?? "",
    externalIp: addressByType.get("ExternalIP") ?? "",
    hostname: addressByType.get("Hostname") ?? "",
    addresses,
    os: text(nodeInfo.operatingSystem),
    osImage: text(nodeInfo.osImage),
    kernelVersion: text(nodeInfo.kernelVersion),
    architecture: text(nodeInfo.architecture),
    containerRuntime: text(nodeInfo.containerRuntimeVersion),
    kubeletVersion: text(nodeInfo.kubeletVersion),
    cpuCapacity: String(capacity.cpu ?? ""),
    memoryCapacity: formatBytesQuantity(capacity.memory),
    podsCapacity: String(capacity.pods ?? ""),
    cpuAllocatable: String(allocatable.cpu ?? ""),
    memoryAllocatable: formatBytesQuantity(allocatable.memory),
    podsAllocatable: String(allocatable.pods ?? ""),
    diskCapacity: formatBytesQuantity(capacity["ephemeral-storage"]),
    diskAllocatable: formatBytesQuantity(allocatable["ephemeral-storage"]),
    cpuAllocatableRaw: String(allocatable.cpu ?? ""),
    memoryAllocatableRaw: String(allocatable.memory ?? ""),
    diskAllocatableRaw: String(allocatable["ephemeral-storage"] ?? ""),
    pressure: pressure.join("; "),
    nodeLabelItems: displayLabels,
    nodeLabelsSearch: displayLabels.map((label) => `${label.full} ${label.label} ${label.value}`.trim()).join(" "),
  };
}

export function genericSummary(item: JsonObject): ResourceRow {
  const base = meta(item);
  const status = record(item.status);
  const spec = record(item.spec);
  const conditions = records(status.conditions);
  const lastCondition = conditions.at(-1) ?? {};

  return {
    ...base,
    apiVersion: text(item.apiVersion),
    kind: text(item.kind),
    status: text(status.phase) || (Object.keys(status).length > 0 ? text(lastCondition.type) : ""),
    type: text(spec.type),
  };
}

export function resourceQuotaSummary(item: JsonObject): ResourceRow {
  const spec = record(item.spec);
  const status = record(item.status);
  const hard = record(status.hard);
  const used = record(status.used);
  const resources = Array.from(new Set([...Object.keys(hard), ...Object.keys(used)])).sort();
  return {
    ...meta(item),
    apiVersion: text(item.apiVersion),
    kind: text(item.kind, "ResourceQuota"),
    status: resources.length ? "Active" : "Pending",
    quotaUsage: resources.map((resource) => ({ resource, used: String(used[resource] ?? "0"), hard: String(hard[resource] ?? "") })),
    scopes: strings(spec.scopes),
    scopeSelector: record(spec.scopeSelector),
  };
}

const NORMALIZERS: Record<string, (item: JsonObject) => ResourceRow> = {
  pods: podSummary,
  pod: podSummary,
  deployments: deploymentSummary,
  deployment: deploymentSummary,
  "deployments.apps": deploymentSummary,
  "deployment.apps": deploymentSummary,
  statefulsets: deploymentSummary,
  statefulset: deploymentSummary,
  daemonsets: deploymentSummary,
  daemonset: deploymentSummary,
  replicasets: deploymentSummary,
  replicaset: deploymentSummary,
  jobs: jobSummary,
  job: jobSummary,
  cronjobs: jobSummary,
  cronjob: jobSummary,
  services: serviceSummary,
  service: serviceSummary,
  svc: serviceSummary,
  ingresses: ingressSummary,
  ingress: ingressSummary,
  "ingresses.networking.k8s.io": ingressSummary,
  "ingress.networking.k8s.io": ingressSummary,
  customresourcedefinitions: crdSummary,
  customresourcedefinition: crdSummary,
  "customresourcedefinitions.apiextensions.k8s.io": crdSummary,
  "customresourcedefinition.apiextensions.k8s.io": crdSummary,
  crd: crdSummary,
  crds: crdSummary,
  events: eventSummary,
  event: eventSummary,
  nodes: nodeSummary,
  node: nodeSummary,
  serviceaccounts: serviceAccountSummary,
  serviceaccount: serviceAccountSummary,
  sa: serviceAccountSummary,
  roles: roleSummary,
  role: roleSummary,
  clusterroles: roleSummary,
  clusterrole: roleSummary,
  rolebindings: roleBindingSummary,
  rolebinding: roleBindingSummary,
  clusterrolebindings: roleBindingSummary,
  clusterrolebinding: roleBindingSummary,
  resourcequotas: resourceQuotaSummary,
  resourcequota: resourceQuotaSummary,
  configmaps: keyValueSummary,
  configmap: keyValueSummary,
  secrets: keyValueSummary,
  secret: keyValueSummary,
  persistentvolumeclaims: storageSummary,
  persistentvolumeclaim: storageSummary,
  persistentvolumes: storageSummary,
  persistentvolume: storageSummary,
  storageclasses: storageSummary,
  storageclass: storageSummary,
};

export function normalizerForResource(resource: string): (item: JsonObject) => ResourceRow {
  return NORMALIZERS[resource.trim().toLowerCase()] ?? genericSummary;
}

export function normalizeResourceItems(resource: string, items: unknown[]): ResourceRow[] {
  const normalizedResource = resource.trim().toLowerCase();
  const normalizer = normalizerForResource(normalizedResource);
  const crdInstance = !Object.prototype.hasOwnProperty.call(NORMALIZERS, normalizedResource) && normalizedResource.includes(".");

  return items.filter(isRecord).map((item) => {
    const summary = normalizer(item);
    if (crdInstance) {
      summary.crdInstance = true;
      summary.resource = normalizedResource;
      if (!summary.apiVersion) summary.apiVersion = text(item.apiVersion);
    }
    return summary;
  });
}
