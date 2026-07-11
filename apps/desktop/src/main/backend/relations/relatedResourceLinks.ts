export interface RelatedLink {
  key: string;
  resource: string;
  namespace: string;
  name: string;
  kind: string;
  relation: string;
  detail: string;
}

function normalizedNamespace(value: string): string {
  return value || "_cluster";
}

export function relatedLink(
  resource: string,
  namespace: string,
  name: string,
  kind: string,
  relation: string,
  detail = "",
): RelatedLink {
  const normalized = normalizedNamespace(namespace);
  return {
    key: `${resource}:${normalized}:${name}:${relation}`,
    resource,
    namespace: normalized,
    name,
    kind,
    relation,
    detail,
  };
}

export function deduplicateRelatedLinks(links: RelatedLink[]): RelatedLink[] {
  const seen = new Set<string>();
  const result: RelatedLink[] = [];
  for (const link of links) {
    if (!link.resource || !link.name) continue;
    const key = `${link.resource}\u0000${link.namespace}\u0000${link.name}\u0000${link.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.namespace.localeCompare(right.namespace) ||
      left.name.localeCompare(right.name) ||
      left.relation.localeCompare(right.relation),
  );
}
