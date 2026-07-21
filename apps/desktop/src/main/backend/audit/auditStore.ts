import fs from "node:fs";
import path from "node:path";
import { ensureAppPaths } from "../config/paths";

const SENSITIVE_MARKERS = [
  "token",
  "password",
  "passwd",
  "secret",
  "client-key-data",
  "client-certificate-data",
  "certificate-authority-data",
  "authorization",
  "bearer",
  "api-key",
  "apikey",
  "private-key",
];

const MAX_AUDIT_LINE_BYTES = 32 * 1024;
const DEFAULT_AUDIT_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_AUDIT_LIMIT = 200;
const MAX_AUDIT_LIMIT = 1000;

export interface AuditEventInput {
  action: string;
  status: string;
  clusterId?: string;
  namespace?: string;
  resource?: string;
  name?: string;
  commandPreview?: string;
  message?: string;
  extra?: Record<string, unknown>;
}

function sanitizeLogText(value: unknown): string {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const lowered = line.toLowerCase();
      return SENSITIVE_MARKERS.some((marker) => lowered.includes(marker))
        ? "[redacted sensitive line]"
        : line;
    })
    .join("\n");
}

function sanitizeExtra(extra: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(extra)) {
    const cleanKey = sanitizeLogText(key).slice(0, 128);

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      clean[cleanKey] =
        typeof value === "string" ? sanitizeLogText(value).slice(0, 1000) : value;
      continue;
    }

    if (Array.isArray(value)) {
      clean[cleanKey] = value
        .slice(0, 20)
        .map((item) => sanitizeLogText(item).slice(0, 300));
      continue;
    }

    clean[cleanKey] = sanitizeLogText(value).slice(0, 1000);
  }

  return clean;
}

export class AuditStore {
  readonly filePath: string;
  private readonly log: (message: string) => void;

  constructor(
    rootOverride: string | undefined,
    log: (message: string) => void,
    private readonly maxFileBytes = DEFAULT_AUDIT_FILE_BYTES,
  ) {
    const paths = ensureAppPaths(rootOverride);
    this.filePath = path.join(paths.logs, "audit.jsonl");
    this.log = log;
  }

  append(eventInput: AuditEventInput): void {
    const event: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      action: sanitizeLogText(eventInput.action).slice(0, 128),
      status: sanitizeLogText(eventInput.status).slice(0, 32),
      clusterId: sanitizeLogText(eventInput.clusterId).slice(0, 256),
      namespace: sanitizeLogText(eventInput.namespace).slice(0, 256),
      resource: sanitizeLogText(eventInput.resource).slice(0, 256),
      name: sanitizeLogText(eventInput.name).slice(0, 512),
      commandPreview: sanitizeLogText(eventInput.commandPreview).slice(0, 4000),
      message: sanitizeLogText(eventInput.message).slice(0, 1000),
      extra: sanitizeExtra(eventInput.extra ?? {}),
    };

    let line = JSON.stringify(event);
    if (Buffer.byteLength(line, "utf8") > MAX_AUDIT_LINE_BYTES) {
      event.commandPreview = "[truncated]";
      event.message = "[truncated]";
      event.extra = { truncated: true };
      line = JSON.stringify(event);
    }

    try {
      if (
        this.maxFileBytes > 0 &&
        fs.existsSync(this.filePath) &&
        fs.statSync(this.filePath).size + Buffer.byteLength(line, "utf8") + 1 > this.maxFileBytes
      ) {
        const previousPath = path.join(path.dirname(this.filePath), "audit.previous.jsonl");
        fs.rmSync(previousPath, { force: true });
        fs.renameSync(this.filePath, previousPath);
      }
      fs.appendFileSync(this.filePath, `${line}\n`, "utf8");
    } catch (error) {
      this.log(
        `failed to write audit event action=${sanitizeLogText(eventInput.action)}: ${String(error)}`,
      );
    }
  }

  read(limit = DEFAULT_AUDIT_LIMIT): Array<Record<string, unknown>> {
    const safeLimit = Math.max(1, Math.min(MAX_AUDIT_LIMIT, Math.trunc(limit)));

    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    try {
      const previousPath = path.join(path.dirname(this.filePath), "audit.previous.jsonl");
      const lines = [previousPath, this.filePath]
        .filter((filePath) => fs.existsSync(filePath))
        .map((filePath) => fs.readFileSync(filePath, "utf8"))
        .join("")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-safeLimit)
        .reverse();

      const events: Array<Record<string, unknown>> = [];
      for (const line of lines) {
        try {
          const payload: unknown = JSON.parse(line);
          if (payload && typeof payload === "object" && !Array.isArray(payload)) {
            events.push(payload as Record<string, unknown>);
          }
        } catch {
          // Ignore a damaged line and keep the rest of the audit log readable.
        }
      }
      return events;
    } catch (error) {
      this.log(`failed to read audit log: ${String(error)}`);
      return [];
    }
  }
}
