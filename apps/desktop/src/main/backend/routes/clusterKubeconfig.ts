import type { IncomingMessage, ServerResponse } from "node:http";
import { parseAllDocuments } from "yaml";

import type { AuditStore } from "../audit/auditStore";
import { ClusterNotFoundError, type ConfigStore, KubeconfigEditError, MAX_KUBECONFIG_BYTES } from "../config/configStore";
import { writeError } from "../errors";
import { readJsonBody, RequestBodyError, writeJson } from "../http";
import { confirmationString, decodePathPart, RequestValidationError, validateIdentifier } from "../validation";

const MAX_KUBECONFIG_REQUEST_BYTES = 2 * 1024 * 1024;

export interface ClusterKubeconfigTarget {
  clusterId: string;
  operation: "read" | "write";
}

export function matchClusterKubeconfigRoute(method: string | undefined, pathname: string): ClusterKubeconfigTarget | null {
  const match = pathname.match(/^\/clusters\/([^/]+)\/kubeconfig$/);
  if (!match) return null;
  if (method !== "GET" && method !== "PUT") return null;

  return {
    clusterId: validateIdentifier(decodePathPart(match[1], "cluster_id"), "cluster_id", 128),
    operation: method === "GET" ? "read" : "write",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseErrorMessage(error: unknown): string {
  const candidate = error as { linePos?: Array<{ line?: number }> };
  const line = candidate?.linePos?.[0]?.line;
  return typeof line === "number" ? `Kubeconfig cannot be parsed at line ${line}` : "Kubeconfig cannot be parsed";
}

// A kubeconfig that parses but has no clusters or contexts would leave KubeDeck
// with a cluster it can never open again, so the shape is checked before the
// previous content is replaced.
export function validateKubeconfigDocument(content: string): { contexts: number; clusters: number } {
  if (!content.trim()) {
    throw new KubeconfigEditError("INVALID_KUBECONFIG", "Kubeconfig must not be empty");
  }

  let documents: ReturnType<typeof parseAllDocuments>;
  try {
    documents = parseAllDocuments(content, { uniqueKeys: true });
  } catch (error) {
    throw new KubeconfigEditError("INVALID_KUBECONFIG", parseErrorMessage(error));
  }

  for (const document of documents) {
    if (document.errors.length > 0) {
      throw new KubeconfigEditError("INVALID_KUBECONFIG", parseErrorMessage(document.errors[0]));
    }
  }

  const parsed = documents.filter((document) => document.contents !== null);
  if (parsed.length !== 1) {
    throw new KubeconfigEditError("INVALID_KUBECONFIG", "Kubeconfig must contain exactly one YAML document");
  }

  let value: unknown;
  try {
    value = parsed[0].toJS({ maxAliasCount: 100 });
  } catch (error) {
    throw new KubeconfigEditError("INVALID_KUBECONFIG", parseErrorMessage(error));
  }

  if (!isRecord(value)) {
    throw new KubeconfigEditError("INVALID_KUBECONFIG", "Kubeconfig must be a YAML object");
  }

  const kind = typeof value.kind === "string" ? value.kind.trim() : "";
  if (kind && kind !== "Config") {
    throw new KubeconfigEditError("INVALID_KUBECONFIG", "Kubeconfig kind must be Config");
  }

  if (!Array.isArray(value.clusters) || value.clusters.length === 0) {
    throw new KubeconfigEditError("INVALID_KUBECONFIG", "Kubeconfig must define at least one cluster");
  }
  if (!Array.isArray(value.contexts) || value.contexts.length === 0) {
    throw new KubeconfigEditError("INVALID_KUBECONFIG", "Kubeconfig must define at least one context");
  }
  if (value.users !== undefined && !Array.isArray(value.users)) {
    throw new KubeconfigEditError("INVALID_KUBECONFIG", "Kubeconfig users must be a list");
  }

  return { contexts: value.contexts.length, clusters: value.clusters.length };
}

function writeKubeconfigError(response: ServerResponse, error: unknown, log: (message: string) => void, action: string, auditStore: AuditStore, clusterId: string): void {
  const message = error instanceof Error ? error.message : String(error);
  auditStore.append({ action, status: "failed", clusterId, message });

  if (error instanceof ClusterNotFoundError) {
    writeError(response, 404, "CLUSTER_NOT_FOUND", message);
    return;
  }
  if (error instanceof KubeconfigEditError) {
    writeError(response, error.code === "KUBECONFIG_TOO_LARGE" ? 413 : error.code === "KUBECONFIG_UNREADABLE" ? 404 : 400, error.code, message);
    return;
  }
  if (error instanceof RequestValidationError) {
    writeError(response, error.statusCode, error.code, error.message);
    return;
  }
  if (error instanceof RequestBodyError) {
    writeError(response, error.code === "REQUEST_TOO_LARGE" ? 413 : 400, error.code, error.message);
    return;
  }

  log(`gateway kubeconfig route failed: ${message}`);
  writeError(response, 500, "KUBECONFIG_FAILED", "Unable to read or write the cluster kubeconfig");
}

async function readKubeconfig(response: ServerResponse, clusterId: string, configStore: ConfigStore, auditStore: AuditStore): Promise<void> {
  const cluster = configStore.getCluster(clusterId);
  const kubeconfig = configStore.readKubeconfig(clusterId);

  // Only metadata is audited: the file itself holds cluster credentials.
  auditStore.append({
    action: "cluster.kubeconfig.read",
    status: "success",
    clusterId,
    name: cluster.displayName,
    extra: { sizeBytes: kubeconfig.sizeBytes, editable: kubeconfig.editable },
  });

  writeJson(response, {
    clusterId,
    displayName: cluster.displayName,
    path: kubeconfig.path,
    editable: kubeconfig.editable,
    maxBytes: MAX_KUBECONFIG_BYTES,
    content: kubeconfig.content,
  });
}

async function saveKubeconfig(
  request: IncomingMessage,
  response: ServerResponse,
  clusterId: string,
  configStore: ConfigStore,
  auditStore: AuditStore,
  onKubeconfigChanged: (clusterId: string) => Promise<void>,
): Promise<void> {
  const cluster = configStore.getCluster(clusterId);
  const body = await readJsonBody(request, MAX_KUBECONFIG_REQUEST_BYTES);
  if (!isRecord(body) || typeof body.content !== "string") {
    throw new RequestValidationError(422, "INVALID_BODY", "content must be a string");
  }

  const confirmation = isRecord(body.confirmation) ? body.confirmation : {};
  if (confirmationString(confirmation.typedName).trim() !== cluster.displayName) {
    throw new RequestValidationError(422, "CONFIRMATION_REQUIRED", "Type the cluster name to confirm the kubeconfig change");
  }

  const shape = validateKubeconfigDocument(body.content);
  const written = configStore.writeKubeconfig(clusterId, body.content);
  // The API server or context may have changed, so cached data and live
  // sessions of this cluster cannot be trusted any more.
  await onKubeconfigChanged(clusterId);

  auditStore.append({
    action: "cluster.kubeconfig.update",
    status: "success",
    clusterId,
    name: cluster.displayName,
    extra: { sizeBytes: written.sizeBytes, clusters: shape.clusters, contexts: shape.contexts },
  });

  writeJson(response, { ok: true, cluster: written.cluster, path: written.path });
}

export function handleClusterKubeconfigRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  auditStore: AuditStore,
  onKubeconfigChanged: (clusterId: string) => Promise<void>,
  log: (message: string) => void,
): boolean {
  let target: ClusterKubeconfigTarget | null = null;
  try {
    target = matchClusterKubeconfigRoute(request.method, pathname);
  } catch (error) {
    if (!pathname.endsWith("/kubeconfig")) return false;
    writeKubeconfigError(response, error, log, "cluster.kubeconfig.read", auditStore, "");
    return true;
  }
  if (!target) return false;

  const clusterId = target.clusterId;
  const action = target.operation === "read" ? "cluster.kubeconfig.read" : "cluster.kubeconfig.update";
  const run = target.operation === "read" ? readKubeconfig(response, clusterId, configStore, auditStore) : saveKubeconfig(request, response, clusterId, configStore, auditStore, onKubeconfigChanged);

  void run.catch((error) => writeKubeconfigError(response, error, log, action, auditStore, clusterId));
  return true;
}
