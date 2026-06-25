import type { ServerResponse } from "node:http";
import type { AuditStore } from "../audit/auditStore";
import { writeError } from "../errors";
import { writeJson } from "../http";

export function writeAudit(
  requestUrl: string | undefined,
  response: ServerResponse,
  auditStore: AuditStore,
): void {
  const url = new URL(requestUrl ?? "/audit", "http://127.0.0.1");
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 200 : Number(rawLimit);

  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    writeError(response, 422, "INVALID_LIMIT", "limit must be an integer between 1 and 1000");
    return;
  }

  writeJson(response, {
    items: auditStore.read(limit),
    limit,
  });
}
