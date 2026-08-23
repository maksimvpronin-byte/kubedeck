// The classification behind the Problems panel: which category a row falls
// into, what advice goes with it, and how a row is summarised for the
// clipboard. Pure functions, so they can be tested without a React tree.
import type { Cluster, ResourceRow } from "../types";

export type SeverityFilter = "all" | "critical" | "warning" | "info";

export type ProblemCategory = "crashLoop" | "imagePull" | "scheduling" | "node" | "storage" | "restarts" | "probe" | "deployment" | "event" | "podPhase" | "generic";

export interface GuidanceItem {
  key: string;
  title: string;
  nextCheck: string;
  severity: "critical" | "warning" | "info";
  count: number;
}

export function summarizeGuidance(rows: ResourceRow[], t: (key: string) => string) {
  const buckets = new Map<string, GuidanceItem>();
  for (const row of rows) {
    const category = problemCategory(row);
    const advice = problemAdvice(row, t);
    const current = buckets.get(category);
    if (current) {
      current.count += 1;
    } else {
      buckets.set(category, {
        key: category,
        title: advice.summary,
        nextCheck: advice.nextCheck,
        severity: normalizeSeverity(readString(row, "severity", "info")),
        count: 1,
      });
    }
  }
  return Array.from(buckets.values())
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.count - a.count)
    .slice(0, 4);
}

export function problemAdvice(row: ResourceRow, t: (key: string) => string) {
  const category = problemCategory(row);
  if (category !== "generic") return advice(category, t);
  const text = ["reason", "message", "phase", "status", "statusMessage", "containerProblems", "conditions", "kind"].map((key) => readString(row, key).toLowerCase()).join(" ");

  if (text.includes("crashloop") || text.includes("back-off restarting")) return advice("crashLoop", t);
  if (text.includes("imagepull") || text.includes("errimagepull") || text.includes("pull image")) return advice("imagePull", t);
  if (text.includes("unschedulable") || text.includes("pending") || text.includes("taint") || text.includes("insufficient")) return advice("scheduling", t);
  if (text.includes("notready") || text.includes("node not ready") || text.includes("nodepressure")) return advice("node", t);
  if (text.includes("persistentvolume") || text.includes("pvc") || text.includes("storageclass") || text.includes("volume")) return advice("storage", t);
  if (text.includes("restart") || text.includes("restarts")) return advice("restarts", t);
  if (text.includes("probe") || text.includes("unhealthy")) return advice("probe", t);
  if (readString(row, "kind").toLowerCase().includes("event")) return advice("event", t);
  return advice("generic", t);
}

export function advice(key: string, t: (key: string) => string) {
  return {
    key,
    summary: t(`problems.advice.${key}.summary`),
    nextCheck: t(`problems.advice.${key}.next`),
  };
}

export function problemOpenLocator(row: ResourceRow): ResourceRow {
  const targetResource = readString(row, "targetResource") || readString(row, "resource");
  const targetName = readString(row, "targetName") || readString(row, "name");
  const targetNamespace = readString(row, "targetNamespace") || readString(row, "namespace");
  const targetKind = readString(row, "targetKind") || readString(row, "kind");
  if (!targetResource || !targetName) return row;
  return {
    ...row,
    uid: `${targetResource}:${targetNamespace || "_cluster"}:${targetName}`,
    resource: targetResource,
    kind: targetKind,
    namespace: targetNamespace,
    name: targetName,
  } as ResourceRow;
}

export function problemDiagnosticText(row: ResourceRow, cluster: Cluster | null, t: (key: string) => string) {
  const target = problemTargetLabel(row);
  const lines = [
    `${t("problems.copy.cluster")}: ${cluster?.displayName ?? ""}`,
    `${t("problems.copy.severity")}: ${readString(row, "severity")}`,
    `${t("problems.copy.category")}: ${categoryLabel(problemCategory(row), t)}`,
    `${t("problems.copy.resource")}: ${target}`,
    `${t("problems.copy.reason")}: ${readString(row, "reason")}`,
    `${t("problems.copy.message")}: ${readString(row, "message")}`,
    `${t("problems.copy.nextCheck")}: ${readString(row, "nextCheck") || problemAdvice(row, t).nextCheck}`,
  ];
  const sourceResource = `${readString(row, "resource")}/${readString(row, "namespace") || "_cluster"}/${readString(row, "name")}`;
  if (sourceResource !== target) lines.push(`${t("problems.copy.source")}: ${sourceResource}`);
  return lines.join("\n");
}

export function problemTargetLabel(row: ResourceRow) {
  const targetResource = readString(row, "targetResource") || readString(row, "resource");
  const targetNamespace = readString(row, "targetNamespace") || readString(row, "namespace") || "_cluster";
  const targetName = readString(row, "targetName") || readString(row, "name");
  return `${targetResource}/${targetNamespace}/${targetName}`;
}

export function problemCategory(row: ResourceRow): ProblemCategory {
  const category = readString(row, "category");
  if (["crashLoop", "imagePull", "scheduling", "node", "storage", "restarts", "probe", "deployment", "event", "podPhase", "generic"].includes(category)) {
    return category as ProblemCategory;
  }
  return "generic";
}

export function categoryLabel(category: string, t: (key: string) => string) {
  return t(`problems.category.${category || "generic"}`);
}

export function readString(row: ResourceRow, key: string, fallback = "") {
  const value = (row as Record<string, unknown>)[key];
  if (value === null || value === undefined) return fallback;
  return String(value);
}

export function normalizeSeverity(value: unknown): "critical" | "warning" | "info" {
  const severity = String(value ?? "info").toLowerCase();
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  return "info";
}

export function severityRank(severity: "critical" | "warning" | "info") {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
}

export function rowKey(row: ResourceRow) {
  return readString(row, "uid") || `${readString(row, "namespace", "_cluster")}-${readString(row, "name")}`;
}

export function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
