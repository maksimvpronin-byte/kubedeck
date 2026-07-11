import type { ResourceRow } from "../types";

const RESOURCE_BY_KIND: Record<string, string> = {
  Pod: "pods",
  ReplicaSet: "replicasets",
  Deployment: "deployments",
  StatefulSet: "statefulsets",
  DaemonSet: "daemonsets",
  Job: "jobs",
  CronJob: "cronjobs",
  Service: "services",
  ConfigMap: "configmaps",
  Secret: "secrets",
  ServiceAccount: "serviceaccounts",
  Role: "roles",
  RoleBinding: "rolebindings",
  ClusterRole: "clusterroles",
  ClusterRoleBinding: "clusterrolebindings",
  Node: "nodes",
  Ingress: "ingresses",
  Endpoints: "endpoints",
  EndpointSlice: "endpointslices",
  PersistentVolumeClaim: "persistentvolumeclaims",
  PersistentVolume: "persistentvolumes",
  StorageClass: "storageclasses",
  Namespace: "namespaces",
};

function readRowString(row: ResourceRow, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value);
}

export function eventInvolvedLocator(row: ResourceRow): ResourceRow | null {
  const [parsedKind = "", ...nameParts] = (readRowString(row, "object") || readRowString(row, "involvedObject")).split("/");
  const kind = readRowString(row, "involvedKind") || parsedKind;
  const name = readRowString(row, "involvedName") || nameParts.join("/");
  const resource = RESOURCE_BY_KIND[kind];
  if (!resource || !name) return null;
  const namespace = readRowString(row, "involvedNamespace") || readRowString(row, "namespace") || "_cluster";
  return { uid: `${resource}:${namespace}:${name}`, resource, kind, name, namespace };
}
