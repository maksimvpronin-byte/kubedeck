import { ApiError } from "../api";
import type { ErrorInfo } from "../types";

export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError");
}

const SENSITIVE_FALLBACK_PATTERN = /(?:authorization|bearer|client[-_ ]?secret|password|private[-_ ]?key|secret|token|api[-_ ]?key)\b/i;

export function redactFallbackErrorText(value: unknown): string {
  const text =
    String(value ?? "Unknown error")
      .replace(/\s+/g, " ")
      .trim() || "Unknown error";
  return SENSITIVE_FALLBACK_PATTERN.test(text) ? "Sensitive error details were redacted" : text;
}

export function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof ApiError) {
    return normalizeErrorInfo(error.info);
  }

  if (typeof error === "string") {
    return makeErrorInfo(redactFallbackErrorText(error));
  }

  if (error instanceof Error) {
    return makeErrorInfo(redactFallbackErrorText(error.message || "Unknown error"));
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message =
      typeof record.message === "string"
        ? redactFallbackErrorText(record.message)
        : typeof record.detail === "string"
          ? redactFallbackErrorText(record.detail)
          : typeof record.error === "string"
            ? redactFallbackErrorText(record.error)
            : "Unknown error";

    return {
      code: typeof record.code === "string" ? record.code : "ERROR",
      message,
      rawStderr: typeof record.rawStderr === "string" ? redactFallbackErrorText(record.rawStderr) : "",
      commandPreview: typeof record.commandPreview === "string" ? redactFallbackErrorText(record.commandPreview) : "",
    };
  }

  return makeErrorInfo(redactFallbackErrorText(error));
}

export const asErrorInfo = toErrorInfo;

function makeErrorInfo(message: string): ErrorInfo {
  return {
    code: "ERROR",
    message,
    rawStderr: "",
    commandPreview: "",
  };
}

function normalizeErrorInfo(info: ErrorInfo): ErrorInfo {
  return {
    code: info.code || "ERROR",
    message: info.message || "Unknown error",
    rawStderr: info.rawStderr || "",
    commandPreview: info.commandPreview || "",
  };
}
