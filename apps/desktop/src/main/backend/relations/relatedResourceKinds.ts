function singularKind(resource: string): string {
  let base = resource.split(".", 1)[0] ?? resource;
  if (base.endsWith("ies")) base = `${base.slice(0, -3)}y`;
  else if (base.endsWith("ses")) base = base.slice(0, -2);
  else if (base.endsWith("s")) base = base.slice(0, -1);
  return base
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

const KIND_BY_RESOURCE: Record<string, string> = {
  pod: "Pod",
  pods: "Pod",
  deployment: "Deployment",
  deployments: "Deployment",
  "deployments.apps": "Deployment",
  statefulset: "StatefulSet",
  statefulsets: "StatefulSet",
  daemonset: "DaemonSet",
  daemonsets: "DaemonSet",
  replicaset: "ReplicaSet",
  replicasets: "ReplicaSet",
  job: "Job",
  jobs: "Job",
  cronjob: "CronJob",
  cronjobs: "CronJob",
  service: "Service",
  services: "Service",
  ingress: "Ingress",
  ingresses: "Ingress",
  "ingresses.networking.k8s.io": "Ingress",
  endpoint: "Endpoints",
  endpoints: "Endpoints",
  endpointslice: "EndpointSlice",
  endpointslices: "EndpointSlice",
  "endpointslices.discovery.k8s.io": "EndpointSlice",
  configmap: "ConfigMap",
  configmaps: "ConfigMap",
  secret: "Secret",
  secrets: "Secret",
  persistentvolumeclaim: "PersistentVolumeClaim",
  persistentvolumeclaims: "PersistentVolumeClaim",
  pvc: "PersistentVolumeClaim",
  persistentvolume: "PersistentVolume",
  persistentvolumes: "PersistentVolume",
  pv: "PersistentVolume",
  storageclass: "StorageClass",
  storageclasses: "StorageClass",
  node: "Node",
  nodes: "Node",
  namespace: "Namespace",
  namespaces: "Namespace",
  serviceaccount: "ServiceAccount",
  serviceaccounts: "ServiceAccount",
  role: "Role",
  roles: "Role",
  rolebinding: "RoleBinding",
  rolebindings: "RoleBinding",
  clusterrole: "ClusterRole",
  clusterroles: "ClusterRole",
  clusterrolebinding: "ClusterRoleBinding",
  clusterrolebindings: "ClusterRoleBinding",
};

const RESOURCE_BY_KIND: Record<string, string> = {
  Pod: "pods",
  Service: "services",
  Deployment: "deployments",
  ReplicaSet: "replicasets",
  StatefulSet: "statefulsets",
  DaemonSet: "daemonsets",
  Job: "jobs",
  CronJob: "cronjobs",
  Node: "nodes",
  PersistentVolumeClaim: "persistentvolumeclaims",
  PersistentVolume: "persistentvolumes",
  ServiceAccount: "serviceaccounts",
  ConfigMap: "configmaps",
  Secret: "secrets",
  Role: "roles",
  RoleBinding: "rolebindings",
  ClusterRole: "clusterroles",
  ClusterRoleBinding: "clusterrolebindings",
};

export function kindForResource(resource: string): string {
  return KIND_BY_RESOURCE[resource] ?? singularKind(resource);
}

export function resourceForKind(kind: string): string {
  return RESOURCE_BY_KIND[kind] ?? "";
}
