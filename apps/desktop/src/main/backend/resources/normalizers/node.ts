import { formatBytesIn } from "../../../../shared/formatQuantity";
import { parseMemoryBytes } from "../quantity";
import { type JsonObject, meta, record, records, type ResourceRow, text } from "./primitives";

const NODE_ROLE_PREFIX = "node-role.kubernetes.io/";

// The role of a node is carried by the suffix of a valueless label, and by the
// pre-1.16 spelling that some distributions still set. Both are read here so
// the table can show what kubectl shows in its ROLES column.
export function nodeRoles(labelsValue: unknown): string[] {
  const roles = new Set<string>();
  for (const [key, value] of Object.entries(record(labelsValue))) {
    if (key.startsWith(NODE_ROLE_PREFIX)) {
      const role = key.slice(NODE_ROLE_PREFIX.length).trim();
      if (role) roles.add(role);
    }
    if (key === "kubernetes.io/role" && String(value).trim()) roles.add(String(value).trim());
  }
  return [...roles].sort((left, right) => left.localeCompare(right));
}

export interface NodeAnnotationItem {
  key: string;
  value: string;
}

// The one annotation left out is the manifest kubectl stores on apply: it is
// the whole object again, it would dwarf everything beside it, and the YAML tab
// already shows it.
const HIDDEN_NODE_ANNOTATIONS = new Set(["kubectl.kubernetes.io/last-applied-configuration"]);

export function nodeAnnotationItems(annotationsValue: unknown): NodeAnnotationItem[] {
  return Object.entries(record(annotationsValue))
    .filter(([key]) => !HIDDEN_NODE_ANNOTATIONS.has(key))
    .map(([key, value]) => ({ key, value: String(value) }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

const NODE_LABEL_ALIASES: Record<string, { label: string; priority: number; stable?: string }> = {
  "topology.kubernetes.io/region": { label: "Region", priority: 20 },
  "failure-domain.beta.kubernetes.io/region": { label: "Region", priority: 20, stable: "topology.kubernetes.io/region" },
  "topology.kubernetes.io/zone": { label: "Zone", priority: 21 },
  "failure-domain.beta.kubernetes.io/zone": { label: "Zone", priority: 21, stable: "topology.kubernetes.io/zone" },
  "node.kubernetes.io/instance-type": { label: "Type", priority: 22 },
  "beta.kubernetes.io/instance-type": { label: "Type", priority: 22, stable: "node.kubernetes.io/instance-type" },
  "kubernetes.io/os": { label: "OS", priority: 30 },
  "beta.kubernetes.io/os": { label: "OS", priority: 30, stable: "kubernetes.io/os" },
  "kubernetes.io/arch": { label: "Arch", priority: 31 },
  "beta.kubernetes.io/arch": { label: "Arch", priority: 31, stable: "kubernetes.io/arch" },
  "kubernetes.io/hostname": { label: "Hostname", priority: 32 },
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
      // Roles have a column of their own, and the hostname is the row's name.
      if (key.startsWith(NODE_ROLE_PREFIX) || key === "kubernetes.io/role") return false;
      return !(key === "kubernetes.io/hostname" && String(value) === nodeName);
    })
    .map(([key, value]) => {
      const raw = String(value);
      const alias = NODE_LABEL_ALIASES[key];
      const suffix = key.split("/").at(-1) ?? key;
      return {
        key,
        label: alias?.label ?? (suffixCounts.get(suffix) === 1 ? suffix : key),
        value: raw,
        full: raw ? `${key}=${raw}` : key,
        // A label nobody aliased is one somebody in this cluster chose, and it
        // tells the nodes apart in a way "OS: linux" on every row never will.
        priority: alias?.priority ?? 10,
      };
    })
    .sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key));
}

// Always GiB, never the largest fitting unit: these are node capacity columns,
// and a column that mixes MiB and GiB down its length cannot be compared at a
// glance. The result is also parsed back by ResourceSummary, so it keeps the
// number-space-unit shape.
function formatBytesQuantity(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const bytes = parseMemoryBytes(raw);
  return bytes === null ? raw : formatBytesIn(bytes, "GiB", { fixed: true });
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
  const roles = nodeRoles(labels);
  const annotations = nodeAnnotationItems(record(item.metadata).annotations);

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
    taints: records(spec.taints),
    pressure: pressure.join("; "),
    roles: roles.join(", "),
    nodeAnnotationItems: annotations,
    nodeAnnotationsSearch: annotations.map((annotation) => `${annotation.key}=${annotation.value}`).join(" "),
    nodeLabelItems: displayLabels,
    nodeLabelsSearch: displayLabels.map((label) => `${label.full} ${label.label} ${label.value}`.trim()).join(" "),
  };
}
