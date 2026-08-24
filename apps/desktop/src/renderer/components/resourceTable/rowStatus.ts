import { formatCpuNotation, formatMemoryNotation } from "../../../shared/formatQuantity";
import type { ResourceRow } from "../../types";
import { isKubernetesFailure } from "../../utils/kubernetesStatusTone";

export type ContainerTone = "ready" | "running" | "waiting" | "danger" | "terminated" | "unknown";

export interface ContainerStatusItem {
  name: string;
  tone: ContainerTone;
  title: string;
}

export function normalizeContainerStatusItems(row: ResourceRow): ContainerStatusItem[] {
  const rawStates = row.containerStates;
  if (Array.isArray(rawStates) && rawStates.length > 0) {
    return rawStates.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const name = String(record.name || `container-${index + 1}`);
      const state = String(record.state || "unknown").toLowerCase();
      const ready = record.ready === true;
      const reason = String(record.reason || "");
      const restartCount = Number(record.restartCount ?? 0);
      const tone = containerTone(state, ready, reason);
      const details = [ready ? "ready" : "not ready", state && state !== "unknown" ? state : "", reason, Number.isFinite(restartCount) && restartCount > 0 ? `${restartCount} restarts` : ""]
        .filter(Boolean)
        .join(", ");
      return [{ name, tone, title: `${name}: ${details || "unknown"}` }];
    });
  }

  const rawContainers = row.containers;
  if (!Array.isArray(rawContainers)) return [];
  return rawContainers.flatMap((name, index) => {
    const label = String(name || `container-${index + 1}`);
    return label ? [{ name: label, tone: "unknown" as const, title: `${label}: unknown` }] : [];
  });
}

export function containerTone(state: string, ready: boolean, reason: string): ContainerTone {
  if (ready) return "ready";
  if (/^not\s*ready$/i.test(reason.trim())) return "waiting";
  if (isKubernetesFailure(reason)) return "danger";
  if (state === "terminated") return "waiting";
  if (state === "waiting") return "waiting";
  if (state === "running") return "running";
  return "unknown";
}

export function rowHealthReason(row: ResourceRow) {
  const phase = String(row.phase ?? "");
  const ready = String(row.ready ?? "");
  const reason = String(row.reason ?? "");
  const statusMessage = String(row.statusMessage ?? "");
  const containerProblems = String(row.containerProblems ?? "");
  const conditions = String(row.conditions ?? "");
  if (["Succeeded", "Completed"].includes(phase)) return "";
  if (containerProblems) return compactReason(containerProblems);
  if (reason || statusMessage) return compactReason(reason || statusMessage);
  if (conditions) return compactReason(conditions);
  if (phase && !["Running", "Succeeded", "Completed"].includes(phase)) return phase;
  if (phase === "Running" && ready.includes("/")) {
    const [current, total] = ready.split("/");
    if (total && current !== total) return `Ready ${ready}`;
  }
  return "";
}

export function compactReason(value: string) {
  const first = value.split(";")[0]?.trim() ?? value;
  return first.length > 72 ? `${first.slice(0, 69)}...` : first;
}

export function unclampedPercent(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? "").replace("%", ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

// Kubernetes notation, not the display format: the bar prints these beside
// row.cpuUsage, which metrics.ts writes in the same notation, and one bar
// cannot read "403840Ki used · 1.5 cores limit". An unset limit prints nothing
// rather than a zero, which would read as a limit of zero.
export const formatCpuValue = (value: unknown) => (Number(value) > 0 ? formatCpuNotation(value) : "");

export const formatByteValue = (value: unknown) => (Number(value) > 0 ? formatMemoryNotation(value) : "");
