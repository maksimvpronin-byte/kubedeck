import type { IncomingMessage, ServerResponse } from "node:http";

export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_JSON" | "REQUEST_TOO_LARGE",
  ) {
    super(message);
  }
}

export function writeJson(
  response: ServerResponse,
  body: unknown,
  statusCode = 200,
): void {
  const serialized = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(serialized));
  response.end(serialized);
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBytes = 1024 * 1024,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let tooLarge = false;

    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;

      if (totalBytes > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }

      if (!tooLarge) {
        chunks.push(buffer);
      }
    });

    request.on("end", () => {
      if (tooLarge) {
        reject(new RequestBodyError("Request body is too large", "REQUEST_TOO_LARGE"));
        return;
      }

      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new RequestBodyError("Request body is not valid JSON", "INVALID_JSON"));
      }
    });

    request.on("error", reject);
  });
}
