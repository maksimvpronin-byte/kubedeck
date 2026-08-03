import type { ServerResponse } from "node:http";
import { ClusterNotFoundError } from "../config/configStore";
import type { ErrorInfo } from "../errors";
import { writeError } from "../errors";
import { RequestBodyError, writeJson } from "../http";
import { KubectlError, writeKubectlError } from "../kubectl/errors";
import { RequestValidationError } from "../validation";

export class RouteInfoError extends Error {
  constructor(
    readonly statusCode: number,
    readonly info: ErrorInfo,
  ) {
    super(info.message);
  }
}

interface WriteRouteErrorOptions {
  label: string;
  fallbackCode: string;
  fallbackMessage: string;
  logDetail?: boolean;
  extra?: (error: unknown) => boolean;
}

export function writeRouteError(response: ServerResponse, error: unknown, log: (message: string) => void, options: WriteRouteErrorOptions): void {
  if (error instanceof RequestBodyError) {
    writeError(response, error.code === "REQUEST_TOO_LARGE" ? 413 : 400, error.code, error.message);
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
  if (error instanceof RouteInfoError) {
    writeJson(response, { detail: error.info }, error.statusCode);
    return;
  }
  if (options.extra?.(error)) return;
  if (error instanceof KubectlError) {
    writeKubectlError(response, error);
    return;
  }

  const detail = options.logDetail === false ? "" : `: ${error instanceof Error ? error.message : String(error)}`;
  log(`gateway ${options.label} failed${detail}`);
  writeError(response, 500, options.fallbackCode, options.fallbackMessage);
}
