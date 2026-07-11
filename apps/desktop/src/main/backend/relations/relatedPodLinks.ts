import { relatedLink, type RelatedLink } from "./relatedResourceLinks";
import { metadata, metadataName, record, records, text, type SafeLoad, type UnknownRecord } from "./relatedResourceValues";

function containerConfigLinks(containerValue: unknown, namespace: string): RelatedLink[] {
  const container = record(containerValue);
  const links: RelatedLink[] = [];
  const containerName = text(container.name);
  const detail = containerName ? `container ${containerName}` : "container";
  for (const envFrom of records(container.envFrom)) {
    const configMap = record(envFrom.configMapRef);
    const secret = record(envFrom.secretRef);
    if (text(configMap.name)) links.push(relatedLink("configmaps", namespace, text(configMap.name), "ConfigMap", "envFrom config", detail));
    if (text(secret.name)) links.push(relatedLink("secrets", namespace, text(secret.name), "Secret", "envFrom secret", detail));
  }
  for (const env of records(container.env)) {
    const valueFrom = record(env.valueFrom);
    for (const [field, resource, kind, relation] of [
      ["configMapKeyRef", "configmaps", "ConfigMap", "env key config"],
      ["secretKeyRef", "secrets", "Secret", "env key secret"],
    ] as const) {
      const ref = record(valueFrom[field]);
      if (!text(ref.name)) continue;
      const key = text(ref.key);
      links.push(relatedLink(resource, namespace, text(ref.name), kind, relation, key ? `${detail}, key ${key}` : detail));
    }
  }
  return links;
}

export function podReferenceLinks(pod: UnknownRecord, namespace: string): RelatedLink[] {
  const links: RelatedLink[] = [];
  const spec = record(pod.spec);
  for (const secret of records(spec.imagePullSecrets)) {
    if (text(secret.name)) links.push(relatedLink("secrets", namespace, text(secret.name), "Secret", "imagePull secret"));
  }
  for (const volume of records(spec.volumes)) {
    const detail = text(volume.name);
    const refs = [
      [record(volume.persistentVolumeClaim), "claimName", "persistentvolumeclaims", "PersistentVolumeClaim", "mounted volume"],
      [record(volume.configMap), "name", "configmaps", "ConfigMap", "mounted config"],
      [record(volume.secret), "secretName", "secrets", "Secret", "mounted secret"],
    ] as const;
    for (const [ref, field, resource, kind, relation] of refs) {
      if (text(ref[field])) links.push(relatedLink(resource, namespace, text(ref[field]), kind, relation, detail));
    }
  }
  for (const container of [...records(spec.containers), ...records(spec.initContainers)]) links.push(...containerConfigLinks(container, namespace));
  return links;
}

export async function ownerReferenceLinksForPod(pod: UnknownRecord, namespace: string, safeLoad: SafeLoad): Promise<RelatedLink[]> {
  const links: RelatedLink[] = [];
  for (const owner of records(metadata(pod).ownerReferences)) {
    const kind = text(owner.kind);
    const ownerName = text(owner.name);
    const source = kind === "ReplicaSet" ? "replicasets" : kind === "Job" ? "jobs" : "";
    const parentKind = kind === "ReplicaSet" ? "Deployment" : "CronJob";
    const parentResource = kind === "ReplicaSet" ? "deployments" : "cronjobs";
    if (!source || !ownerName) continue;
    const item = (await safeLoad(source, namespace)).find((candidate) => metadataName(candidate) === ownerName);
    const parent = item && records(metadata(item).ownerReferences).find((candidate) => text(candidate.kind) === parentKind && text(candidate.name));
    if (parent) links.push(relatedLink(parentResource, namespace, text(parent.name), parentKind, `controls pod via ${kind}`, ownerName));
  }
  return links;
}
