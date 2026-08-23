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
