import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ApiClient, BulkActionResult, BulkActionTarget } from "../api";
import type { Cluster, ErrorInfo, ResourceDefinition, ResourceRow } from "../types";
import { asErrorInfo } from "../utils/errors";
import { findResourceDefinition } from "../utils/kubeResources";
import { nodeLabelCommandPreview, planNodeLabelChanges, type NodeLabelChanges } from "../utils/nodeLabels";

export type NodeActionKind = "cordon" | "uncordon" | "drain";
export interface NodeActionConfirmation {
  clusterId: string;
  action: NodeActionKind;
  rows: ResourceRow[];
  commandPreview: string;
  affectedPods?: ResourceRow[];
  previewLoading?: boolean;
  previewError?: string;
}
export interface NodeLabelTarget {
  clusterId: string;
  rows: ResourceRow[];
}
export interface BulkDeleteTarget {
  clusterId: string;
  resource: string;
  rows: ResourceRow[];
}

export interface BulkActionFailure {
  row: ResourceRow;
  message: string;
}

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
  const normalized = String(message || "Action failed")
    .replace(/\s+/g, " ")
    .trim();
  return SENSITIVE_ERROR_PATTERN.test(normalized) ? "Sensitive error details were redacted" : normalized;
}

export function buildPartialActionError(options: PartialActionErrorOptions): ErrorInfo {
  const { label, resource, completedCount, failures, commandPreview = "" } = options;
  const message = options.message ?? `${label} partial result. Completed: ${completedCount}. Failed: ${failures.length}.`;
  return {
    code: "PARTIAL_RESULT",
    message,
    rawStderr: failures.map((item) => `${resource} ${resourceIdentityLabel(item.row)} - ${safeBulkFailureMessage(item.message)}`).join("\n"),
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

export function selectedRowAfterBulkDelete(targetResource: string, selectedResource: string, selectedRow: ResourceRow | null, deletedRows: ResourceRow[], failures: BulkActionFailure[]) {
  if (!selectedRow || selectedResource !== targetResource) return selectedRow;
  const selectedIdentity = resourceIdentityLabel(selectedRow);
  if (deletedRows.some((row) => resourceIdentityLabel(row) === selectedIdentity)) return null;
  return failures.find((failure) => resourceIdentityLabel(failure.row) === selectedIdentity)?.row ?? selectedRow;
}

// What runs, in the order it runs. Cordon and uncordon name every selected
// node in one command; a drain cordons them all that way first, so pods leaving
// one node cannot be scheduled onto the next one in line, and then drains five
// nodes at a time.
export function nodeActionCommandPreview(action: NodeActionKind, names: string[]) {
  const all = `kubectl ${action === "drain" ? "cordon" : action} ${names.join(" ")}`;
  if (action !== "drain") return all;
  return [all, ...names.map((name) => `kubectl drain ${name} --ignore-daemonsets --delete-emptydir-data --timeout=300s`)].join("\n");
}

// Pairs each row with its result from one bulk request. A request that failed
// as a whole fails every row with the same reason.
export async function runBulkAction(
  run: () => Promise<{ results: BulkActionResult[] }>,
  entries: Array<{ row: ResourceRow; target: BulkActionTarget }>,
  fallbackMessage: string,
): Promise<{ completed: ResourceRow[]; failures: BulkActionFailure[] }> {
  const completed: ResourceRow[] = [];
  const failures: BulkActionFailure[] = [];
  let results: BulkActionResult[];
  try {
    results = (await run()).results ?? [];
  } catch (error) {
    const info = asErrorInfo(error);
    return { completed, failures: entries.map(({ row }) => ({ row, message: info.message || info.code || fallbackMessage })) };
  }
  const byKey = new Map(results.map((result) => [`${result.namespace}/${result.name}`, result]));
  for (const { row, target } of entries) {
    const result = byKey.get(`${target.namespace}/${target.name}`);
    if (result?.ok) completed.push(row);
    else failures.push({ row, message: result?.error?.message || result?.error?.code || fallbackMessage });
  }
  return { completed, failures };
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
  const { api, activeCluster, resourceDefinitions, selectedResource, selectedRow, selectedNamespaces, setRows, setSelectedRow, setError, reloadResources, t } = options;
  const [bulkDelete, setBulkDelete] = useState<BulkDeleteTarget | null>(null);
  const [nodeActionConfirmation, setNodeActionConfirmation] = useState<NodeActionConfirmation | null>(null);
  const [nodeLabelTarget, setNodeLabelTarget] = useState<NodeLabelTarget | null>(null);
  const nodePreviewRequestRef = useRef(0);

  const clearPendingActions = useCallback(() => {
    setBulkDelete(null);
    setNodeActionConfirmation(null);
    setNodeLabelTarget(null);
  }, []);

  const requestBulkDelete = useCallback(
    (resource: string, rows: ResourceRow[]) => {
      if (!activeCluster) return;
      setBulkDelete({ clusterId: activeCluster.id, resource, rows });
    },
    [activeCluster],
  );

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
    if (!api || !bulkDelete) return;
    const target = bulkDelete;
    setBulkDelete(null);
    setError(null);

    const deletingKeys = new Set(target.rows.map(resourceIdentityLabel));
    setRows((current) => ({
      ...current,
      [target.resource]: (current[target.resource] ?? []).map((row) => (deletingKeys.has(resourceIdentityLabel(row)) ? markDeletingRow(target.resource, row) : row)),
    }));
    if (selectedResource === target.resource && selectedRow && deletingKeys.has(resourceIdentityLabel(selectedRow))) {
      setSelectedRow(markDeletingRow(target.resource, selectedRow));
    }

    const definition = findResourceDefinition(resourceDefinitions, target.resource);
    const entries = target.rows.map((row) => ({ row, target: { namespace: definition?.namespaced === false ? "_cluster" : String(row.namespace || "_cluster"), name: row.name } }));
    const { completed: deletedRows, failures } = await runBulkAction(
      () =>
        api.bulkResourceAction(
          target.clusterId,
          target.resource,
          "delete",
          entries.map((entry) => entry.target),
        ),
      entries,
      "Delete failed",
    );

    if (selectedResource === target.resource && selectedRow && deletingKeys.has(resourceIdentityLabel(selectedRow))) {
      setSelectedRow(selectedRowAfterBulkDelete(target.resource, selectedResource, selectedRow, deletedRows, failures));
    }
    let reloadError: ErrorInfo | null = null;
    await reloadResources(target.clusterId, target.resource, selectedNamespaces).catch((error) => {
      reloadError = asErrorInfo(error);
    });
    if (failures.length) {
      const resultMessage = `${t("bulkDelete.partialResult")}. ${t("bulkDelete.deleted")}: ${deletedRows.length}. ${t("bulkDelete.failed")}: ${failures.length}.`;
      const error = buildPartialActionError({
        label: t("bulkDelete.partialResult"),
        resource: target.resource,
        completedCount: deletedRows.length,
        failures,
        message: resultMessage,
      });
      setError(error);
      return;
    }
    setError(reloadError);
  }, [api, bulkDelete, t, setError, setRows, selectedResource, selectedRow, setSelectedRow, resourceDefinitions, reloadResources, selectedNamespaces]);

  const requestNodeAction = useCallback(
    async (action: NodeActionKind, rows: ResourceRow[]) => {
      if (!api || !activeCluster || rows.length === 0) return;
      const clusterId = activeCluster.id;
      const requestId = nodePreviewRequestRef.current + 1;
      nodePreviewRequestRef.current = requestId;
      const commandPreview = nodeActionCommandPreview(
        action,
        rows.map((row) => String(row.name)),
      );
      if (action !== "drain") {
        setNodeActionConfirmation({ clusterId, action, rows, commandPreview });
        return;
      }
      const nodeNames = new Set(rows.map((row) => String(row.name)));
      setNodeActionConfirmation({ clusterId, action, rows, commandPreview, affectedPods: [], previewLoading: true });
      try {
        const response = await api.resources(clusterId, "pods", "all", undefined, { useCache: false, forceRefresh: true });
        if (nodePreviewRequestRef.current !== requestId) return;
        const affectedPods = response.items
          .filter((pod) => nodeNames.has(String(pod.node ?? "")))
          .sort((left, right) => `${left.namespace ?? ""}/${left.name}`.localeCompare(`${right.namespace ?? ""}/${right.name}`, undefined, { numeric: true }));
        setNodeActionConfirmation({ clusterId, action, rows, commandPreview, affectedPods, previewLoading: false });
      } catch (error) {
        if (nodePreviewRequestRef.current !== requestId) return;
        const info = asErrorInfo(error);
        setNodeActionConfirmation({
          clusterId,
          action,
          rows,
          commandPreview,
          affectedPods: [],
          previewLoading: false,
          previewError: info.message || info.code || "Failed to load affected pods preview",
        });
      }
    },
    [api, activeCluster],
  );

  const confirmNodeAction = useCallback(async () => {
    if (!api || !nodeActionConfirmation) return;
    const target = nodeActionConfirmation;
    const label = nodeActionLabel(target.action);
    setNodeActionConfirmation(null);
    setError(null);
    const entries = target.rows.map((row) => ({ row, target: { namespace: "_cluster", name: row.name } }));
    const { completed, failures } = await runBulkAction(
      () =>
        api.bulkResourceAction(
          target.clusterId,
          "nodes",
          target.action,
          entries.map((entry) => entry.target),
        ),
      entries,
      `${label} failed`,
    );
    await reloadResources(target.clusterId, "nodes", ["_cluster"]).catch((error) => setError(asErrorInfo(error)));
    if (failures.length) {
      const error = buildPartialActionError({ label, resource: "nodes", completedCount: completed.length, failures, commandPreview: target.commandPreview });
      setError(error);
      return;
    }
    setError(null);
  }, [api, nodeActionConfirmation, reloadResources, setError]);

  const requestNodeLabels = useCallback(
    (rows: ResourceRow[]) => {
      if (!activeCluster || rows.length === 0) return;
      setNodeLabelTarget({ clusterId: activeCluster.id, rows });
    },
    [activeCluster],
  );

  const closeNodeLabels = useCallback(() => setNodeLabelTarget(null), []);

  // One request for all nodes, each carrying only what that node needs; a node
  // the changes leave as it is is not sent at all.
  const confirmNodeLabels = useCallback(
    async (changes: NodeLabelChanges) => {
      if (!api || !nodeLabelTarget) return;
      const target = nodeLabelTarget;
      setNodeLabelTarget(null);
      setError(null);
      const plan = planNodeLabelChanges(target.rows, changes).filter((entry) => entry.operations.length);
      const entries = plan.map((entry) => ({ row: entry.row, target: { namespace: "_cluster", name: entry.row.name, labels: entry.changes } }));
      const { completed, failures } = entries.length
        ? await runBulkAction(
            () =>
              api.bulkResourceAction(
                target.clusterId,
                "nodes",
                "label",
                entries.map((entry) => entry.target),
              ),
            entries,
            "Label failed",
          )
        : { completed: [], failures: [] };
      await reloadResources(target.clusterId, "nodes", ["_cluster"]).catch((error) => setError(asErrorInfo(error)));
      if (failures.length) {
        const commandPreview = nodeLabelCommandPreview(plan.filter((entry) => failures.some((failure) => failure.row === entry.row)));
        const message = t("nodeLabels.partialResult").replace("{completed}", String(completed.length)).replace("{failed}", String(failures.length));
        setError(buildPartialActionError({ label: "Labels", resource: "nodes", completedCount: completed.length, failures, commandPreview, message }));
        return;
      }
      setError(null);
    },
    [api, nodeLabelTarget, reloadResources, setError, t],
  );

  useEffect(() => {
    nodePreviewRequestRef.current += 1;
    setBulkDelete(null);
    setNodeActionConfirmation(null);
    setNodeLabelTarget(null);
  }, [activeCluster?.id]);

  return {
    bulkDelete,
    nodeActionConfirmation,
    clearPendingActions,
    requestBulkDelete,
    closeBulkDelete,
    copyBulkDeleteList,
    confirmBulkDelete,
    requestNodeAction,
    closeNodeAction,
    confirmNodeAction,
    nodeLabelTarget,
    requestNodeLabels,
    closeNodeLabels,
    confirmNodeLabels,
  };
}
