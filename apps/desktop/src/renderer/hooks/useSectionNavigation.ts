import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { resourceTree } from "../navigation";
import type { Section } from "../types";
import type { ResourceDefinition } from "../types";
import { findResourceDefinition } from "../utils/kubeResources";
import type { SelectedResourceTarget } from "./useResourceNavigation";

interface Options {
  selectedNamespaces: string[];
  resourceDefinitions: ResourceDefinition[];
  setSection: Dispatch<SetStateAction<Section>>;
  setResourceTab: Dispatch<SetStateAction<string>>;
  setExpandedSections: Dispatch<SetStateAction<Set<string>>>;
  setExpandedCrdGroups: Dispatch<SetStateAction<Set<string>>>;
  setSelectedTarget: Dispatch<SetStateAction<SelectedResourceTarget | null>>;
  setNamespaceSelection: (value: string | string[]) => void;
  restoreNamespacedSelection: () => void;
  cancelResourceNavigation: () => void;
  confirmDrawerNavigation: () => boolean;
}

export interface SectionNavigation {
  selectSection: (next: Section) => void;
  selectTreeResource: (sectionId: Section, resource: string) => void;
  toggleSection: (sectionId: Section) => void;
  toggleCrdGroup: (group: string) => void;
}

// Which tab and which namespace scope a section opens with. Picking a section
// is never only "show this section": a cluster-scoped one has to switch the
// namespace selector to _cluster, and leaving it has to put back the namespaces
// the user had chosen for this cluster.
export function useSectionNavigation({
  selectedNamespaces,
  resourceDefinitions,
  setSection,
  setResourceTab,
  setExpandedSections,
  setExpandedCrdGroups,
  setSelectedTarget,
  setNamespaceSelection,
  restoreNamespacedSelection,
  cancelResourceNavigation,
  confirmDrawerNavigation,
}: Options): SectionNavigation {
  const restoreNamespacesIfClusterScoped = useCallback(() => {
    if (selectedNamespaces.includes("_cluster")) restoreNamespacedSelection();
  }, [selectedNamespaces, restoreNamespacedSelection]);

  const selectSection = useCallback(
    (next: Section) => {
      if (!confirmDrawerNavigation()) return;
      cancelResourceNavigation();
      setSection(next);

      if (resourceTree[next]) {
        setExpandedSections((current) => new Set(current).add(next));
      }

      if (next === "nodes") {
        setResourceTab("nodes");
        setNamespaceSelection("_cluster");
        return;
      }

      if (next === "overview") {
        restoreNamespacesIfClusterScoped();
        return;
      }

      if (next === "namespaces") {
        setResourceTab("namespaces");
        setNamespaceSelection("_cluster");
        return;
      }

      if (next === "crd") {
        setResourceTab("customresourcedefinitions");
        setNamespaceSelection("_cluster");
        return;
      }

      if (next === "rbac") {
        setResourceTab("serviceaccounts");
        restoreNamespacesIfClusterScoped();
        return;
      }

      if (next === "workloads") {
        setResourceTab("pods");
        restoreNamespacesIfClusterScoped();
        return;
      }

      if (next === "network") {
        setResourceTab("services");
        restoreNamespacesIfClusterScoped();
        return;
      }

      if (next === "storage") {
        setResourceTab("persistentvolumeclaims");
        restoreNamespacesIfClusterScoped();
        return;
      }

      if (next === "config") {
        setResourceTab("configmaps");
        restoreNamespacesIfClusterScoped();
        return;
      }

      if (next === "events") {
        setResourceTab("events");
        restoreNamespacesIfClusterScoped();
      }
    },
    [confirmDrawerNavigation, cancelResourceNavigation, setSection, setExpandedSections, setResourceTab, setNamespaceSelection, restoreNamespacesIfClusterScoped],
  );

  const selectTreeResource = useCallback(
    (sectionId: Section, resource: string) => {
      if (!confirmDrawerNavigation()) return;
      cancelResourceNavigation();
      if (resource === "port-forwards") {
        setSection("port-forwards");
        setResourceTab("port-forwards");
        setSelectedTarget(null);
        return;
      }
      setSection(sectionId);
      setResourceTab(resource);
      if (resource === "customresourcedefinitions") {
        setNamespaceSelection("_cluster");
        return;
      }
      const definition = findResourceDefinition(resourceDefinitions, resource);
      if (definition && !definition.namespaced) {
        setNamespaceSelection("_cluster");
      } else {
        restoreNamespacesIfClusterScoped();
      }
    },
    [confirmDrawerNavigation, cancelResourceNavigation, setSection, setResourceTab, setSelectedTarget, setNamespaceSelection, resourceDefinitions, restoreNamespacesIfClusterScoped],
  );

  const toggleSection = useCallback(
    (sectionId: Section) => {
      setExpandedSections((current) => {
        const next = new Set(current);
        if (next.has(sectionId)) next.delete(sectionId);
        else next.add(sectionId);
        return next;
      });
    },
    [setExpandedSections],
  );

  const toggleCrdGroup = useCallback(
    (group: string) => {
      setExpandedCrdGroups((current) => {
        const next = new Set(current);
        if (next.has(group)) next.delete(group);
        else next.add(group);
        return next;
      });
    },
    [setExpandedCrdGroups],
  );

  return { selectSection, selectTreeResource, toggleSection, toggleCrdGroup };
}
