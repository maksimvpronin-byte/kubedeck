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
}: PersistUiStateOptions) {
  useEffect(() => {
    const timer = setTimeout(() => {
      saveUiState({
        ...loadUiState(),
        drawerWidth,
        sidebarWidth,
        expandedSections: Array.from(expandedSections),
        expandedCrdGroups: Array.from(expandedCrdGroups),
        section,
        resourceTab,
        namespace,
        selectedNamespaces,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [drawerWidth, sidebarWidth, expandedSections, expandedCrdGroups, section, resourceTab, namespace, selectedNamespaces]);
}
