type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function records(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

export interface WorkloadKey {
  kind: string;
  name: string;
  // False when the key was inferred from the pod name because the owner chain
  // was not available. Inferred keys still group a workload's pods together,
  // but they are a guess and are reported as such.
  exact: boolean;
}

export function formatWorkloadKey(key: WorkloadKey | null): string {
  return key ? `${key.kind}/${key.name}` : "";
}

// A Deployment's pods are owned by a ReplicaSet whose name is the Deployment
// name plus the pod-template-hash, and that hash changes on every rollout.
// Keying history on the ReplicaSet would therefore reset the history at each
// redeploy - exactly when comparing before/after matters most - so the hash
// suffix is removed to recover the Deployment underneath.
function deploymentFromReplicaSet(replicaSetName: string, templateHash: string): string {
  if (!templateHash) return "";
  const suffix = `-${templateHash}`;
  return replicaSetName.endsWith(suffix) ? replicaSetName.slice(0, -suffix.length) : "";
}

// Falls back to the pod's own name when the owner chain is unknown: a sampler
// that only sees `kubectl top` output has no ownerReferences to work with.
// `web-7d9f8c6b5-2xk9p` -> Deployment web, `db-0` -> StatefulSet db.
export function inferWorkloadFromPodName(podName: string): WorkloadKey | null {
  const deployment = podName.match(/^(.+)-[a-z0-9]{5,10}-[a-z0-9]{5}$/);
  if (deployment) return { kind: "Deployment", name: deployment[1], exact: false };
  const stateful = podName.match(/^(.+)-\d+$/);
  if (stateful) return { kind: "StatefulSet", name: stateful[1], exact: false };
  const daemon = podName.match(/^(.+)-[a-z0-9]{5}$/);
  if (daemon) return { kind: "DaemonSet", name: daemon[1], exact: false };
  return null;
}

// `pod` is a normalized resource row or a raw manifest: both carry labels and
// ownerReferences, which is all this needs.
export function workloadKeyForPod(pod: JsonObject): WorkloadKey | null {
  const metadata = record(pod.metadata);
  const name = text(pod.name) || text(metadata.name);
  const labels = record(Object.keys(record(pod.labels)).length > 0 ? pod.labels : metadata.labels);
  const owners = records(pod.ownerReferences ?? metadata.ownerReferences);
  const owner = owners.find((candidate) => text(candidate.controller) === "true" || candidate.controller === true) ?? owners[0];
  const ownerKind = text(owner?.kind);
  const ownerName = text(owner?.name);

  if (ownerKind === "ReplicaSet" && ownerName) {
    const deployment = deploymentFromReplicaSet(ownerName, text(labels["pod-template-hash"]));
    if (deployment) return { kind: "Deployment", name: deployment, exact: true };
    return { kind: "ReplicaSet", name: ownerName, exact: true };
  }
  if (ownerKind === "Job" && ownerName) {
    // A CronJob's Jobs are named `<cronjob>-<timestamp>`, so the Job itself is
    // as ephemeral as a ReplicaSet.
    const cronJob = ownerName.match(/^(.+)-\d{8,10}$/);
    return cronJob ? { kind: "CronJob", name: cronJob[1], exact: true } : { kind: "Job", name: ownerName, exact: true };
  }
  if (ownerKind && ownerName) return { kind: ownerKind, name: ownerName, exact: true };

  return name ? inferWorkloadFromPodName(name) : null;
}
