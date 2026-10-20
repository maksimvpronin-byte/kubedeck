import { type JsonObject, meta, numberValue, record, records, type ResourceRow, text } from "./primitives";

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

interface ReplicaCounts {
  desired: number;
  ready: number;
  current: number;
  updated: number;
  available: number;
  unavailable: number;
}

// Deployments, StatefulSets and ReplicaSets count replicas; a DaemonSet counts
// scheduled nodes in fields of its own, and read through the replica names it
// came out as 0/0, "Scaled to zero", whatever it was running.
function replicaCounts(item: JsonObject): ReplicaCounts {
  const spec = record(item.spec);
  const status = record(item.status);
  const count = (value: unknown) => Math.trunc(numberValue(value));
  if (text(item.kind) === "DaemonSet" || "desiredNumberScheduled" in status) {
    return {
      desired: count(status.desiredNumberScheduled),
      ready: count(status.numberReady),
      current: count(status.currentNumberScheduled),
      updated: count(status.updatedNumberScheduled),
      available: count(status.numberAvailable),
      unavailable: count(status.numberUnavailable),
    };
  }
  return {
    desired: count(spec.replicas),
    ready: count(status.readyReplicas),
    current: count(status.replicas ?? status.currentReplicas),
    updated: count(status.updatedReplicas),
    available: count(status.availableReplicas),
    unavailable: count(status.unavailableReplicas),
  };
}

export function workloadConditionItems(item: JsonObject): WorkloadConditionItem[] {
  const metadata = record(item.metadata);
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
    const { desired, ready, available } = replicaCounts(item);
    const daemonSet = text(item.kind) === "DaemonSet" || "desiredNumberScheduled" in status;
    // A DaemonSet with nothing to run has no nodes to match, not a scale of zero.
    const label = desired === 0 && !daemonSet ? "Scaled to zero" : desired > 0 && ready >= desired && available >= desired ? "Available" : Object.keys(status).length ? "Progressing" : "Unknown";
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

export function deploymentSummary(item: JsonObject): ResourceRow {
  const status = record(item.status);
  const spec = record(item.spec);
  const template = record(spec.template);
  const podSpec = record(template.spec);
  const workloadConditions = workloadConditionItems(item);
  const { desired, ready, current, updated, available, unavailable } = replicaCounts(item);
  return {
    ...meta(item),
    ready: `${ready}/${desired}`,
    desired,
    current,
    updated,
    available,
    unavailable,
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

// List items from the API server carry no `kind`, so the resource they were
// listed as is written in before the shared summaries look at it.
export function daemonSetSummary(item: JsonObject): ResourceRow {
  return deploymentSummary({ ...item, kind: "DaemonSet" });
}

export function cronJobSummary(item: JsonObject): ResourceRow {
  return jobSummary({ ...item, kind: "CronJob" });
}

// A Job is finished only when a terminal condition says so: `failed` counts
// failed attempts, which a retry that then succeeds leaves above zero, and one
// succeeded pod of ten completions is not a finished Job.
function jobStatus(status: JsonObject): string {
  const terminal = records(status.conditions).find((condition) => text(condition.status) === "True" && ["Complete", "Failed", "SuccessCriteriaMet", "FailureTarget"].includes(text(condition.type)));
  if (terminal) return ["Failed", "FailureTarget"].includes(text(terminal.type)) ? "Failed" : "Succeeded";
  if (numberValue(status.active) > 0) return "Running";
  if (numberValue(status.failed) > 0) return "Failed";
  return numberValue(status.succeeded) > 0 ? "Succeeded" : "Pending";
}

export function jobSummary(item: JsonObject): ResourceRow {
  const spec = record(item.spec);
  const status = record(item.status);
  // A CronJob lists its running Jobs as references, not as a count.
  if (Array.isArray(status.active) || text(item.kind) === "CronJob") {
    const active = Array.isArray(status.active) ? status.active.length : 0;
    return {
      ...meta(item),
      status: spec.suspend === true ? "Suspended" : active > 0 ? "Running" : "Scheduled",
      active,
      schedule: spec.schedule,
      suspend: spec.suspend === true,
      lastScheduleTime: text(status.lastScheduleTime),
      lastSuccessfulTime: text(status.lastSuccessfulTime),
    };
  }
  return {
    ...meta(item),
    status: jobStatus(status),
    active: Math.trunc(numberValue(status.active)),
    succeeded: Math.trunc(numberValue(status.succeeded)),
    failed: Math.trunc(numberValue(status.failed)),
    completions: spec.completions,
    schedule: spec.schedule,
    lastScheduleTime: text(status.lastScheduleTime),
  };
}
