// Where the API server lists each built-in resource, for `kubectl get --raw`.
//
// `kubectl get <resource> -o json` decodes every object into its typed form,
// converts it and pretty-prints it again: for 1700 pods that is 1.2-1.4 s and
// 25 MB of output, against about 0.1 s and 11 MB for the same list read raw.
// That difference is most of what a table waits for on a large cluster, on
// every open and every relist a watch event triggers.
//
// Only types whose path is fixed are listed. Custom resources, and anything
// this table does not know, keep going through `kubectl get`, which resolves
// them through discovery.

interface ListEndpoint {
  // "/api/v1" for the core group, "/apis/<group>/<version>" otherwise.
  prefix: string;
  plural: string;
  namespaced: boolean;
}

const core = (plural: string, namespaced = true): ListEndpoint => ({ prefix: "/api/v1", plural, namespaced });
const group = (groupVersion: string, plural: string, namespaced = true): ListEndpoint => ({ prefix: `/apis/${groupVersion}`, plural, namespaced });

const ENDPOINTS: Record<string, ListEndpoint> = {
  pods: core("pods"),
  services: core("services"),
  endpoints: core("endpoints"),
  configmaps: core("configmaps"),
  secrets: core("secrets"),
  serviceaccounts: core("serviceaccounts"),
  persistentvolumeclaims: core("persistentvolumeclaims"),
  resourcequotas: core("resourcequotas"),
  limitranges: core("limitranges"),
  events: core("events"),
  namespaces: core("namespaces", false),
  nodes: core("nodes", false),
  persistentvolumes: core("persistentvolumes", false),
  deployments: group("apps/v1", "deployments"),
  statefulsets: group("apps/v1", "statefulsets"),
  daemonsets: group("apps/v1", "daemonsets"),
  replicasets: group("apps/v1", "replicasets"),
  jobs: group("batch/v1", "jobs"),
  cronjobs: group("batch/v1", "cronjobs"),
  ingresses: group("networking.k8s.io/v1", "ingresses"),
  networkpolicies: group("networking.k8s.io/v1", "networkpolicies"),
  horizontalpodautoscalers: group("autoscaling/v2", "horizontalpodautoscalers"),
  poddisruptionbudgets: group("policy/v1", "poddisruptionbudgets"),
  leases: group("coordination.k8s.io/v1", "leases"),
  roles: group("rbac.authorization.k8s.io/v1", "roles"),
  rolebindings: group("rbac.authorization.k8s.io/v1", "rolebindings"),
  clusterroles: group("rbac.authorization.k8s.io/v1", "clusterroles", false),
  clusterrolebindings: group("rbac.authorization.k8s.io/v1", "clusterrolebindings", false),
  storageclasses: group("storage.k8s.io/v1", "storageclasses", false),
  priorityclasses: group("scheduling.k8s.io/v1", "priorityclasses", false),
  runtimeclasses: group("node.k8s.io/v1", "runtimeclasses", false),
  mutatingwebhookconfigurations: group("admissionregistration.k8s.io/v1", "mutatingwebhookconfigurations", false),
  validatingwebhookconfigurations: group("admissionregistration.k8s.io/v1", "validatingwebhookconfigurations", false),
  customresourcedefinitions: group("apiextensions.k8s.io/v1", "customresourcedefinitions", false),
};

// The path to list `resource` in `namespace` ("all", a namespace name, or
// "_cluster"), or null when it has to go through `kubectl get` instead.
export function rawListPath(resource: string, namespace: string): string | null {
  const endpoint = Object.hasOwn(ENDPOINTS, resource) ? ENDPOINTS[resource] : undefined;
  if (!endpoint) return null;
  if (!endpoint.namespaced) return `${endpoint.prefix}/${endpoint.plural}`;
  if (namespace === "all") return `${endpoint.prefix}/${endpoint.plural}`;
  // A namespaced list with no namespace means the kubeconfig context's own
  // default, which only kubectl knows.
  if (namespace === "_cluster" || !namespace) return null;
  return `${endpoint.prefix}/namespaces/${encodeURIComponent(namespace)}/${endpoint.plural}`;
}

// A raw list leaves `kind` and `apiVersion` off its items; `kubectl get -o
// json` fills them in, and the row normalizers read them. They are the same
// for every item of a list, so they are taken from the list itself.
export function withItemTypes(list: Record<string, unknown>): Record<string, unknown> {
  const listKind = typeof list.kind === "string" ? list.kind : "";
  const kind = listKind.endsWith("List") ? listKind.slice(0, -"List".length) : "";
  const apiVersion = typeof list.apiVersion === "string" ? list.apiVersion : "";
  if (!Array.isArray(list.items) || (!kind && !apiVersion)) return list;
  for (const item of list.items) {
    if (!item || typeof item !== "object") continue;
    const object = item as Record<string, unknown>;
    if (kind && !object.kind) object.kind = kind;
    if (apiVersion && !object.apiVersion) object.apiVersion = apiVersion;
  }
  return list;
}
