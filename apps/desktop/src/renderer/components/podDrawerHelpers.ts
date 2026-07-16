import type { ResourceRow } from "../types";

export function isAbortError(error: unknown) {
  return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError");
}

export function containerNames(row: ResourceRow) {
  return Array.isArray(row.containers) ? row.containers.map(String).filter(Boolean) : [];
}

export function displayResource(resource: string) {
  return resource
    .split(".")[0]
    .replace(/-/g, " ")
    .replace(/(^|\s)\S/g, (part) => part.toUpperCase());
}

export function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function eventTargetForOpen(event: ResourceRow) {
  const involved = eventInvolvedObject(event);
  const resource = involved.kind ? resourceForKind(involved.kind) : undefined;
  if (!resource || !involved.name) return null;
  return {
    resource,
    namespace: involved.namespace || "_cluster",
    name: involved.name,
  };
}

function eventInvolvedObject(event: ResourceRow) {
  const parsedObject = parseKindName(readRowString(event, "object"));
  const involvedKind = readRowString(event, "involvedKind") || parsedObject.kind;
  const involvedName = readRowString(event, "involvedName") || parsedObject.name;
  const involvedNamespace = readRowString(event, "involvedNamespace") || readRowString(event, "namespace") || "_cluster";
  const label = involvedKind && involvedName ? `${involvedKind}/${involvedName}` : readRowString(event, "object");
  return { kind: involvedKind, name: involvedName, namespace: involvedNamespace, label };
}

function parseKindName(value: string) {
  const [kind = "", ...nameParts] = value.split("/");
  return { kind, name: nameParts.join("/") };
}

function readRowString(row: ResourceRow, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

function resourceForKind(kind: unknown) {
  const map: Record<string, string> = {
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
  return map[String(kind ?? "")];
}
