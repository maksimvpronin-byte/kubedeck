// A scope made of !names means all namespaces except those names. The prefix
// cannot occur in a Kubernetes namespace and keeps existing saved scopes valid.
export function namespaceExclusions(selection: readonly string[]): string[] {
  return selection.filter((entry) => entry.startsWith("!") && entry.length > 1).map((entry) => entry.slice(1));
}

export function namespaceRequestScope(selection: readonly string[]): string {
  return selection.length === 1 && !selection[0].startsWith("!") ? selection[0] : "all";
}
