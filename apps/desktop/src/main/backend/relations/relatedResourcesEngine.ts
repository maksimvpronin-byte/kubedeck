import { KubectlError } from "../kubectl/errors";
import {
  deduplicateRelatedLinks,
  relatedLink,
  type RelatedLink,
} from "./relatedResourceLinks";
import { kindForResource } from "./relatedResourceKinds";
import {
  endpointAddressLinks,
  endpointSliceAddressDetail,
  endpointSliceAddressLinks,
  endpointSliceServiceName,
} from "./relatedEndpointLinks";
import {
  metadata,
  metadataName,
  metadataNamespace,
  record,
  records,
  type SafeLoad,
  text,
  type UnknownRecord,
} from "./relatedResourceValues";

export { deduplicateRelatedLinks, relatedLink } from "./relatedResourceLinks";
export type { RelatedLink } from "./relatedResourceLinks";
export { kindForResource } from "./relatedResourceKinds";
export { metadataName } from "./relatedResourceValues";

export interface RelatedResourcesResult {
  items: RelatedLink[];
  sources: Record<string, number>;
  errors: Array<Record<string, unknown>>;
}

export interface RelatedResourcesContext {
  resource: string;
  namespace: string;
  targetRaw: Record<string, unknown>;
  loadItems: (
    resource: string,
    namespace: string,
  ) => Promise<Array<Record<string, unknown>>>;
}

function selectorFromWorkload(spec: UnknownRecord): UnknownRecord {
  const selector = record(spec.selector);
  return record(selector.matchLabels);
}

export function selectorMatches(
  labelsValue: unknown,
  selectorValue: unknown,
): boolean {
  const labels = record(labelsValue);
  const selector = record(selectorValue);
  const entries = Object.entries(selector);
  return (
    entries.length > 0 &&
    entries.every(([key, value]) => text(labels[key]) === text(value))
  );
}

function selectorDetail(selectorValue: unknown): string {
  return Object.entries(record(selectorValue))
    .map(([key, value]) => `${key}=${text(value)}`)
    .join(", ");
}

function hasOwner(item: UnknownRecord, kind: string, name: string): boolean {
  return records(metadata(item).ownerReferences).some(
    (owner) => text(owner.kind) === kind && text(owner.name) === name,
  );
}

function ingressBackendServices(specValue: unknown): string[] {
  const spec = record(specValue);
  const names = new Set<string>();
  const collectBackend = (backendValue: unknown) => {
    const backend = record(backendValue);
    const service = record(backend.service);
    const name = text(service.name) || text(backend.serviceName);
    if (name) names.add(name);
  };
  collectBackend(spec.defaultBackend ?? spec.backend);
  for (const rule of records(spec.rules)) {
    const http = record(rule.http);
    for (const path of records(http.paths)) collectBackend(path.backend);
  }
  return [...names];
}

function containerConfigLinks(
  containerValue: unknown,
  namespace: string,
): RelatedLink[] {
  const container = record(containerValue);
  if (Object.keys(container).length === 0) return [];
  const links: RelatedLink[] = [];
  const containerName = text(container.name);
  const detailPrefix = containerName ? `container ${containerName}` : "container";
  for (const envFrom of records(container.envFrom)) {
    const configMapRef = record(envFrom.configMapRef);
    if (text(configMapRef.name)) {
      links.push(
        relatedLink(
          "configmaps",
          namespace,
          text(configMapRef.name),
          "ConfigMap",
          "envFrom config",
          detailPrefix,
        ),
      );
    }
    const secretRef = record(envFrom.secretRef);
    if (text(secretRef.name)) {
      links.push(
        relatedLink(
          "secrets",
          namespace,
          text(secretRef.name),
          "Secret",
          "envFrom secret",
          detailPrefix,
        ),
      );
    }
  }
  for (const env of records(container.env)) {
    const valueFrom = record(env.valueFrom);
    const configMapKeyRef = record(valueFrom.configMapKeyRef);
    if (text(configMapKeyRef.name)) {
      const key = text(configMapKeyRef.key);
      links.push(
        relatedLink(
          "configmaps",
          namespace,
          text(configMapKeyRef.name),
          "ConfigMap",
          "env key config",
          key ? `${detailPrefix}, key ${key}` : detailPrefix,
        ),
      );
    }
    const secretKeyRef = record(valueFrom.secretKeyRef);
    if (text(secretKeyRef.name)) {
      const key = text(secretKeyRef.key);
      links.push(
        relatedLink(
          "secrets",
          namespace,
          text(secretKeyRef.name),
          "Secret",
          "env key secret",
          key ? `${detailPrefix}, key ${key}` : detailPrefix,
        ),
      );
    }
  }
  return links;
}

function podReferenceLinks(pod: UnknownRecord, namespace: string): RelatedLink[] {
  const links: RelatedLink[] = [];
  const spec = record(pod.spec);
  for (const secret of records(spec.imagePullSecrets)) {
    if (text(secret.name)) {
      links.push(
        relatedLink(
          "secrets",
          namespace,
          text(secret.name),
          "Secret",
          "imagePull secret",
        ),
      );
    }
  }
  for (const volume of records(spec.volumes)) {
    const detail = text(volume.name);
    const pvc = record(volume.persistentVolumeClaim);
    if (text(pvc.claimName)) {
      links.push(
        relatedLink(
          "persistentvolumeclaims",
          namespace,
          text(pvc.claimName),
          "PersistentVolumeClaim",
          "mounted volume",
          detail,
        ),
      );
    }
    const configMap = record(volume.configMap);
    if (text(configMap.name)) {
      links.push(
        relatedLink(
          "configmaps",
          namespace,
          text(configMap.name),
          "ConfigMap",
          "mounted config",
          detail,
        ),
      );
    }
    const secret = record(volume.secret);
    if (text(secret.secretName)) {
      links.push(
        relatedLink(
          "secrets",
          namespace,
          text(secret.secretName),
          "Secret",
          "mounted secret",
          detail,
        ),
      );
    }
  }
  const containers = [...records(spec.containers), ...records(spec.initContainers)];
  for (const container of containers) {
    links.push(...containerConfigLinks(container, namespace));
  }
  return links;
}

async function ownerReferenceLinksForPod(
  pod: UnknownRecord,
  namespace: string,
  safeLoad: SafeLoad,
): Promise<RelatedLink[]> {
  const links: RelatedLink[] = [];
  for (const owner of records(metadata(pod).ownerReferences)) {
    const kind = text(owner.kind);
    const ownerName = text(owner.name);
    if (!ownerName) continue;
    if (kind === "ReplicaSet") {
      const replicaSets = await safeLoad("replicasets", namespace);
      const replicaSet = replicaSets.find((item) => metadataName(item) === ownerName);
      if (!replicaSet) continue;
      const deploymentOwner = records(metadata(replicaSet).ownerReferences).find(
        (candidate) => text(candidate.kind) === "Deployment" && text(candidate.name),
      );
      if (deploymentOwner) {
        links.push(
          relatedLink(
            "deployments",
            namespace,
            text(deploymentOwner.name),
            "Deployment",
            "controls pod via ReplicaSet",
            ownerName,
          ),
        );
      }
    } else if (kind === "Job") {
      const jobs = await safeLoad("jobs", namespace);
      const job = jobs.find((item) => metadataName(item) === ownerName);
      if (!job) continue;
      const cronJobOwner = records(metadata(job).ownerReferences).find(
        (candidate) => text(candidate.kind) === "CronJob" && text(candidate.name),
      );
      if (cronJobOwner) {
        links.push(
          relatedLink(
            "cronjobs",
            namespace,
            text(cronJobOwner.name),
            "CronJob",
            "controls pod via Job",
            ownerName,
          ),
        );
      }
    }
  }
  return links;
}

function podUsesPvc(pod: UnknownRecord, claimName: string): boolean {
  return records(record(pod.spec).volumes).some(
    (volume) => text(record(volume.persistentVolumeClaim).claimName) === claimName,
  );
}

function podUsesConfigResource(
  pod: UnknownRecord,
  refKind: "configMap" | "secret",
  name: string,
): string {
  const spec = record(pod.spec);
  const volumeField = refKind === "configMap" ? "configMap" : "secret";
  const nameField = refKind === "configMap" ? "name" : "secretName";
  for (const volume of records(spec.volumes)) {
    if (text(record(volume[volumeField])[nameField]) === name) return "mounted by pod";
  }
  const containers = [...records(spec.containers), ...records(spec.initContainers)];
  for (const container of containers) {
    for (const envFrom of records(container.envFrom)) {
      const ref = record(envFrom[`${refKind}Ref`]);
      if (text(ref.name) === name) return "used by envFrom";
    }
    for (const env of records(container.env)) {
      const valueFrom = record(env.valueFrom);
      const ref = record(valueFrom[`${refKind}KeyRef`]);
      if (text(ref.name) === name) return "used by environment variable";
    }
  }
  return "";
}

function serviceAccountSecretLinks(
  serviceAccount: UnknownRecord,
  namespace: string,
): RelatedLink[] {
  const links: RelatedLink[] = [];
  for (const secret of records(serviceAccount.secrets)) {
    if (text(secret.name)) {
      links.push(
        relatedLink(
          "secrets",
          namespace,
          text(secret.name),
          "Secret",
          "service account token/secret",
        ),
      );
    }
  }
  for (const secret of records(serviceAccount.imagePullSecrets)) {
    if (text(secret.name)) {
      links.push(
        relatedLink(
          "secrets",
          namespace,
          text(secret.name),
          "Secret",
          "service account imagePullSecret",
        ),
      );
    }
  }
  return links;
}

function bindingHasServiceAccountSubject(
  binding: UnknownRecord,
  namespace: string,
  name: string,
): boolean {
  return records(binding.subjects).some(
    (subject) =>
      text(subject.kind) === "ServiceAccount" &&
      text(subject.name) === name &&
      (text(subject.namespace) || namespace) === namespace,
  );
}

function roleRefDetail(binding: UnknownRecord): string {
  const roleRef = record(binding.roleRef);
  return [text(roleRef.kind), text(roleRef.name)].filter(Boolean).join("/");
}

function subjectsDetail(binding: UnknownRecord): string {
  return records(binding.subjects)
    .map((subject) => {
      const kind = text(subject.kind);
      const namespace = text(subject.namespace);
      const name = text(subject.name);
      return `${kind}/${namespace ? `${namespace}/` : ""}${name}`.replace(/\/+$/, "");
    })
    .join(", ");
}

function roleReferenceLinks(
  binding: UnknownRecord,
  fallbackNamespace: string,
): RelatedLink[] {
  const roleRef = record(binding.roleRef);
  const kind = text(roleRef.kind);
  const name = text(roleRef.name);
  if (kind === "Role" && name) {
    return [relatedLink("roles", fallbackNamespace, name, "Role", "role reference")];
  }
  if (kind === "ClusterRole" && name) {
    return [relatedLink("clusterroles", "_cluster", name, "ClusterRole", "role reference")];
  }
  return [];
}

function subjectLinks(
  binding: UnknownRecord,
  fallbackNamespace: string,
): RelatedLink[] {
  const links: RelatedLink[] = [];
  for (const subject of records(binding.subjects)) {
    if (text(subject.kind) !== "ServiceAccount" || !text(subject.name)) continue;
    links.push(
      relatedLink(
        "serviceaccounts",
        text(subject.namespace) || fallbackNamespace,
        text(subject.name),
        "ServiceAccount",
        "subject",
      ),
    );
  }
  return links;
}

function errorInfo(
  error: unknown,
  resource: string,
  namespace: string,
): Record<string, unknown> {
  if (error instanceof KubectlError) {
    return { ...error.info, resource, namespace };
  }
  return {
    code: "RELATED_SOURCE_FAILED",
    message: error instanceof Error ? error.message : String(error),
    rawStderr: "",
    commandPreview: "",
    resource,
    namespace,
  };
}

export async function buildRelatedResources(
  context: RelatedResourcesContext,
): Promise<RelatedResourcesResult> {
  const resource = context.resource.toLocaleLowerCase();
  const namespace = context.namespace;
  const targetRaw = context.targetRaw;
  const targetMetadata = metadata(targetRaw);
  const spec = record(targetRaw.spec);
  const name = text(targetMetadata.name);
  const targetNamespace = text(targetMetadata.namespace) || (namespace === "_cluster" ? "" : namespace);
  const labels = record(targetMetadata.labels);
  const links: RelatedLink[] = [];
  const sources: Record<string, number> = {};
  const errors: Array<Record<string, unknown>> = [];
  const cache = new Map<string, Promise<Array<UnknownRecord>>>();

  const safeLoad: SafeLoad = async (sourceResource, sourceNamespace) => {
    const key = `${sourceResource}\u0000${sourceNamespace}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = context
        .loadItems(sourceResource, sourceNamespace)
        .then((items) => {
          sources[sourceResource] = items.length;
          return items;
        })
        .catch((error) => {
          sources[sourceResource] = 0;
          errors.push(errorInfo(error, sourceResource, sourceNamespace));
          return [];
        });
      cache.set(key, pending);
    }
    return pending;
  };

  if (["pods", "pod"].includes(resource)) {
    const nodeName = text(spec.nodeName);
    if (nodeName) links.push(relatedLink("nodes", "_cluster", nodeName, "Node", "scheduled on"));
    const serviceAccount = text(spec.serviceAccountName) || "default";
    if (serviceAccount && targetNamespace) {
      links.push(
        relatedLink(
          "serviceaccounts",
          targetNamespace,
          serviceAccount,
          "ServiceAccount",
          "used by pod",
        ),
      );
    }
    links.push(...podReferenceLinks(targetRaw, targetNamespace));
    links.push(...(await ownerReferenceLinksForPod(targetRaw, targetNamespace, safeLoad)));
    for (const service of await safeLoad("services", targetNamespace)) {
      const serviceSelector = record(record(service.spec).selector);
      if (selectorMatches(labels, serviceSelector)) {
        links.push(
          relatedLink(
            "services",
            targetNamespace,
            metadataName(service),
            "Service",
            "selects this pod",
            selectorDetail(serviceSelector),
          ),
        );
      }
    }
  }

  const workloads = new Set([
    "deployment",
    "deployments",
    "deployments.apps",
    "statefulset",
    "statefulsets",
    "daemonset",
    "daemonsets",
    "replicaset",
    "replicasets",
    "job",
    "jobs",
    "cronjob",
    "cronjobs",
  ]);
  if (workloads.has(resource)) {
    const selector = selectorFromWorkload(spec);
    if (targetNamespace && Object.keys(selector).length > 0) {
      for (const pod of await safeLoad("pods", targetNamespace)) {
        if (selectorMatches(record(metadata(pod).labels), selector)) {
          links.push(
            relatedLink(
              "pods",
              targetNamespace,
              metadataName(pod),
              "Pod",
              "matches workload selector",
              selectorDetail(selector),
            ),
          );
        }
      }
      for (const service of await safeLoad("services", targetNamespace)) {
        const serviceSelector = record(record(service.spec).selector);
        if (selectorMatches(selector, serviceSelector)) {
          links.push(
            relatedLink(
              "services",
              targetNamespace,
              metadataName(service),
              "Service",
              "targets this workload",
              selectorDetail(serviceSelector),
            ),
          );
        }
      }
    }
    if (["deployment", "deployments", "deployments.apps"].includes(resource) && targetNamespace) {
      for (const replicaSet of await safeLoad("replicasets", targetNamespace)) {
        if (hasOwner(replicaSet, "Deployment", name)) {
          links.push(
            relatedLink(
              "replicasets",
              targetNamespace,
              metadataName(replicaSet),
              "ReplicaSet",
              "owned by deployment",
            ),
          );
        }
      }
    }
  }

  if (["services", "service"].includes(resource)) {
    const selector = record(spec.selector);
    if (targetNamespace && Object.keys(selector).length > 0) {
      for (const pod of await safeLoad("pods", targetNamespace)) {
        if (selectorMatches(record(metadata(pod).labels), selector)) {
          links.push(
            relatedLink(
              "pods",
              targetNamespace,
              metadataName(pod),
              "Pod",
              "selected by service",
              selectorDetail(selector),
            ),
          );
        }
      }
    }
    if (targetNamespace) {
      for (const ingress of await safeLoad("ingresses", targetNamespace)) {
        if (ingressBackendServices(ingress.spec).includes(name)) {
          links.push(
            relatedLink(
              "ingresses",
              targetNamespace,
              metadataName(ingress),
              "Ingress",
              "routes to service",
            ),
          );
        }
      }
      for (const endpoints of await safeLoad("endpoints", targetNamespace)) {
        if (metadataName(endpoints) === name) {
          links.push(
            relatedLink(
              "endpoints",
              targetNamespace,
              name,
              "Endpoints",
              "backing endpoints",
            ),
          );
        }
      }
      for (const endpointSlice of await safeLoad("endpointslices", targetNamespace)) {
        if (endpointSliceServiceName(endpointSlice) === name) {
          links.push(
            relatedLink(
              "endpointslices",
              targetNamespace,
              metadataName(endpointSlice),
              "EndpointSlice",
              "backing endpoint slice",
              endpointSliceAddressDetail(endpointSlice),
            ),
          );
        }
      }
    }
  }

  if (["endpoints", "endpoint"].includes(resource)) {
    if (targetNamespace) {
      links.push(relatedLink("services", targetNamespace, name, "Service", "backs service"));
    }
    links.push(...endpointAddressLinks(targetRaw, targetNamespace));
  }

  if (["endpointslices", "endpointslice", "endpointslices.discovery.k8s.io"].includes(resource)) {
    const serviceName = endpointSliceServiceName(targetRaw);
    if (serviceName && targetNamespace) {
      links.push(
        relatedLink("services", targetNamespace, serviceName, "Service", "backs service"),
      );
    }
    links.push(...endpointSliceAddressLinks(targetRaw, targetNamespace));
  }

  if (["ingresses", "ingress", "ingresses.networking.k8s.io"].includes(resource)) {
    for (const serviceName of ingressBackendServices(spec)) {
      links.push(
        relatedLink(
          "services",
          targetNamespace,
          serviceName,
          "Service",
          "used by ingress",
        ),
      );
    }
  }

  if (["persistentvolumeclaims", "persistentvolumeclaim", "pvc"].includes(resource)) {
    const volumeName = text(spec.volumeName);
    if (volumeName) {
      links.push(
        relatedLink(
          "persistentvolumes",
          "_cluster",
          volumeName,
          "PersistentVolume",
          "bound volume",
        ),
      );
    }
    const storageClass = text(spec.storageClassName);
    if (storageClass) {
      links.push(
        relatedLink(
          "storageclasses",
          "_cluster",
          storageClass,
          "StorageClass",
          "storage class",
        ),
      );
    }
    if (targetNamespace) {
      for (const pod of await safeLoad("pods", targetNamespace)) {
        if (podUsesPvc(pod, name)) {
          links.push(
            relatedLink(
              "pods",
              targetNamespace,
              metadataName(pod),
              "Pod",
              "mounts this PVC",
            ),
          );
        }
      }
    }
  }

  if (["persistentvolumes", "persistentvolume", "pv"].includes(resource)) {
    const claimRef = record(spec.claimRef);
    const claimName = text(claimRef.name);
    if (claimName) {
      links.push(
        relatedLink(
          "persistentvolumeclaims",
          text(claimRef.namespace) || "_cluster",
          claimName,
          "PersistentVolumeClaim",
          "bound claim",
        ),
      );
    }
    const storageClass = text(spec.storageClassName);
    if (storageClass) {
      links.push(
        relatedLink(
          "storageclasses",
          "_cluster",
          storageClass,
          "StorageClass",
          "storage class",
        ),
      );
    }
  }

  if (["configmaps", "configmap", "secrets", "secret"].includes(resource) && targetNamespace) {
    const refKind = resource.startsWith("config") ? "configMap" : "secret";
    for (const pod of await safeLoad("pods", targetNamespace)) {
      const relation = podUsesConfigResource(pod, refKind, name);
      if (relation) {
        links.push(
          relatedLink(
            "pods",
            targetNamespace,
            metadataName(pod),
            "Pod",
            relation,
          ),
        );
      }
    }
  }

  if (["serviceaccounts", "serviceaccount"].includes(resource) && targetNamespace) {
    links.push(...serviceAccountSecretLinks(targetRaw, targetNamespace));
    for (const pod of await safeLoad("pods", targetNamespace)) {
      if ((text(record(pod.spec).serviceAccountName) || "default") === name) {
        links.push(
          relatedLink(
            "pods",
            targetNamespace,
            metadataName(pod),
            "Pod",
            "uses this service account",
          ),
        );
      }
    }
    for (const binding of await safeLoad("rolebindings", targetNamespace)) {
      if (bindingHasServiceAccountSubject(binding, targetNamespace, name)) {
        links.push(
          relatedLink(
            "rolebindings",
            targetNamespace,
            metadataName(binding),
            "RoleBinding",
            "grants permissions",
            roleRefDetail(binding),
          ),
        );
      }
    }
    for (const binding of await safeLoad("clusterrolebindings", "_cluster")) {
      if (bindingHasServiceAccountSubject(binding, targetNamespace, name)) {
        links.push(
          relatedLink(
            "clusterrolebindings",
            "_cluster",
            metadataName(binding),
            "ClusterRoleBinding",
            "grants cluster permissions",
            roleRefDetail(binding),
          ),
        );
      }
    }
  }

  if (["roles", "role"].includes(resource) && targetNamespace) {
    for (const binding of await safeLoad("rolebindings", targetNamespace)) {
      const roleRef = record(binding.roleRef);
      if (text(roleRef.kind) === "Role" && text(roleRef.name) === name) {
        links.push(
          relatedLink(
            "rolebindings",
            targetNamespace,
            metadataName(binding),
            "RoleBinding",
            "uses this role",
            subjectsDetail(binding),
          ),
        );
      }
    }
  }

  if (["clusterroles", "clusterrole"].includes(resource)) {
    for (const binding of await safeLoad("clusterrolebindings", "_cluster")) {
      const roleRef = record(binding.roleRef);
      if (text(roleRef.kind) === "ClusterRole" && text(roleRef.name) === name) {
        links.push(
          relatedLink(
            "clusterrolebindings",
            "_cluster",
            metadataName(binding),
            "ClusterRoleBinding",
            "uses this cluster role",
            subjectsDetail(binding),
          ),
        );
      }
    }
    for (const binding of await safeLoad("rolebindings", "all")) {
      const roleRef = record(binding.roleRef);
      if (text(roleRef.kind) === "ClusterRole" && text(roleRef.name) === name) {
        links.push(
          relatedLink(
            "rolebindings",
            metadataNamespace(binding),
            metadataName(binding),
            "RoleBinding",
            "uses this cluster role",
            subjectsDetail(binding),
          ),
        );
      }
    }
  }

  if (["rolebindings", "rolebinding", "clusterrolebindings", "clusterrolebinding"].includes(resource)) {
    const bindingNamespace = resource.startsWith("role") ? targetNamespace : "_cluster";
    links.push(...roleReferenceLinks(targetRaw, bindingNamespace));
    links.push(...subjectLinks(targetRaw, bindingNamespace));
  }

  if (["nodes", "node"].includes(resource)) {
    for (const pod of await safeLoad("pods", "all")) {
      if (text(record(pod.spec).nodeName) === name) {
        links.push(
          relatedLink(
            "pods",
            metadataNamespace(pod, "default"),
            metadataName(pod),
            "Pod",
            "scheduled on node",
          ),
        );
      }
    }
  }

  return {
    items: deduplicateRelatedLinks(links),
    sources,
    errors,
  };
}
