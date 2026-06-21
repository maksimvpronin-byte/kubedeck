import type { ServerResponse } from "node:http";
import type { ErrorInfo } from "../errors";
import { writeJson } from "../http";

const ERROR_SNIPPET_CHARS = 12_000;
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

export class KubectlError extends Error {
  constructor(readonly info: ErrorInfo) {
    super(info.message);
  }
}

export function sanitizeKubectlText(value: string): string {
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

export function truncateKubectlText(value: string, limit = ERROR_SNIPPET_CHARS): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n... truncated, ${value.length - limit} more characters ...`;
}

export function classifyKubectlError(stderr: string): string {
  const lowered = (stderr || "").toLowerCase();

  if (lowered.includes("forbidden")) return "FORBIDDEN";
  if (
    lowered.includes("unauthorized") ||
    lowered.includes("the server has asked for the client to provide credentials")
  ) return "UNAUTHORIZED";
  if (lowered.includes("not found")) return "NOT_FOUND";
  if (
    lowered.includes("timed out") ||
    lowered.includes("deadline exceeded") ||
    lowered.includes("context deadline exceeded")
  ) return "TIMEOUT";
  if (
    lowered.includes("connection refused") ||
    lowered.includes("no route to host") ||
    lowered.includes("i/o timeout")
  ) return "CLUSTER_UNAVAILABLE";
  if (
    lowered.includes("certificate") &&
    (lowered.includes("unknown authority") || lowered.includes("expired"))
  ) return "TLS_ERROR";

  return "KUBECTL_COMMAND_FAILED";
}

export function writeKubectlError(
  response: ServerResponse,
  error: KubectlError,
  statusCode = 502,
): void {
  writeJson(response, { detail: error.info }, statusCode);
}
