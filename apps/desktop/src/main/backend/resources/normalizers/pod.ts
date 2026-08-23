import { parseCpuMillicores, parseMemoryBytes } from "../quantity";
import { type JsonObject, meta, numberValue, record, records, type ResourceRow, text } from "./primitives";

function containerResource(container: JsonObject, section: "requests" | "limits", resource: "cpu" | "memory"): number | null {
  const resources = record(container.resources);
  const values = record(resources[section]);
  return resource === "cpu" ? parseCpuMillicores(values.cpu) : parseMemoryBytes(values.memory);
}

function effectivePodResource(spec: JsonObject, section: "requests" | "limits", resource: "cpu" | "memory"): number | null {
  const containers = records(spec.containers);
  const regularValues = containers.map((container) => containerResource(container, section, resource));
  if (section === "limits" && regularValues.some((value) => value === null)) return null;
  const regularTotal = regularValues.reduce<number>((total, value) => total + (value ?? 0), 0);
  const initMaximum = records(spec.initContainers).reduce((maximum, container) => Math.max(maximum, containerResource(container, section, resource) ?? 0), 0);
  const overhead = resource === "cpu" ? parseCpuMillicores(record(spec.overhead).cpu) : parseMemoryBytes(record(spec.overhead).memory);
  return Math.max(regularTotal, initMaximum) + (overhead ?? 0);
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
    nodeIp: text(status.hostIP),
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
