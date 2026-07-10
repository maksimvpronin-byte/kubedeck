import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ErrorInfo, ResourceDefinition, ResourceRow } from "../types";
import { asErrorInfo } from "../utils/errors";
import { findResourceDefinition } from "../utils/kubeResources";

export type NodeActionKind = "cordon" | "uncordon" | "drain";
export interface NodeActionConfirmation {
  action: NodeActionKind;
  rows: ResourceRow[];
  commandPreview: string;
  affectedPods?: ResourceRow[];
  previewLoading?: boolean;
  previewError?: string;
}
export interface BulkDeleteTarget { resource: string; rows: ResourceRow[] }

export interface BulkActionFailure { row: ResourceRow; message: string }

interface PartialActionErrorOptions {
  label: string;
  resource: string;
  completedCount: number;
  failures: BulkActionFailure[];
  commandPreview?: string;
  message?: string;
}

const SENSITIVE_ERROR_PATTERN = /(?:authorization|bearer|client[-_ ]?secret|password|private[-_ ]?key|secret|token)\b/i;

export function safeBulkFailureMessage(message: string) {
  const normalized = String(message || "Action failed").replace(/\s+/g, " ").trim();
  return SENSITIVE_ERROR_PATTERN.test(normalized) ? "Sensitive error details were redacted" : normalized;
}

export function buildPartialActionError(options: PartialActionErrorOptions): ErrorInfo {
  const { label, resource, completedCount, failures, commandPreview = "" } = options;
  const message = options.message ?? `${label} partial result. Completed: ${completedCount}. Failed: ${failures.length}.`;
  return {
    code: "PARTIAL_RESULT",
    message,
    rawStderr: failures
      .map((item) => `${resource} ${resourceIdentityLabel(item.row)} - ${safeBulkFailureMessage(item.message)}`)
      .join("\n"),
    commandPreview,
  };
}

export function resourceIdentityLabel(row: ResourceRow) {
  return `${row.namespace || "_cluster"}/${row.name}`;
}

export function markDeletingRow(resource: string, row: ResourceRow): ResourceRow {
  const next: ResourceRow = {
    ...row,
    deletionTimestamp: typeof row.deletionTimestamp === "string" && row.deletionTimestamp ? row.deletionTimestamp : new Date().toISOString(),
    status: "Terminating",
  };
  if (resource === "pods" || resource === "pod") next.phase = "Terminating";
  return next;
}

export function bulkDeleteListText(resource: string, rows: ResourceRow[]) {
  return rows.map((row) => `${resource} ${resourceIdentityLabel(row)}`).join("\n");
}

export function bulkDeleteNamespaceSummary(rows: ResourceRow[]) {
  const namespaces = Array.from(new Set(rows.map((row) => row.namespace || "_cluster"))).sort();
  if (namespaces.length <= 3) return namespaces.join(", ");
  return `${namespaces.slice(0, 3).join(", ")} +${namespaces.length - 3}`;
}

export function nodeActionLabel(action: NodeActionKind) {
  if (action === "cordon") return "Cordon";
  if (action === "uncordon") return "Uncordon";
  return "Drain";
}

interface Options {
  api: ApiClient | null;
  activeCluster: Cluster | null;
  resourceDefinitions: ResourceDefinition[];
  selectedResource: string;
  selectedRow: ResourceRow | null;
  selectedNamespaces: string[];
  setRows: Dispatch<SetStateAction<Record<string, ResourceRow[]>>>;
  setSelectedRow: Dispatch<SetStateAction<ResourceRow | null>>;
  setError: Dispatch<SetStateAction<ErrorInfo | null>>;
  reloadResources: (clusterId: string, resource: string, namespaces: string[]) => Promise<void>;
  t: (key: string) => string;
}

export function useBulkResourceActions(options: Options) {
  const {
    api, activeCluster, resourceDefinitions, selectedResource, selectedRow, selectedNamespaces,
    setRows, setSelectedRow, setError, reloadResources, t,
  } = options;
  const [bulkDelete, setBulkDelete] = useState<BulkDeleteTarget | null>(null);
  const [nodeActionConfirmation, setNodeActionConfirmation] = useState<NodeActionConfirmation | null>(null);
  const [message, setMessage] = useState("");

  const clearPendingActions = useCallback(() => {
    setBulkDelete(null);
    setNodeActionConfirmation(null);
  }, []);

  const requestBulkDelete = useCallback((resource: string, rows: ResourceRow[]) => {
    setMessage("");
    setBulkDelete({ resource, rows });
  }, []);

  const closeBulkDelete = useCallback(() => setBulkDelete(null), []);
  const closeNodeAction = useCallback(() => setNodeActionConfirmation(null), []);

  const copyBulkDeleteList = useCallback(async () => {
    if (!bulkDelete || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(bulkDeleteListText(bulkDelete.resource, bulkDelete.rows));
    } catch (error) {
      setError(asErrorInfo(error));
    }
  }, [bulkDelete, setError]);

  const confirmBulkDelete = useCallback(async () => {
    if (!api || !activeCluster || !bulkDelete) return;
    const target = bulkDelete;
    setBulkDelete(null);
    setMessage(`${t("bulkDelete.requested")}: ${target.rows.length} ${target.resource}`);
    setError(null);

    const deletingKeys = new Set(target.rows.map(resourceIdentityLabel));
    setRows((current) => ({
      ...current,
      [target.resource]: (current[target.resource] ?? []).map((row) =>
        deletingKeys.has(resourceIdentityLabel(row)) ? markDeletingRow(target.resource, row) : row),
    }));
    if (selectedResource === target.resource && selectedRow && deletingKeys.has(resourceIdentityLabel(selectedRow))) {
      setSelectedRow(markDeletingRow(target.resource, selectedRow));
    }

    const deletedRows: ResourceRow[] = [];
    const failures: BulkActionFailure[] = [];
    for (const row of target.rows) {
      try {
        const definition = findResourceDefinition(resourceDefinitions, target.resource);
        const namespace = definition?.namespaced === false ? "_cluster" : String(row.namespace || "_cluster");
        await api.resourceAction(activeCluster.id, target.resource, namespace, row.name, "delete");
        deletedRows.push(row);
      } catch (error) {
        const info = asErrorInfo(error);
        failures.push({ row, message: info.message || info.code || "Delete failed" });
      }
    }

    if (deletedRows.length) {
      const deletedKeys = new Set(deletedRows.map(resourceIdentityLabel));
      if (selectedResource === target.resource && selectedRow && deletedKeys.has(resourceIdentityLabel(selectedRow))) setSelectedRow(null);
      await reloadResources(activeCluster.id, target.resource, selectedNamespaces).catch((error) => setError(asErrorInfo(error)));
    }
    if (failures.length) {
      const resultMessage = `${t("bulkDelete.partialResult")}. ${t("bulkDelete.deleted")}: ${deletedRows.length}. ${t("bulkDelete.failed")}: ${failures.length}.`;
      const error = buildPartialActionError({
        label: t("bulkDelete.partialResult"),
        resource: target.resource,
        completedCount: deletedRows.length,
        failures,
        message: resultMessage,
      });
      setMessage(resultMessage);
      setError(error);
      return;
    }
    setMessage(`${t("bulkDelete.completed")}. ${t("bulkDelete.deleted")}: ${deletedRows.length}.`);
    setError(null);
  }, [
    api, activeCluster, bulkDelete, t, setError, setRows, selectedResource, selectedRow,
    setSelectedRow, resourceDefinitions, reloadResources, selectedNamespaces,
  ]);

  const requestNodeAction = useCallback(async (action: NodeActionKind, rows: ResourceRow[]) => {
    if (!api || !activeCluster || rows.length === 0) return;
    const commandPreview = rows.map((row) => action === "drain"
      ? `kubectl drain ${row.name} --ignore-daemonsets --delete-emptydir-data --timeout=300s`
      : `kubectl ${action} ${row.name}`).join("\n");
    if (action !== "drain") {
      setNodeActionConfirmation({ action, rows, commandPreview });
      return;
    }
    const nodeNames = new Set(rows.map((row) => String(row.name)));
    setNodeActionConfirmation({ action, rows, commandPreview, affectedPods: [], previewLoading: true });
    try {
      const response = await api.resources(activeCluster.id, "pods", "all", undefined, { useCache: false, forceRefresh: true });
      const affectedPods = response.items
        .filter((pod) => nodeNames.has(String(pod.node ?? "")))
        .sort((left, right) => `${left.namespace ?? ""}/${left.name}`.localeCompare(`${right.namespace ?? ""}/${right.name}`, undefined, { numeric: true }));
      setNodeActionConfirmation({ action, rows, commandPreview, affectedPods, previewLoading: false });
    } catch (error) {
      const info = asErrorInfo(error);
      setNodeActionConfirmation({ action, rows, commandPreview, affectedPods: [], previewLoading: false, previewError: info.message || info.code || "Failed to load affected pods preview" });
    }
  }, [api, activeCluster]);

  const confirmNodeAction = useCallback(async () => {
    if (!api || !activeCluster || !nodeActionConfirmation) return;
    const target = nodeActionConfirmation;
    const label = nodeActionLabel(target.action);
    setNodeActionConfirmation(null);
    setMessage(`${label} requested: ${target.rows.length} node(s)`);
    setError(null);
    const completed: ResourceRow[] = [];
    const failures: BulkActionFailure[] = [];
    for (const row of target.rows) {
      try {
        await api.resourceAction(activeCluster.id, "nodes", "_cluster", row.name, target.action);
        completed.push(row);
      } catch (error) {
        const info = asErrorInfo(error);
        failures.push({ row, message: info.message || info.code || `${label} failed` });
      }
    }
    await reloadResources(activeCluster.id, "nodes", ["_cluster"]).catch((error) => setError(asErrorInfo(error)));
    if (failures.length) {
      const error = buildPartialActionError({ label, resource: "nodes", completedCount: completed.length, failures, commandPreview: target.commandPreview });
      setMessage(error.message);
      setError(error);
      return;
    }
    setMessage(`${label} completed. Nodes: ${completed.length}.`);
    setError(null);
  }, [api, activeCluster, nodeActionConfirmation, reloadResources, setError]);

  return {
    bulkDelete,
    nodeActionConfirmation,
    message,
    clearMessage: () => setMessage(""),
    clearPendingActions,
    requestBulkDelete,
    closeBulkDelete,
    copyBulkDeleteList,
    confirmBulkDelete,
    requestNodeAction,
    closeNodeAction,
    confirmNodeAction,
  };
}
