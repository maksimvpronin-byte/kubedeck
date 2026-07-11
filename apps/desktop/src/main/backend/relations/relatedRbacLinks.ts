import { relatedLink, type RelatedLink } from "./relatedResourceLinks";
import { record, records, text, type UnknownRecord } from "./relatedResourceValues";

export function serviceAccountSecretLinks(serviceAccount: UnknownRecord, namespace: string): RelatedLink[] {
  const links: RelatedLink[] = [];
  for (const secret of records(serviceAccount.secrets)) {
    if (text(secret.name)) links.push(relatedLink("secrets", namespace, text(secret.name), "Secret", "service account token/secret"));
  }
  for (const secret of records(serviceAccount.imagePullSecrets)) {
    if (text(secret.name)) links.push(relatedLink("secrets", namespace, text(secret.name), "Secret", "service account imagePullSecret"));
  }
  return links;
}

export function bindingHasServiceAccountSubject(binding: UnknownRecord, namespace: string, name: string): boolean {
  return records(binding.subjects).some((subject) => text(subject.kind) === "ServiceAccount" && text(subject.name) === name && (text(subject.namespace) || namespace) === namespace);
}

export function roleRefDetail(binding: UnknownRecord): string {
  const roleRef = record(binding.roleRef);
  return [text(roleRef.kind), text(roleRef.name)].filter(Boolean).join("/");
}

export function subjectsDetail(binding: UnknownRecord): string {
  return records(binding.subjects)
    .map((subject) => {
      const namespace = text(subject.namespace);
      return `${text(subject.kind)}/${namespace ? `${namespace}/` : ""}${text(subject.name)}`.replace(/\/+$/, "");
    })
    .join(", ");
}

export function roleReferenceLinks(binding: UnknownRecord, fallbackNamespace: string): RelatedLink[] {
  const roleRef = record(binding.roleRef);
  const kind = text(roleRef.kind);
  const name = text(roleRef.name);
  if (kind === "Role" && name) return [relatedLink("roles", fallbackNamespace, name, "Role", "role reference")];
  if (kind === "ClusterRole" && name) return [relatedLink("clusterroles", "_cluster", name, "ClusterRole", "role reference")];
  return [];
}

export function subjectLinks(binding: UnknownRecord, fallbackNamespace: string): RelatedLink[] {
  const links: RelatedLink[] = [];
  for (const subject of records(binding.subjects)) {
    if (text(subject.kind) !== "ServiceAccount" || !text(subject.name)) continue;
    links.push(relatedLink("serviceaccounts", text(subject.namespace) || fallbackNamespace, text(subject.name), "ServiceAccount", "subject"));
  }
  return links;
}
