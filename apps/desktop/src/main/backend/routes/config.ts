import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiKeyUpdate } from "@kubedeck/shared-types";
import type { AuditStore } from "../audit/auditStore";
import type { ConfigStore } from "../config/configStore";
import type { SecretStore } from "../security/secretStore";
import { writeError } from "../errors";
import { readJsonBody, RequestBodyError, writeJson } from "../http";

const SECRET_NAME = "llm-api-key" as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function settingsFromBody(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new Error("Request body must be an object");
  }

  const settings = body.settings;
  if (!isRecord(settings)) {
    throw new Error("settings must be an object");
  }

  return settings;
}

function apiKeyUpdateFromBody(body: unknown): ApiKeyUpdate {
  if (!isRecord(body) || body.apiKeyUpdate === undefined) {
    return { action: "keep" };
  }

  const update = body.apiKeyUpdate;
  if (!isRecord(update) || typeof update.action !== "string") {
    throw new Error("apiKeyUpdate must be an object with an action");
  }

  if (update.action === "keep") return { action: "keep" };
  if (update.action === "clear") return { action: "clear" };
  if (update.action === "replace") {
    if (typeof update.value !== "string" || !update.value.trim()) {
      throw new Error("apiKeyUpdate.value must be a non-empty string");
    }
    return { action: "replace", value: update.value };
  }

  throw new Error("apiKeyUpdate.action must be keep, replace or clear");
}

class SecretStorageUnavailableError extends Error {
  constructor() {
    super("System secret storage is unavailable");
  }
}

function applyApiKeyUpdate(secretStore: SecretStore, update: ApiKeyUpdate): void {
  if (update.action === "keep") return;
  try {
    if (update.action === "replace") {
      secretStore.write(SECRET_NAME, update.value);
    } else {
      secretStore.delete(SECRET_NAME);
    }
  } catch {
    throw new SecretStorageUnavailableError();
  }
}

export function writeConfig(response: ServerResponse, configStore: ConfigStore): void {
  writeJson(response, configStore.load());
}

export async function writeSettings(
  request: IncomingMessage,
  response: ServerResponse,
  configStore: ConfigStore,
  auditStore: AuditStore,
  secretStore: SecretStore,
): Promise<void> {
  try {
    const body = await readJsonBody(request);
    const settings = settingsFromBody(body);
    const apiKeyUpdate = apiKeyUpdateFromBody(body);

    applyApiKeyUpdate(secretStore, apiKeyUpdate);

    if (isRecord(settings.llm)) {
      settings.llm.apiKeyConfigured = secretStore.has(SECRET_NAME);
    }

    const updated = configStore.updateSettings(settings);

    auditStore.append({
      action: "settings.update",
      status: "success",
      message: "Application settings updated",
    });

    writeJson(response, updated);
  } catch (error) {
    const message =
      error instanceof RequestBodyError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    auditStore.append({
      action: "settings.update",
      status: "failed",
      message,
    });

    const code = error instanceof SecretStorageUnavailableError
      ? "SECRET_STORAGE_UNAVAILABLE"
      : "INVALID_SETTINGS";
    writeError(response, 400, code, message);
  }
}
