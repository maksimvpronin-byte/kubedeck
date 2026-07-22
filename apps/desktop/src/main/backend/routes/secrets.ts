import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuditStore } from "../audit/auditStore";
import { ClusterNotFoundError, type ConfigStore } from "../config/configStore";
import { writeError } from "../errors";
import { readJsonBody, RequestBodyError, writeJson } from "../http";
import { clusterCommand } from "../kubectl/clusterCommand";
import { KubectlError, writeKubectlError } from "../kubectl/errors";
import type { KubectlRunner } from "../kubectl/runner";
import { RequestValidationError, validateIdentifier } from "../validation";

const SECRET_JSON_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const SECRET_VALUE_MAX_BYTES = 2 * 1024 * 1024;
const SECRET_REQUEST_MAX_BYTES = 64 * 1024;

export type SecretOperation = "keys" | "reveal" | "copy" | "update";

export interface SecretRouteTarget {
  clusterId: string;
  namespace: string;
  name: string;
  operation: SecretOperation;
}

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
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

export function matchSecretRoute(
  method: string | undefined,
  pathname: string,
): SecretRouteTarget | null {
  const match = pathname.match(
    /^\/clusters\/([^/]+)\/secrets\/([^/]+)\/([^/]+)\/(keys|reveal|copy|update)$/,
  );
  if (!match) return null;

  const operation = match[4] as SecretOperation;
  if (
    (operation === "keys" && method !== "GET") ||
    (operation !== "keys" && method !== "POST")
  ) {
    return null;
  }

  return {
    clusterId: validateIdentifier(
      decodePathPart(match[1], "cluster_id"),
      "cluster_id",
      128,
    ),
    namespace: validateIdentifier(
      decodePathPart(match[2], "namespace"),
      "namespace",
    ),
    name: validateIdentifier(decodePathPart(match[3], "name"), "name"),
    operation,
  };
}

function revealTimeoutSeconds(configStore: ConfigStore): number {
  const configured = configStore.load().settings.secretRevealTimeoutSeconds;
  return Math.max(1, Math.min(300, Math.trunc(configured)));
}

export function secretDataMap(secret: JsonObject): Record<string, string> {
  const data = secret.data;
  if (!isRecord(data)) return {};

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    result[String(key)] = String(value ?? "");
  }
  return result;
}

export function decodeBase64Strict(encoded: string): Buffer {
  if (encoded === "") return Buffer.alloc(0);

  const valid = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
    encoded,
  );
  if (!valid) {
    throw new Error("invalid base64");
  }

  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64") !== encoded) {
    throw new Error("invalid base64");
  }
  return decoded;
}

export function isBinaryPayload(value: Buffer): boolean {
  if (value.length === 0) return false;
  if (value.includes(0)) return true;

  let textBytes = 0;
  for (const byte of value) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      textBytes += 1;
    }
  }

  return textBytes / value.length < 0.85;
}

export async function loadSecretRaw(
  target: SecretRouteTarget,
  configStore: ConfigStore,
  runner: KubectlRunner,
): Promise<JsonObject> {
  return runner.runJson(clusterCommand(
    configStore,
    target.clusterId,
    ["get", "secret", target.name, "-n", target.namespace, "-o", "json"],
    30,
    SECRET_JSON_MAX_OUTPUT_BYTES,
  ));
}

export function secretKeysPayload(
  secret: JsonObject,
  target: SecretRouteTarget,
  timeoutSeconds: number,
): JsonObject {
  const data = secretDataMap(secret);
  const keys = Object.keys(data).sort((left, right) => left.localeCompare(right)).map((key) => {
    const encoded = data[key] ?? "";
    let decodedBytes = 0;
    let validBase64 = true;
    let binary = false;

    try {
      const decoded = decodeBase64Strict(encoded);
      decodedBytes = decoded.length;
      binary = isBinaryPayload(decoded);
    } catch {
      validBase64 = false;
    }

    return {
      key,
      encodedBytes: Buffer.byteLength(encoded, "utf8"),
      decodedBytes,
      validBase64,
      binary,
    };
  });

  const metadata = isRecord(secret.metadata) ? secret.metadata : {};
  return {
    type: typeof secret.type === "string" && secret.type ? secret.type : "Opaque",
    immutable: Boolean(secret.immutable ?? false),
    namespace: typeof metadata.namespace === "string"
      ? metadata.namespace
      : target.namespace,
    name: typeof metadata.name === "string" ? metadata.name : target.name,
    keys,
    revealTimeoutSeconds: timeoutSeconds,
  };
}

async function readSecretKey(request: IncomingMessage): Promise<string> {
  const body = await readJsonBody(request, SECRET_REQUEST_MAX_BYTES);
  if (!isRecord(body) || typeof body.key !== "string") {
    throw new RequestValidationError(
      422,
      "INVALID_REQUEST",
      "Request body must contain a secret key",
    );
  }
  return validateIdentifier(body.key, "secret key", 512);
}

async function writeSecretKeys(
  response: ServerResponse,
  target: SecretRouteTarget,
  configStore: ConfigStore,
  runner: KubectlRunner,
): Promise<void> {
  const secret = await loadSecretRaw(target, configStore, runner);
  writeJson(
    response,
    secretKeysPayload(secret, target, revealTimeoutSeconds(configStore)),
  );
}

async function writeSecretReveal(
  request: IncomingMessage,
  response: ServerResponse,
  target: SecretRouteTarget,
  configStore: ConfigStore,
  auditStore: AuditStore,
  runner: KubectlRunner,
): Promise<void> {
  const key = await readSecretKey(request);
  const secret = await loadSecretRaw(target, configStore, runner);
  const data = secretDataMap(secret);

  if (!Object.prototype.hasOwnProperty.call(data, key)) {
    throw new RequestValidationError(
      404,
      "SECRET_KEY_NOT_FOUND",
      `Secret key was not found: ${key}`,
    );
  }

  let decoded: Buffer;
  try {
    decoded = decodeBase64Strict(data[key] ?? "");
  } catch {
    auditStore.append({
      action: "secret.reveal",
      status: "failed",
      clusterId: target.clusterId,
      namespace: target.namespace,
      resource: "secrets",
      name: target.name,
      message: "invalid base64 data",
      extra: { key },
    });
    throw new RequestValidationError(
      400,
      "SECRET_VALUE_INVALID_BASE64",
      `Secret key is not valid base64 data: ${key}`,
    );
  }

  if (decoded.length > SECRET_VALUE_MAX_BYTES) {
    auditStore.append({
      action: "secret.reveal",
      status: "failed",
      clusterId: target.clusterId,
      namespace: target.namespace,
      resource: "secrets",
      name: target.name,
      message: "secret value too large to reveal",
      extra: { key, decodedBytes: decoded.length },
    });
    throw new RequestValidationError(
      413,
      "SECRET_VALUE_TOO_LARGE",
      `Secret value is too large to reveal safely (${decoded.length} bytes)`,
    );
  }

  const binary = isBinaryPayload(decoded);
  auditStore.append({
    action: "secret.reveal",
    status: "success",
    clusterId: target.clusterId,
    namespace: target.namespace,
    resource: "secrets",
    name: target.name,
    extra: { key, decodedBytes: decoded.length, binary },
  });

  writeJson(response, {
    key,
    value: decoded.toString("utf8"),
    decodedBytes: decoded.length,
    binary,
    revealTimeoutSeconds: revealTimeoutSeconds(configStore),
  });
}

async function writeSecretCopy(
  request: IncomingMessage,
  response: ServerResponse,
  target: SecretRouteTarget,
  auditStore: AuditStore,
): Promise<void> {
  const key = await readSecretKey(request);
  auditStore.append({
    action: "secret.copy",
    status: "success",
    clusterId: target.clusterId,
    namespace: target.namespace,
    resource: "secrets",
    name: target.name,
    extra: { key },
  });
  writeJson(response, { ok: true });
}

async function writeSecretUpdate(request: IncomingMessage, response: ServerResponse, target: SecretRouteTarget, configStore: ConfigStore, auditStore: AuditStore, runner: KubectlRunner) {
  const body = await readJsonBody(request, SECRET_VALUE_MAX_BYTES + SECRET_REQUEST_MAX_BYTES);
  if (!isRecord(body) || typeof body.key !== "string" || typeof body.value !== "string") throw new RequestValidationError(422, "INVALID_REQUEST", "Request body must contain key and value");
  const key = validateIdentifier(body.key, "secret key", 512);
  const bytes = Buffer.byteLength(body.value, "utf8");
  if (bytes > SECRET_VALUE_MAX_BYTES) throw new RequestValidationError(413, "SECRET_VALUE_TOO_LARGE", "Secret value is too large");
  const secret = await loadSecretRaw(target, configStore, runner);
  if (secret.immutable === true) throw new RequestValidationError(409, "SECRET_IMMUTABLE", "Immutable Secret cannot be updated");
  const data = secretDataMap(secret);
  if (!Object.hasOwn(data, key)) throw new RequestValidationError(404, "SECRET_KEY_NOT_FOUND", "Secret key was not found");
  const metadata = isRecord(secret.metadata) ? secret.metadata : {};
  const resourceVersion = String(metadata.resourceVersion || "");
  const escape = (value: string) => value.replace(/~/g, "~0").replace(/\//g, "~1");
  const patch = JSON.stringify([{ op: "test", path: "/metadata/resourceVersion", value: resourceVersion }, { op: "replace", path: `/data/${escape(key)}`, value: Buffer.from(body.value, "utf8").toString("base64") }]);
  const command = clusterCommand(configStore, target.clusterId, ["patch", "secret", target.name, "-n", target.namespace, "--type=json", "--patch-file=-"], 30, SECRET_JSON_MAX_OUTPUT_BYTES);
  command.stdinText = patch;
  await runner.run(command);
  auditStore.append({ action: "secret.update", status: "success", clusterId: target.clusterId, namespace: target.namespace, resource: "secrets", name: target.name, extra: { key, decodedBytes: bytes } });
  writeJson(response, { ok: true });
}

function writeRouteError(
  response: ServerResponse,
  error: unknown,
  log: (message: string) => void,
): void {
  if (error instanceof RequestBodyError) {
    writeError(
      response,
      error.code === "REQUEST_TOO_LARGE" ? 413 : 400,
      error.code,
      error.message,
    );
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

  log("gateway secret operation failed");
  writeError(response, 500, "SECRET_OPERATION_FAILED", "Unable to process Secret operation");
}

export function handleSecretRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  auditStore: AuditStore,
  runner: KubectlRunner,
  log: (message: string) => void,
): boolean {
  let target: SecretRouteTarget | null;
  try {
    target = matchSecretRoute(request.method, pathname);
  } catch (error) {
    writeRouteError(response, error, log);
    return true;
  }

  if (!target) return false;

  const operation = target.operation === "keys"
    ? writeSecretKeys(response, target, configStore, runner)
    : target.operation === "reveal"
      ? writeSecretReveal(
        request,
        response,
        target,
        configStore,
        auditStore,
        runner,
      )
      : target.operation === "copy"
        ? writeSecretCopy(request, response, target, auditStore)
        : writeSecretUpdate(request, response, target, configStore, auditStore, runner);

  void operation.catch((error) => writeRouteError(response, error, log));
  return true;
}
