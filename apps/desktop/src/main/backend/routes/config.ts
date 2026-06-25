import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuditStore } from "../audit/auditStore";
import type { ConfigStore } from "../config/configStore";
import { writeError } from "../errors";
import { readJsonBody, RequestBodyError, writeJson } from "../http";

function settingsFromBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be an object");
  }

  const settings = (body as Record<string, unknown>).settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("settings must be an object");
  }

  return settings;
}

export function writeConfig(response: ServerResponse, configStore: ConfigStore): void {
  writeJson(response, configStore.load());
}

export async function writeSettings(
  request: IncomingMessage,
  response: ServerResponse,
  configStore: ConfigStore,
  auditStore: AuditStore,
): Promise<void> {
  try {
    const body = await readJsonBody(request);
    const updated = configStore.updateSettings(settingsFromBody(body));

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

    writeError(response, 400, "INVALID_SETTINGS", message);
  }
}
