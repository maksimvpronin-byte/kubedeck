// The per-resource normalizers live in one file per family; this barrel is the
// only entry point, so `resources/normalizers` means the same thing to every
// caller it did when all of them shared a single module.
import { crdSummary, eventSummary, genericSummary, keyValueSummary, resourceQuotaSummary, storageSummary } from "./misc";
import { ingressSummary, serviceSummary } from "./network";
import { nodeSummary } from "./node";
import { podSummary } from "./pod";
import { type JsonObject, isRecord, type ResourceRow, text } from "./primitives";
import { roleBindingSummary, roleSummary, serviceAccountSummary } from "./rbac";
import { deploymentSummary, jobSummary } from "./workload";

export type { JsonObject, ResourceRow } from "./primitives";
export { meta } from "./primitives";
export { crdSummary, eventSummary, genericSummary, keyValueSummary, resourceQuotaSummary, storageSummary } from "./misc";
export type { ServicePortItem } from "./network";
export { ingressSummary, loadBalancerAddresses, servicePortItems, serviceSummary } from "./network";
export type { NodeAnnotationItem, NodeLabelItem } from "./node";
export { nodeAnnotationItems, nodeLabelItems, nodeRoles, nodeSummary } from "./node";
export type { RestartDiagnostic } from "./pod";
export { podRestartDiagnostics, podSummary } from "./pod";
export { roleBindingSummary, roleSummary, serviceAccountSummary } from "./rbac";
export { deploymentSummary, jobSummary, workloadConditionItems } from "./workload";

const NORMALIZERS: Record<string, (item: JsonObject) => ResourceRow> = {
  pods: podSummary,
  pod: podSummary,
  deployments: deploymentSummary,
  deployment: deploymentSummary,
  "deployments.apps": deploymentSummary,
  "deployment.apps": deploymentSummary,
  statefulsets: deploymentSummary,
  statefulset: deploymentSummary,
  daemonsets: deploymentSummary,
  daemonset: deploymentSummary,
  replicasets: deploymentSummary,
  replicaset: deploymentSummary,
  jobs: jobSummary,
  job: jobSummary,
  cronjobs: jobSummary,
  cronjob: jobSummary,
  services: serviceSummary,
  service: serviceSummary,
  svc: serviceSummary,
  ingresses: ingressSummary,
  ingress: ingressSummary,
  "ingresses.networking.k8s.io": ingressSummary,
  "ingress.networking.k8s.io": ingressSummary,
  customresourcedefinitions: crdSummary,
  customresourcedefinition: crdSummary,
  "customresourcedefinitions.apiextensions.k8s.io": crdSummary,
  "customresourcedefinition.apiextensions.k8s.io": crdSummary,
  crd: crdSummary,
  crds: crdSummary,
  events: eventSummary,
  event: eventSummary,
  nodes: nodeSummary,
  node: nodeSummary,
  serviceaccounts: serviceAccountSummary,
  serviceaccount: serviceAccountSummary,
  sa: serviceAccountSummary,
  roles: roleSummary,
  role: roleSummary,
  clusterroles: roleSummary,
  clusterrole: roleSummary,
  rolebindings: roleBindingSummary,
  rolebinding: roleBindingSummary,
  clusterrolebindings: roleBindingSummary,
  clusterrolebinding: roleBindingSummary,
  resourcequotas: resourceQuotaSummary,
  resourcequota: resourceQuotaSummary,
  configmaps: keyValueSummary,
  configmap: keyValueSummary,
  secrets: keyValueSummary,
  secret: keyValueSummary,
  persistentvolumeclaims: storageSummary,
  persistentvolumeclaim: storageSummary,
  persistentvolumes: storageSummary,
  persistentvolume: storageSummary,
  storageclasses: storageSummary,
  storageclass: storageSummary,
};

export function normalizerForResource(resource: string): (item: JsonObject) => ResourceRow {
  return NORMALIZERS[resource.trim().toLowerCase()] ?? genericSummary;
}

export function normalizeResourceItems(resource: string, items: unknown[]): ResourceRow[] {
  const normalizedResource = resource.trim().toLowerCase();
  const normalizer = normalizerForResource(normalizedResource);
  const crdInstance = !Object.prototype.hasOwnProperty.call(NORMALIZERS, normalizedResource) && normalizedResource.includes(".");

  return items.filter(isRecord).map((item) => {
    const summary = normalizer(item);
    if (crdInstance) {
      summary.crdInstance = true;
      summary.resource = normalizedResource;
      if (!summary.apiVersion) summary.apiVersion = text(item.apiVersion);
    }
    return summary;
  });
}
