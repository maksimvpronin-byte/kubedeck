export type KubernetesStatusTone = "success" | "pending" | "danger" | "neutral";

const FAILURE = /crashloopbackoff|imagepullbackoff|errimagepull|createcontainererror|runcontainererror|oomkilled|evicted|deadlineexceeded|failed|error|notready|unavailable/;
const PENDING = /pending|containercreating|podinitializing|terminating|progressing|reconciling|scaling|updating|waiting/;
const SUCCESS = /ready|available|succeeded|complete|completed|bound|active/;

export function kubernetesStatusTone(row: Record<string, unknown>): KubernetesStatusTone {
  const phase = String(row.deletionTimestamp ? "Terminating" : row.phase || row.status || "").toLowerCase();
  const reason = String(row.reason || row.statusReason || row.containerProblems || "").toLowerCase();
  const combined = `${phase} ${reason}`;

  if (PENDING.test(phase)) return "pending";
  if (isKubernetesFailure(combined)) return "danger";
  if (phase === "running") return isReady(row.ready) ? "success" : "pending";
  if (SUCCESS.test(phase)) return "success";
  return "neutral";
}

export function isKubernetesFailure(value: unknown): boolean {
  return FAILURE.test(String(value ?? "").toLowerCase());
}

function isReady(value: unknown): boolean {
  if (value === true) return true;
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (text === "true") return true;
  const fraction = text.match(/^(\d+)\/(\d+)$/);
  return Boolean(fraction && Number(fraction[2]) > 0 && fraction[1] === fraction[2]);
}
