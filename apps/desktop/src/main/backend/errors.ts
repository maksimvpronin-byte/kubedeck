import type { ServerResponse } from "node:http";

export interface ErrorInfo {
  code: string;
  message: string;
  rawStderr: string;
  commandPreview: string;
}

export function errorInfo(code: string, message: string): ErrorInfo {
  return {
    code,
    message,
    rawStderr: "",
    commandPreview: "",
  };
}

export function writeError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }

  const body = JSON.stringify({
    detail: errorInfo(code, message),
  });

  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}
