// When each namespace was last part of the selection, per cluster. The
// namespace selector holds the recently used ones at the top of its menu, so a
// namespace picked minutes ago can be picked again without hunting for it in an
// alphabetical list of hundreds.
export type NamespaceUsage = Record<string, number>;

export const NAMESPACE_USAGE_TTL_MS = 15 * 60_000;

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

// Namespaces used within the retention window, most recent first, with the
// current selection always included. The caller evaluates this when the menu
// opens, so an entry that aged out in the meantime returns to the alphabetical
// list instead of moving while the menu is on screen.
export function recentNamespaceOrder(usage: NamespaceUsage | undefined, selectedNamespaced: string[], now: number, ttlMs: number = NAMESPACE_USAGE_TTL_MS): string[] {
  const recent = Object.entries(usage ?? {})
    .filter(([, stamp]) => now - stamp < ttlMs)
    .sort(([leftName, leftStamp], [rightName, rightStamp]) => rightStamp - leftStamp || leftName.localeCompare(rightName))
    .map(([namespace]) => namespace);
  return Array.from(new Set([...recent, ...selectedNamespaced]));
}
