import { useEffect } from "react";
import type { Section } from "../types";
import { loadUiState, saveUiState } from "../uiState";

interface PersistUiStateOptions {
  drawerWidth: number;
  sidebarWidth: number;
  expandedSections: Set<string>;
  expandedCrdGroups: Set<string>;
  section: Section;
  resourceTab: string;
  namespace: string;
  selectedNamespaces: string[];
  selectedNamespacesByClusterId: Record<string, string[]>;
}

export function usePersistUiState({
  drawerWidth,
  sidebarWidth,
  expandedSections,
  expandedCrdGroups,
  section,
  resourceTab,
  namespace,
  selectedNamespaces,
  selectedNamespacesByClusterId,
}: PersistUiStateOptions) {
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = {
        ...loadUiState(),
        drawerWidth,
        sidebarWidth,
        expandedSections: Array.from(expandedSections),
        expandedCrdGroups: Array.from(expandedCrdGroups),
        section,
        resourceTab,
        namespaceSelectionVersion: 2 as const,
        selectedNamespacesByClusterId,
      };
      // These v1 fields represented one global selection and must not leak it
      // into another cluster after upgrading to the per-cluster model.
      delete next.namespace;
      delete next.selectedNamespaces;
      saveUiState(next);
    }, 300);
    return () => clearTimeout(timer);
  }, [drawerWidth, sidebarWidth, expandedSections, expandedCrdGroups, section, resourceTab, namespace, selectedNamespaces, selectedNamespacesByClusterId]);
}
