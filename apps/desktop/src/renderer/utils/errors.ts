import { ApiError } from "../api";
import type { ErrorInfo } from "../types";

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
}

export function asErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof ApiError) {
    return normalizeErrorInfo(error.info);
  }

  if (typeof error === "string") {
    return makeErrorInfo(error);
  }

  if (error instanceof Error) {
    return makeErrorInfo(error.message || "Unknown error");
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message =
      typeof record.message === "string" ? record.message :
      typeof record.detail === "string" ? record.detail :
      typeof record.error === "string" ? record.error :
      "Unknown error";

    return {
      code: typeof record.code === "string" ? record.code : "ERROR",
      message,
      rawStderr: typeof record.rawStderr === "string" ? record.rawStderr : "",
      commandPreview: typeof record.commandPreview === "string" ? record.commandPreview : "",
    };
  }

  return makeErrorInfo(String(error));
}

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
