// When each namespace was last part of the selection, per cluster. The
// namespace selector holds the recently used ones at the top of its menu, so a
// namespace picked minutes ago can be picked again without hunting for it in an
// alphabetical list of hundreds.
export type NamespaceUsage = Record<string, number>;

export const NAMESPACE_USAGE_TTL_MS = 15 * 60_000;

// How many recently used namespaces may sit above the alphabetical list. The
// current selection is always held there as well and does not count against
// this, so checking eight namespaces never pushes one of them out of sight.
export const NAMESPACE_USAGE_LIMIT = 5;

export function rememberNamespaceUsage(usage: NamespaceUsage, touched: string[], at: number): NamespaceUsage {
  const next: NamespaceUsage = {};
  // Expired entries are dropped on write, so the map cannot grow without bound
  // on a cluster with thousands of namespaces.
  for (const [namespace, stamp] of Object.entries(usage)) {
    if (at - stamp < NAMESPACE_USAGE_TTL_MS) next[namespace] = stamp;
  }
  for (const namespace of touched) {
    if (!namespace || namespace === "all" || namespace === "_cluster") continue;
    next[namespace] = at;
  }
  return next;
}

// The current selection plus up to `limit` other namespaces used within the
// retention window, most recent first. The caller evaluates this when the menu
// opens, so an entry that aged out in the meantime returns to the alphabetical
// list instead of moving while the menu is on screen.
export function recentNamespaceOrder(
  usage: NamespaceUsage | undefined,
  selectedNamespaced: string[],
  now: number,
  ttlMs: number = NAMESPACE_USAGE_TTL_MS,
  limit: number = NAMESPACE_USAGE_LIMIT,
): string[] {
  const recent = Object.entries(usage ?? {})
    .filter(([, stamp]) => now - stamp < ttlMs)
    .sort(([leftName, leftStamp], [rightName, rightStamp]) => rightStamp - leftStamp || leftName.localeCompare(rightName))
    .map(([namespace]) => namespace);
  const selected = new Set(selectedNamespaced);
  const kept = new Set([...selectedNamespaced, ...recent.filter((namespace) => !selected.has(namespace)).slice(0, Math.max(0, limit))]);
  // Recency decides the order; anything selected but never stamped — a scope
  // restored on the way back from a cluster-scoped resource — trails it.
  return [...recent.filter((namespace) => kept.has(namespace)), ...selectedNamespaced.filter((namespace) => !recent.includes(namespace))];
}
