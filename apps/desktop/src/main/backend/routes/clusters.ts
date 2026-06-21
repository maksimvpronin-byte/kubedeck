import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuditStore } from "../audit/auditStore";
import { ClusterNotFoundError, ConfigStore } from "../config/configStore";
import { writeError } from "../errors";
import { readJsonBody, RequestBodyError, writeJson } from "../http";
import { clusterCommand, kubeconfigAvailable } from "../kubectl/clusterCommand";
import { KubectlError, writeKubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import { clearLegacyResourceCache } from "../legacyControl";
import type { GatewayOptions } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeBodyError(response: ServerResponse, error: unknown): boolean {
  if (!(error instanceof RequestBodyError)) return false;
  const statusCode = error.code === "REQUEST_TOO_LARGE" ? 413 : 400;
  writeError(response, statusCode, error.code, error.message);
  return true;
}

function decodeItems(value: Record<string, unknown>): unknown[] {
  return Array.isArray(value.items) ? value.items : [];
}

export function writeClusters(response: ServerResponse, configStore: ConfigStore): void {
  writeJson(response, { clusters: configStore.listClusters() });
}

export async function writeImportCluster(
  request: IncomingMessage,
  response: ServerResponse,
  configStore: ConfigStore,
  auditStore: AuditStore,
): Promise<void> {
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.sourcePath !== "string" || !body.sourcePath) {
      writeError(response, 422, "INVALID_REQUEST", "sourcePath is required");
      return;
    }

    if (
      body.displayName !== undefined &&
      body.displayName !== null &&
      typeof body.displayName !== "string"
    ) {
      writeError(response, 422, "INVALID_REQUEST", "displayName must be a string");
      return;
    }

    const cluster = configStore.importCluster(
      body.sourcePath,
      typeof body.displayName === "string" ? body.displayName : undefined,
    );

    auditStore.append({
      action: "cluster.import",
      status: "success",
      clusterId: cluster.id,
      name: cluster.displayName,
    });
    writeJson(response, cluster);
  } catch (error) {
    if (writeBodyError(response, error)) return;

    const message = errorMessage(error);
    auditStore.append({ action: "cluster.import", status: "failed", message });
    writeError(response, 400, "IMPORT_FAILED", message);
  }
}

export async function writeRenameCluster(
  request: IncomingMessage,
  response: ServerResponse,
  clusterId: string,
  configStore: ConfigStore,
  auditStore: AuditStore,
): Promise<void> {
  try {
    const body = await readJsonBody(request);
    if (!isRecord(body) || typeof body.displayName !== "string") {
      writeError(response, 422, "INVALID_REQUEST", "displayName is required");
      return;
    }

    const cluster = configStore.renameCluster(clusterId, body.displayName);
    auditStore.append({
      action: "cluster.rename",
      status: "success",
      clusterId,
      name: cluster.displayName,
    });
    writeJson(response, cluster);
  } catch (error) {
    if (writeBodyError(response, error)) return;

    const message = errorMessage(error);
    auditStore.append({ action: "cluster.rename", status: "failed", clusterId, message });

    if (error instanceof ClusterNotFoundError) {
      writeError(response, 404, "CLUSTER_NOT_FOUND", message);
      return;
    }

    writeError(response, 400, "CLUSTER_RENAME_FAILED", message);
  }
}

export async function writeRemoveCluster(
  response: ServerResponse,
  clusterId: string,
  configStore: ConfigStore,
  auditStore: AuditStore,
  options: GatewayOptions,
): Promise<void> {
  try {
    const result = configStore.removeCluster(clusterId);

    try {
      await clearLegacyResourceCache(options, clusterId);
    } catch (error) {
      options.log(`legacy resource cache clear failed cluster=${clusterId}: ${errorMessage(error)}`);
    }

    auditStore.append({
      action: "cluster.remove",
      status: "success",
      clusterId,
      name: result.cluster.displayName,
      extra: { removedManagedFile: result.removedManagedFile },
    });
    writeJson(response, { ok: true });
  } catch (error) {
    const message = errorMessage(error);
    auditStore.append({ action: "cluster.remove", status: "failed", clusterId, message });

    if (error instanceof ClusterNotFoundError) {
      writeError(response, 404, "CLUSTER_NOT_FOUND", message);
      return;
    }

    writeError(response, 500, "CLUSTER_REMOVE_FAILED", message);
  }
}

export async function writeOpenLastCluster(
  response: ServerResponse,
  configStore: ConfigStore,
  runner: KubectlRunner,
): Promise<void> {
  const cluster = configStore.lastOpenedCluster();
  if (!cluster) {
    writeJson(response, { cluster: null });
    return;
  }

  await writeOpenCluster(response, cluster.id, configStore, runner);
}

export async function writeOpenCluster(
  response: ServerResponse,
  clusterId: string,
  configStore: ConfigStore,
  runner: KubectlRunner,
): Promise<void> {
  let cluster;

  try {
    cluster = configStore.getCluster(clusterId);
  } catch (error) {
    if (error instanceof ClusterNotFoundError) {
      writeError(response, 404, "CLUSTER_NOT_FOUND", error.message);
      return;
    }
    throw error;
  }

  if (!kubeconfigAvailable(cluster.kubeconfigPath)) {
    writeError(response, 400, "CLUSTER_UNAVAILABLE", "kubeconfig file is missing");
    return;
  }

  try {
    await runner.run(clusterCommand(
      configStore,
      clusterId,
      ["cluster-info"],
      30,
      16 * 1024 * 1024,
    ));

    const namespaces = await runner.runJson(clusterCommand(
      configStore,
      clusterId,
      ["get", "namespaces", "-o", "json"],
      30,
      64 * 1024 * 1024,
    ));

    const opened = configStore.markOpened(clusterId);
    writeJson(response, {
      cluster: opened,
      namespaces: decodeItems(namespaces),
    });
  } catch (error) {
    if (error instanceof KubectlError) {
      writeKubectlError(response, error);
      return;
    }

    writeError(response, 500, "CLUSTER_OPEN_FAILED", "Unable to open cluster");
  }
}

export async function writeNamespaces(
  response: ServerResponse,
  clusterId: string,
  configStore: ConfigStore,
  runner: KubectlRunner,
): Promise<void> {
  try {
    const data = await runner.runJson(clusterCommand(
      configStore,
      clusterId,
      ["get", "namespaces", "-o", "json"],
      30,
      64 * 1024 * 1024,
    ));

    writeJson(response, { items: decodeItems(data) });
  } catch (error) {
    if (error instanceof ClusterNotFoundError) {
      writeError(response, 404, "CLUSTER_NOT_FOUND", error.message);
      return;
    }

    if (error instanceof KubectlError) {
      writeKubectlError(response, error);
      return;
    }

    writeError(response, 500, "NAMESPACES_FAILED", "Unable to load namespaces");
  }
}
