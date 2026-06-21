import type { IncomingMessage, ServerResponse } from "node:http";
import { parseAllDocuments } from "yaml";
import type { AuditStore } from "../audit/auditStore";
import { ClusterNotFoundError, type ConfigStore } from "../config/configStore";
import { writeError } from "../errors";
import { readJsonBody, RequestBodyError } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError, writeKubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import { RequestValidationError, validateIdentifier } from "../validation";

export const MAX_APPLY_YAML_BYTES = 5 * 1024 * 1024;
const MAX_YAML_REQUEST_BYTES = 12 * 1024 * 1024;
const TEXT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const YAML_COMMAND_TIMEOUT_SECONDS = 45;

interface OperationConfirmation {
  clusterId?: unknown;
  action?: unknown;
  typedName?: unknown;
  namespace?: unknown;
  resource?: unknown;
  name?: unknown;
}

interface YamlRequestPayload {
  yaml: string;
  confirmation?: OperationConfirmation;
}

export interface YamlApplyTarget {
  kind: string;
  namespace: string;
  name: string;
  documentCount: number;
}

type CacheInvalidator = (clusterId: string) => Promise<void>;

type YamlOperation = "dry-run" | "apply";

interface YamlRouteTarget {
  clusterId: string;
  operation: YamlOperation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodePathPart(value: string, field: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new RequestValidationError(
      400,
      "INVALID_IDENTIFIER",
      `${field} is not valid URL encoding`,
    );
  }
}

export function matchYamlRoute(
  method: string | undefined,
  pathname: string,
): YamlRouteTarget | null {
  const match = pathname.match(/^\/clusters\/([^/]+)\/yaml\/(dry-run|apply)$/);
  if (!match) return null;

  const operation = match[2] as YamlOperation;
  if (
    (operation === "dry-run" && method !== "POST") ||
    (operation === "apply" && method !== "PUT")
  ) {
    return null;
  }

  return {
    clusterId: validateIdentifier(
      decodePathPart(match[1], "cluster_id"),
      "cluster_id",
      128,
    ),
    operation,
  };
}

function yamlParseErrorMessage(error: unknown): string {
  const candidate = error as { linePos?: Array<{ line?: number }> };
  const line = candidate.linePos?.[0]?.line;
  return typeof line === "number"
    ? `YAML cannot be parsed at line ${line}`
    : "YAML cannot be parsed";
}

export function parseYamlApplyTarget(payload: string): YamlApplyTarget {
  let parsedDocuments;

  try {
    parsedDocuments = parseAllDocuments(payload, { uniqueKeys: true });
  } catch (error) {
    throw new RequestValidationError(400, "INVALID_YAML", yamlParseErrorMessage(error));
  }

  for (const document of parsedDocuments) {
    if (document.errors.length > 0) {
      throw new RequestValidationError(
        400,
        "INVALID_YAML",
        yamlParseErrorMessage(document.errors[0]),
      );
    }
  }

  const documents = parsedDocuments.filter((document) => document.contents !== null);

  if (documents.length === 0) {
    throw new RequestValidationError(
      400,
      "EMPTY_YAML",
      "YAML payload must contain one Kubernetes object",
    );
  }
  if (documents.length !== 1) {
    throw new RequestValidationError(
      400,
      "MULTI_DOCUMENT_APPLY_BLOCKED",
      "KubeDeck allows YAML apply for one object at a time",
    );
  }

  let value: unknown;
  try {
    value = documents[0].toJS({ maxAliasCount: 100 });
  } catch (error) {
    throw new RequestValidationError(400, "INVALID_YAML", yamlParseErrorMessage(error));
  }

  if (!isRecord(value)) {
    throw new RequestValidationError(
      400,
      "INVALID_YAML_OBJECT",
      "YAML document must be a Kubernetes object",
    );
  }

  const metadataValue = value.metadata ?? {};
  if (!isRecord(metadataValue)) {
    throw new RequestValidationError(
      400,
      "INVALID_YAML_METADATA",
      "YAML metadata must be an object",
    );
  }

  const kind = typeof value.kind === "string" ? value.kind.trim() : "";
  if (!kind) {
    throw new RequestValidationError(400, "INVALID_YAML_KIND", "YAML kind is required");
  }

  const rawName = typeof metadataValue.name === "string"
    ? metadataValue.name
    : "";
  const name = validateIdentifier(rawName, "metadata.name");

  let namespace = "_cluster";
  if (metadataValue.namespace !== undefined && metadataValue.namespace !== null) {
    if (typeof metadataValue.namespace !== "string") {
      throw new RequestValidationError(
        400,
        "INVALID_YAML_METADATA",
        "YAML metadata.namespace must be a string",
      );
    }

    const valueNamespace = metadataValue.namespace.trim();
    namespace = valueNamespace || "_cluster";
  }

  if (namespace !== "_cluster") {
    namespace = validateIdentifier(namespace, "metadata.namespace");
  }

  return {
    kind,
    namespace,
    name,
    documentCount: documents.length,
  };
}

export function ensureYamlSize(payload: string): number {
  const payloadBytes = Buffer.byteLength(payload, "utf8");
  if (payloadBytes > MAX_APPLY_YAML_BYTES) {
    throw new RequestValidationError(
      413,
      "PAYLOAD_TOO_LARGE",
      `YAML payload is too large (${payloadBytes} bytes, limit ${MAX_APPLY_YAML_BYTES} bytes)`,
    );
  }
  return payloadBytes;
}

function confirmationString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function requireYamlApplyConfirmation(
  confirmation: OperationConfirmation | undefined,
  clusterId: string,
  target: YamlApplyTarget,
): void {
  if (!confirmation || !isRecord(confirmation)) {
    throw new RequestValidationError(
      400,
      "CONFIRMATION_REQUIRED",
      "Confirmation is required for apply",
    );
  }

  if (confirmationString(confirmation.clusterId) !== clusterId) {
    throw new RequestValidationError(
      400,
      "CONFIRMATION_CLUSTER_MISMATCH",
      "Confirmation cluster does not match request",
    );
  }
  if (confirmationString(confirmation.action) !== "apply") {
    throw new RequestValidationError(
      400,
      "CONFIRMATION_ACTION_MISMATCH",
      "Confirmation action does not match request",
    );
  }

  const resource = confirmationString(confirmation.resource) || "yaml";
  if (resource !== "yaml") {
    throw new RequestValidationError(
      400,
      "CONFIRMATION_RESOURCE_MISMATCH",
      "Confirmation resource does not match request",
    );
  }

  const namespace = confirmationString(confirmation.namespace) || target.namespace;
  if (namespace !== target.namespace) {
    throw new RequestValidationError(
      400,
      "CONFIRMATION_NAMESPACE_MISMATCH",
      "Confirmation namespace does not match request",
    );
  }

  const name = confirmationString(confirmation.name) || target.name;
  if (name !== target.name) {
    throw new RequestValidationError(
      400,
      "CONFIRMATION_NAME_MISMATCH",
      "Confirmation name does not match request",
    );
  }

  if (confirmationString(confirmation.typedName) !== target.name) {
    throw new RequestValidationError(
      400,
      "CONFIRMATION_TYPED_NAME_MISMATCH",
      "Typed confirmation value is invalid",
    );
  }
}

async function readYamlPayload(request: IncomingMessage): Promise<YamlRequestPayload> {
  const body = await readJsonBody(request, MAX_YAML_REQUEST_BYTES);
  if (!isRecord(body) || typeof body.yaml !== "string") {
    throw new RequestValidationError(
      400,
      "INVALID_REQUEST",
      "Request body must contain a YAML string",
    );
  }

  return {
    yaml: body.yaml,
    ...(isRecord(body.confirmation)
      ? { confirmation: body.confirmation as OperationConfirmation }
      : {}),
  };
}

function yamlCommand(
  configStore: ConfigStore,
  clusterId: string,
  args: string[],
  yaml: string,
) {
  const command = clusterCommand(
    configStore,
    clusterId,
    args,
    YAML_COMMAND_TIMEOUT_SECONDS,
    TEXT_MAX_OUTPUT_BYTES,
  );
  command.stdinText = yaml;
  return command;
}

function writePlainText(response: ServerResponse, body: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

async function executeDryRun(
  request: IncomingMessage,
  response: ServerResponse,
  clusterId: string,
  configStore: ConfigStore,
  auditStore: AuditStore,
  runner: KubectlRunner,
): Promise<void> {
  const payload = await readYamlPayload(request);
  const payloadBytes = ensureYamlSize(payload.yaml);
  const command = yamlCommand(
    configStore,
    clusterId,
    ["apply", "--dry-run=server", "-f", "-", "-o", "yaml"],
    payload.yaml,
  );

  try {
    const result = await runner.run(command);
    auditStore.append({
      action: "yaml.dry-run",
      status: "success",
      clusterId,
      resource: "yaml",
      commandPreview: result.commandPreview,
      extra: { payloadBytes },
    });
    writePlainText(response, result.stdout || "Server dry-run completed successfully.");
  } catch (error) {
    if (error instanceof KubectlError) {
      auditStore.append({
        action: "yaml.dry-run",
        status: "failed",
        clusterId,
        resource: "yaml",
        commandPreview: error.info.commandPreview,
        message: error.info.message,
      });
    }
    throw error;
  }
}

async function executeApply(
  request: IncomingMessage,
  response: ServerResponse,
  clusterId: string,
  configStore: ConfigStore,
  auditStore: AuditStore,
  runner: KubectlRunner,
  log: (message: string) => void,
  invalidateResourceCache: CacheInvalidator,
): Promise<void> {
  const payload = await readYamlPayload(request);
  const payloadBytes = ensureYamlSize(payload.yaml);
  const target = parseYamlApplyTarget(payload.yaml);
  requireYamlApplyConfirmation(payload.confirmation, clusterId, target);

  const command = yamlCommand(
    configStore,
    clusterId,
    ["apply", "-f", "-"],
    payload.yaml,
  );

  try {
    const result = await runner.run(command);
    auditStore.append({
      action: "yaml.apply",
      status: "success",
      clusterId,
      namespace: target.namespace,
      resource: "yaml",
      name: target.name,
      commandPreview: result.commandPreview,
      extra: {
        payloadBytes,
        kind: target.kind,
        documents: target.documentCount,
      },
    });

    try {
      await invalidateResourceCache(clusterId);
    } catch (error) {
      log(`gateway YAML cache invalidation failed cluster=${clusterId}: ${String(error)}`);
    }

    writePlainText(response, result.stdout);
  } catch (error) {
    if (error instanceof KubectlError) {
      auditStore.append({
        action: "yaml.apply",
        status: "failed",
        clusterId,
        namespace: target.namespace,
        resource: "yaml",
        name: target.name,
        commandPreview: error.info.commandPreview,
        message: error.info.message,
        extra: {
          kind: target.kind,
          documents: target.documentCount,
        },
      });
    }
    throw error;
  }
}

function writeRouteError(
  response: ServerResponse,
  error: unknown,
  log: (message: string) => void,
): void {
  if (error instanceof RequestBodyError) {
    const statusCode = error.code === "REQUEST_TOO_LARGE" ? 413 : 400;
    writeError(response, statusCode, error.code, error.message);
    return;
  }
  if (error instanceof RequestValidationError) {
    writeError(response, error.statusCode, error.code, error.message);
    return;
  }
  if (error instanceof ClusterNotFoundError) {
    writeError(response, 404, "CLUSTER_NOT_FOUND", error.message);
    return;
  }
  if (error instanceof KubectlError) {
    writeKubectlError(response, error);
    return;
  }

  log(`gateway YAML operation failed: ${error instanceof Error ? error.message : String(error)}`);
  writeError(response, 500, "YAML_OPERATION_FAILED", "Unable to process YAML operation");
}

export function handleYamlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  auditStore: AuditStore,
  runner: KubectlRunner,
  log: (message: string) => void,
  invalidateResourceCache: CacheInvalidator = async () => {},
): boolean {
  let target: YamlRouteTarget | null;
  try {
    target = matchYamlRoute(request.method, pathname);
  } catch (error) {
    writeRouteError(response, error, log);
    return true;
  }

  if (!target) return false;

  const operation = target.operation === "dry-run"
    ? executeDryRun(
      request,
      response,
      target.clusterId,
      configStore,
      auditStore,
      runner,
    )
    : executeApply(
      request,
      response,
      target.clusterId,
      configStore,
      auditStore,
      runner,
      log,
      invalidateResourceCache,
    );

  void operation.catch((error) => writeRouteError(response, error, log));
  return true;
}

export async function invalidateLegacyResourceCache(
  legacyBackendUrl: string,
  sessionToken: string,
  clusterId: string,
): Promise<void> {
  const url = new URL("/resource-cache/clear", legacyBackendUrl);
  url.searchParams.set("cluster_id", clusterId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "X-KubeDeck-Token": sessionToken },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`legacy cache clear returned HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
