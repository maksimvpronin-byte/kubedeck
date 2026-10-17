import type { ResourceRow } from "../types";

// Labels kubelet writes from what it finds on the machine and writes again at
// every registration. Changing one by hand is undone by the node itself, and
// meanwhile a scheduler acts on a value that is not true, so they are shown
// nowhere for editing. The gateway refuses them as well.
export const PROTECTED_NODE_LABELS = new Set([
  "kubernetes.io/hostname",
  "kubernetes.io/os",
  "kubernetes.io/arch",
  "beta.kubernetes.io/os",
  "beta.kubernetes.io/arch",
  "beta.kubernetes.io/instance-type",
  "node.kubernetes.io/instance-type",
]);

const PREFIX_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const NAME_PATTERN = /^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;
const MAX_PREFIX_LENGTH = 253;
const MAX_NAME_LENGTH = 63;

export type NodeLabelKeyProblem = "empty" | "slash" | "prefix" | "name" | "protected";
export type NodeLabelValueProblem = "value";

export interface NodeLabelChanges {
  set: Record<string, string>;
  remove: string[];
}

export type NodeLabelOperation = { kind: "add"; key: string; value: string } | { kind: "change"; key: string; value: string; from: string } | { kind: "remove"; key: string };

export interface NodeLabelPlanEntry {
  row: ResourceRow;
  changes: NodeLabelChanges;
  operations: NodeLabelOperation[];
}

export interface NodeLabelStat {
  key: string;
  count: number;
  values: Array<{ value: string; count: number }>;
}

export function isProtectedNodeLabel(key: string) {
  return PROTECTED_NODE_LABELS.has(key);
}

// Roles, topology and the rest under a Kubernetes domain can be changed, but
// the scheduler and the network plugins read them, so they sit apart.
export function isSystemNodeLabel(key: string) {
  const slash = key.indexOf("/");
  if (slash < 0) return false;
  const prefix = key.slice(0, slash);
  return /(^|\.)(kubernetes\.io|k8s\.io)$/.test(prefix);
}

export function nodeLabelKeyProblem(key: string): NodeLabelKeyProblem | null {
  if (!key) return "empty";
  const parts = key.split("/");
  if (parts.length > 2) return "slash";
  const [prefix, name] = parts.length === 2 ? parts : [null, parts[0]];
  if (prefix !== null && (!prefix || prefix.length > MAX_PREFIX_LENGTH || !PREFIX_PATTERN.test(prefix))) return "prefix";
  if (!name || name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) return "name";
  if (isProtectedNodeLabel(key)) return "protected";
  return null;
}

export function nodeLabelValueProblem(value: string): NodeLabelValueProblem | null {
  if (value === "") return null;
  return value.length <= MAX_NAME_LENGTH && NAME_PATTERN.test(value) ? null : "value";
}

export function nodeRowLabels(row: ResourceRow): Record<string, string> {
  const labels = row.labels;
  if (!labels || typeof labels !== "object") return {};
  return Object.fromEntries(Object.entries(labels as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]));
}

// Every label the selected nodes carry, with how many of them carry it and
// with which values, so the person can see what "set" is about to overwrite.
export function nodeLabelStats(rows: ResourceRow[]): NodeLabelStat[] {
  const stats = new Map<string, Map<string, number>>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(nodeRowLabels(row))) {
      if (isProtectedNodeLabel(key)) continue;
      const values = stats.get(key) ?? new Map<string, number>();
      values.set(value, (values.get(value) ?? 0) + 1);
      stats.set(key, values);
    }
  }
  return [...stats.entries()]
    .map(([key, values]) => ({
      key,
      count: [...values.values()].reduce((sum, count) => sum + count, 0),
      values: [...values.entries()].map(([value, count]) => ({ value, count })).sort((left, right) => right.count - left.count || left.value.localeCompare(right.value)),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

// What each node actually needs: a label it already has with the same value is
// not sent, and neither is the removal of a label it does not have. A node left
// with nothing to do is not touched at all.
export function planNodeLabelChanges(rows: ResourceRow[], changes: NodeLabelChanges): NodeLabelPlanEntry[] {
  const setEntries = Object.entries(changes.set).sort(([left], [right]) => left.localeCompare(right));
  const removals = [...new Set(changes.remove)].filter((key) => !(key in changes.set)).sort();
  return rows.map((row) => {
    const labels = nodeRowLabels(row);
    const operations: NodeLabelOperation[] = [];
    const set: Record<string, string> = {};
    for (const [key, value] of setEntries) {
      if (!(key in labels)) operations.push({ kind: "add", key, value });
      else if (labels[key] !== value) operations.push({ kind: "change", key, value, from: labels[key] });
      else continue;
      set[key] = value;
    }
    const remove = removals.filter((key) => key in labels);
    for (const key of remove) operations.push({ kind: "remove", key });
    return { row, changes: { set, remove }, operations };
  });
}

export function nodeLabelArgs(changes: NodeLabelChanges): string[] {
  const setArgs = Object.entries(changes.set).map(([key, value]) => `${key}=${value}`);
  return [...setArgs, ...changes.remove.map((key) => `${key}-`), ...(setArgs.length ? ["--overwrite"] : [])];
}

// The same commands the gateway builds, so the preview is what runs: nodes that
// get the same changes share one command.
export function nodeLabelCommandPreview(plan: NodeLabelPlanEntry[]): string {
  const groups = new Map<string, string[]>();
  for (const entry of plan) {
    if (!entry.operations.length) continue;
    const args = nodeLabelArgs(entry.changes).join(" ");
    groups.set(args, [...(groups.get(args) ?? []), String(entry.row.name)]);
  }
  return [...groups.entries()].map(([args, names]) => ["kubectl", "label", "nodes", ...names, args].join(" ")).join("\n");
}
