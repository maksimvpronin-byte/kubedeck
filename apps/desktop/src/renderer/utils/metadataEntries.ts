// Labels and annotations are namespaced by the domain in front of the slash,
// and that domain says who put them there. Grouping by it is the one split that
// needs no curated list of "interesting" keys: what an operator set has their
// own prefix, or none at all, and the dozens Kubernetes and the CNI write for
// themselves fall together under theirs.
export interface MetadataEntry {
  key: string;
  value: string;
}

export interface MetadataGroup {
  prefix: string;
  wellKnown: boolean;
  entries: MetadataEntry[];
}

const WELL_KNOWN_DOMAINS = ["kubernetes.io", "k8s.io"];

export function keyPrefix(key: string): string {
  const slash = key.indexOf("/");
  return slash === -1 ? "" : key.slice(0, slash);
}

export function isWellKnownKey(key: string): boolean {
  const prefix = keyPrefix(key);
  if (!prefix) return false;
  return WELL_KNOWN_DOMAINS.some((domain) => prefix === domain || prefix.endsWith(`.${domain}`));
}

export function groupMetadataEntries(entries: MetadataEntry[]): MetadataGroup[] {
  const byPrefix = new Map<string, MetadataEntry[]>();
  for (const entry of entries) {
    const prefix = keyPrefix(entry.key);
    const bucket = byPrefix.get(prefix) ?? [];
    bucket.push(entry);
    byPrefix.set(prefix, bucket);
  }

  return [...byPrefix.entries()]
    .map(([prefix, group]) => ({
      prefix,
      wellKnown: isWellKnownKey(group[0].key),
      entries: group.sort((left, right) => left.key.localeCompare(right.key)),
    }))
    .sort((left, right) => {
      // Whatever is not Kubernetes' own comes first, because somebody in this
      // cluster chose it; a bare key with no prefix leads, being the most
      // deliberate of all.
      if (left.wellKnown !== right.wellKnown) return left.wellKnown ? 1 : -1;
      if (!left.prefix !== !right.prefix) return left.prefix ? 1 : -1;
      return left.prefix.localeCompare(right.prefix);
    });
}
