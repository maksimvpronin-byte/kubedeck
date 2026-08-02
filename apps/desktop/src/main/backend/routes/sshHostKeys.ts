import type { IncomingMessage, ServerResponse } from "node:http";

import type { AuditStore } from "../audit/auditStore";
import { writeError } from "../errors";
import { readJsonBody, RequestBodyError, writeJson } from "../http";
import type { SshHostKeyStore } from "../ssh/sshHostKeyStore";
import { RequestValidationError } from "../validation";

const REQUEST_MAX_BYTES = 16 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readForgetInput(body: unknown): { host: string; port: number } {
  if (!isRecord(body)) throw new RequestValidationError(422, "INVALID_REQUEST", "Request body must be an object");
  const host = String(body.host ?? "").trim();
  if (!host || host.length > 1024) throw new RequestValidationError(422, "INVALID_SSH_HOST", "host is required");
  const port = Number(body.port ?? 22);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new RequestValidationError(422, "INVALID_SSH_PORT", "port must be between 1 and 65535");
  return { host, port };
}

/**
 * Known SSH host keys are only ever listed or removed here. There is no route
 * that adds a host key: trust is granted exclusively through the explicit
 * confirmation shown while a session is connecting.
 */
export function handleSshHostKeyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  hostKeys: SshHostKeyStore,
  auditStore: AuditStore,
  log: (message: string) => void,
): boolean {
  if (pathname !== "/ssh/known-hosts") return false;

  if (request.method === "GET") {
    try {
      writeJson(response, { items: hostKeys.list() });
    } catch (error) {
      log(`gateway ssh known hosts read failed: ${String(error)}`);
      writeError(response, 500, "SSH_KNOWN_HOSTS_FAILED", "Unable to read known SSH host keys");
    }
    return true;
  }

  if (request.method === "DELETE") {
    void (async () => {
      try {
        const { host, port } = readForgetInput(await readJsonBody(request, REQUEST_MAX_BYTES));
        const removed = hostKeys.forget(host, port);
        if (removed) {
          auditStore.append({ action: "ssh.known-host.forget", status: "success", extra: { host, port } });
        }
        writeJson(response, { removed });
      } catch (error) {
        if (error instanceof RequestValidationError) {
          writeError(response, error.statusCode, error.code, error.message);
          return;
        }
        if (error instanceof RequestBodyError) {
          writeError(response, 400, error.code, error.message);
          return;
        }
        log(`gateway ssh known host forget failed: ${String(error)}`);
        writeError(response, 500, "SSH_KNOWN_HOSTS_FAILED", "Unable to remove the known SSH host key");
      }
    })();
    return true;
  }

  writeError(response, 405, "METHOD_NOT_ALLOWED", "Method is not supported for known SSH host keys");
  return true;
}
