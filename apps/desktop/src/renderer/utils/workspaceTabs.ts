import type { ResourceRow, Section } from "../types";

export interface ResourceWorkspaceTab {
  id: string;
  clusterId: string;
  clusterName: string;
  section: Section;
  resource: string;
  namespace: string;
  row: ResourceRow;
  drawerTab: string;
  status?: "ready" | "loading" | "not-found" | "unavailable";
}

// The drawer tab is remembered per resource, so walking from pod to pod keeps
// YAML open while switching to another kind starts on Summary again.
export type DrawerTabMemory = Record<string, string>;

export function rememberDrawerTab(memory: DrawerTabMemory, resource: string, drawerTab: string): DrawerTabMemory {
  if (!resource || !drawerTab || memory[resource] === drawerTab) return memory;
  return { ...memory, [resource]: drawerTab };
}

export function drawerTabForResource(memory: DrawerTabMemory, resource: string): string {
  return memory[resource] || "summary";
}

export function resourceWorkspaceTabId(clusterId: string, resource: string, row: ResourceRow) {
  return [clusterId, resource, String(row.namespace || "_cluster"), row.name, row.uid || "no-uid"].join("\u0000");
}

export function upsertResourceWorkspaceTab(tabs: ResourceWorkspaceTab[], candidate: ResourceWorkspaceTab, limit = 10) {
  const index = tabs.findIndex((tab) => tab.id === candidate.id);
  if (index >= 0) return { tabs: tabs.map((tab, position) => (position === index ? { ...candidate, drawerTab: tab.drawerTab } : tab)), activeId: candidate.id, limited: false };
  if (tabs.length >= limit) return { tabs, activeId: null, limited: true };
  return { tabs: [...tabs, candidate], activeId: candidate.id, limited: false };
}

export function closeResourceWorkspaceTab(tabs: ResourceWorkspaceTab[], activeId: string | null, closingId: string) {
  const index = tabs.findIndex((tab) => tab.id === closingId);
  if (index < 0) return { tabs, activeId };
  const next = tabs.filter((tab) => tab.id !== closingId);
  if (activeId !== closingId) return { tabs: next, activeId };
  return { tabs: next, activeId: next[Math.min(index, next.length - 1)]?.id ?? null };
}
