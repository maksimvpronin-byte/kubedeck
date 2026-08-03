import { useMemo } from "react";
import type { CommandPaletteItem } from "../components/CommandPalette";
import { resourceLabel, resourceTree, sections } from "../navigation";
import type { Cluster, GlobalSearchItem, ResourceDefinition, ResourceRow, Section } from "../types";
import { groupCrds } from "../utils/kubeResources";

interface Options {
  t: (key: string) => string;
  clusters: Cluster[];
  activeCluster: Cluster | null;
  crdGroups: ReturnType<typeof groupCrds>;
  globalSearchResults: GlobalSearchItem[];
  activeRows: ResourceRow[];
  resourceTab: string;
  namespace: string;
  resourceDefinitions: ResourceDefinition[];
  confirmDrawerNavigation: () => boolean;
  openCluster: (cluster: Cluster) => Promise<void> | void;
  selectSection: (section: Section) => void;
  selectTreeResource: (section: Section, resource: string) => void;
  keepCurrentSelection: () => void;
  cancelResourceNavigation: () => void;
  setSelectedTarget: (target: { clusterId: string; resource: string; row: ResourceRow }) => void;
  setNamespaceSelection: (namespace: string) => void;
  openResourceLocator: (row: ResourceRow) => Promise<void> | void;
}

export function useCommandPaletteItems({
  t,
  clusters,
  activeCluster,
  crdGroups,
  globalSearchResults,
  activeRows,
  resourceTab,
  namespace,
  resourceDefinitions,
  confirmDrawerNavigation,
  openCluster,
  selectSection,
  selectTreeResource,
  keepCurrentSelection,
  cancelResourceNavigation,
  setSelectedTarget,
  setNamespaceSelection,
  openResourceLocator,
}: Options): CommandPaletteItem[] {
  return useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [];

    for (const item of sections) {
      items.push({
        id: `section:${item.id}`,
        title: t(item.label),
        subtitle: t("command.openSection"),
        category: t("command.category.navigation"),
        keywords: `${item.id} ${t(item.label)}`,
        run: () => selectSection(item.id),
      });
    }

    for (const [sectionId, resources] of Object.entries(resourceTree)) {
      for (const resource of resources) {
        items.push({
          id: `resource:${sectionId}:${resource}`,
          title: resourceLabel(resource),
          subtitle: `${t("command.open")} ${t(`nav.${sectionId}`)}`,
          category: t("command.category.resource"),
          keywords: `${sectionId} ${resource} ${resourceLabel(resource)}`,
          run: () => selectTreeResource(sectionId as Section, resource),
        });
      }
    }

    for (const group of crdGroups) {
      for (const crd of group.items) {
        items.push({
          id: `crd:${crd.resource}`,
          title: crd.kind || crd.plural || crd.resource,
          subtitle: `CRD Р’В· ${group.group}`,
          category: t("nav.crd"),
          keywords: `${crd.kind} ${crd.plural} ${crd.resource} ${group.group}`,
          run: () => selectTreeResource("crd", crd.resource),
        });
      }
    }

    for (const cluster of clusters) {
      items.push({
        id: `cluster:${cluster.id}`,
        title: cluster.displayName,
        subtitle: cluster.id === activeCluster?.id ? t("command.currentCluster") : t("command.openCluster"),
        category: t("command.category.cluster"),
        keywords: `${cluster.displayName} ${cluster.kubeconfigPath}`,
        run: () => {
          if (!confirmDrawerNavigation()) return;
          void openCluster(cluster);
        },
      });
    }

    for (const row of activeRows.slice(0, 500)) {
      const rowName = String(row.name ?? "");
      if (!rowName) continue;
      const rowNamespace = String(row.namespace ?? "");
      items.push({
        id: `row:${resourceTab}:${rowNamespace}:${rowName}:${String(row.uid ?? rowName)}`,
        title: rowName,
        subtitle: `${resourceLabel(resourceTab)}${rowNamespace ? ` Р’В· ${rowNamespace}` : ""}`,
        category: t("command.category.open"),
        keywords: `${resourceTab} ${rowName} ${rowNamespace} ${String(row.kind ?? "")} ${String(row.status ?? "")} ${String(row.phase ?? "")}`,
        run: () => {
          if (!confirmDrawerNavigation()) return;
          cancelResourceNavigation();
          keepCurrentSelection();
          if (activeCluster) setSelectedTarget({ clusterId: activeCluster.id, resource: resourceTab, row });
          if (rowNamespace && rowNamespace !== "_cluster" && namespace !== "_cluster") setNamespaceSelection(rowNamespace);
        },
      });
    }

    for (const result of globalSearchResults) {
      const resource = String(result.resource || "");
      const resultNamespace = String(result.namespace || "");
      const matchedFields = Array.isArray(result.matchedFields) && result.matchedFields.length ? ` Р’В· match: ${result.matchedFields.join(", ")}` : "";
      items.push({
        id: `global:${resource}:${resultNamespace}:${result.name}:${result.uid}`,
        title: String(result.title || result.name || resource),
        subtitle: `${resourceLabel(resource)}${resultNamespace && resultNamespace !== "_cluster" ? ` Р’В· ${resultNamespace}` : ""}${matchedFields}`,
        category: t("command.category.clusterSearch"),
        keywords: `${resource} ${result.name ?? ""} ${resultNamespace} ${result.kind ?? ""} ${result.status ?? ""} ${result.phase ?? ""} ${(result.matchedFields ?? []).join(" ")}`,
        run: () => void openResourceLocator(result),
      });
    }

    return items;
  }, [activeRows, activeCluster?.id, clusters, crdGroups, globalSearchResults, namespace, resourceDefinitions, resourceTab, t]);
}
