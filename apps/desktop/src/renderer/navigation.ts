import {
  Boxes,
  ClipboardList,
  Database,
  FolderCog,
  HardDrive,
  HelpCircle,
  Info,
  Layers,
  Library,
  Network,
  Server,
  Settings as SettingsIcon,
  ShieldAlert,
  SplitSquareHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { Section } from "./types";

export const sections: Array<{ id: Section; icon: LucideIcon; label: string }> = [
  { id: "nodes", icon: Server, label: "nav.nodes" },
  { id: "problems", icon: ShieldAlert, label: "nav.problems" },
  { id: "workloads", icon: Boxes, label: "nav.workloads" },
  { id: "config", icon: FolderCog, label: "nav.config" },
  { id: "namespaces", icon: Library, label: "nav.namespaces" },
  { id: "network", icon: Network, label: "nav.network" },
  { id: "rbac", icon: ShieldAlert, label: "nav.rbac" },
  { id: "storage", icon: HardDrive, label: "nav.storage" },
  { id: "crd", icon: Layers, label: "nav.crd" },
  { id: "events", icon: SplitSquareHorizontal, label: "nav.events" },
  { id: "audit", icon: ClipboardList, label: "nav.audit" },
  { id: "help", icon: HelpCircle, label: "nav.help" },
  { id: "about", icon: Info, label: "nav.about" },
  { id: "settings", icon: SettingsIcon, label: "nav.settings" },
];

export const resourceTree: Record<string, string[]> = {
  namespaces: ["namespaces", "resourcequotas", "limitranges", "networkpolicies"],
  rbac: ["serviceaccounts", "roles", "rolebindings", "clusterroles", "clusterrolebindings"],
  workloads: ["pods", "deployments", "statefulsets", "daemonsets", "jobs", "cronjobs", "replicasets"],
  network: ["services", "ingresses", "endpoints", "port-forwards"],
  storage: ["persistentvolumeclaims", "persistentvolumes", "storageclasses"],
  config: [
    "configmaps",
    "secrets",
    "horizontalpodautoscalers",
    "verticalpodautoscalers",
    "poddisruptionbudgets",
    "priorityclasses",
    "runtimeclasses",
    "leases",
    "mutatingwebhookconfigurations",
    "validatingwebhookconfigurations",
  ],
  crd: ["customresourcedefinitions"],
  events: ["events"],
};

export function visibleTabs(section: Section, current: string): string[] {
  const bySection: Record<string, string[]> = {
    nodes: ["nodes"],
    ...resourceTree,
  };
  const tabs = bySection[section] ?? [];
  if (section === "crd" && current !== "customresourcedefinitions") return [current, "customresourcedefinitions"];
  return tabs.includes(current) || tabs.length === 0 ? tabs : [current, ...tabs];
}

export function sectionForResource(resource: string): Section | null {
  if (resource === "nodes") return "nodes";
  for (const [sectionId, resources] of Object.entries(resourceTree)) {
    if (resources.includes(resource)) return sectionId as Section;
  }
  if (resource.includes(".")) return "crd";
  return null;
}

export function normalizeStoredSection(value: unknown): Section {
  if (value === "overview" || value === "nodes" || !value) return "nodes";
  const known: Section[] = ["problems", "namespaces", "rbac", "workloads", "network", "storage", "config", "crd", "events", "audit", "about", "port-forwards", "help", "settings"];
  return known.includes(value as Section) ? value as Section : "nodes";
}

export function resourceLabel(resource: string) {
  const labels: Record<string, string> = {
    nodes: "Nodes",
    namespaces: "Namespaces",
    resourcequotas: "ResourceQuotas",
    limitranges: "LimitRanges",
    horizontalpodautoscalers: "HorizontalPodAutoscalers",
    verticalpodautoscalers: "VerticalPodAutoscalers",
    poddisruptionbudgets: "PodDisruptionBudgets",
    priorityclasses: "PriorityClasses",
    runtimeclasses: "RuntimeClasses",
    leases: "Leases",
    mutatingwebhookconfigurations: "MutatingWebhookConfigs",
    validatingwebhookconfigurations: "ValidatingWebhookConfigs",
    roles: "Roles",
    rolebindings: "RoleBindings",
    clusterroles: "ClusterRoles",
    clusterrolebindings: "ClusterRoleBindings",
    pods: "Pods",
    deployments: "Deployments",
    services: "Services",
    events: "Events",
    statefulsets: "StatefulSets",
    daemonsets: "DaemonSets",
    jobs: "Jobs",
    cronjobs: "CronJobs",
    replicasets: "ReplicaSets",
    ingresses: "Ingresses",
    endpoints: "Endpoints",
    "port-forwards": "Пробросы портов",
    networkpolicies: "NetworkPolicies",
    persistentvolumeclaims: "PVC",
    persistentvolumes: "PV",
    storageclasses: "StorageClasses",
    configmaps: "ConfigMaps",
    secrets: "Secrets",
    serviceaccounts: "ServiceAccounts",
    customresourcedefinitions: "CRD",
  };
  return labels[resource] ?? resource;
}

export function isPlaceholderSection(section: Section) {
  void section;
  return false;
}

export function sectionTitle(section: Section, resourceTab: string, t: (key: string) => string) {
  if (section === "network") return t("nav.network");
  if (section === "namespaces") return t("nav.namespaces");
  if (section === "rbac") return t("nav.rbac");
  if (section === "storage") return t("nav.storage");
  if (section === "config") return t("nav.config");
  if (section === "crd") return resourceTab === "customresourcedefinitions" ? t("nav.crd") : resourceLabel(resourceTab);
  if (section === "events") return t("nav.events");
  if (section === "audit") return t("nav.audit");
  if (section === "about") return t("nav.about");
  if (section === "nodes") return resourceLabel("nodes");
  return resourceLabel(resourceTab);
}

export const brandIcon = Database;
