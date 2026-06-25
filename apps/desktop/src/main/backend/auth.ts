import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "file://",
  "null",
]);

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function requestOrigin(request: IncomingMessage): string {
  return headerValue(request.headers.origin);
}

export function isAllowedOrigin(origin: string): boolean {
  return origin === "" || ALLOWED_ORIGINS.has(origin);
}

export function requestToken(request: IncomingMessage): string {
  return headerValue(request.headers["x-kubedeck-token"]);
}

export function websocketToken(request: IncomingMessage): string {
  const queryToken = new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get("token") ?? "";
  return queryToken || requestToken(request);
}

export function isAuthorized(providedToken: string, sessionToken: string): boolean {
  return Boolean(providedToken) && Boolean(sessionToken) && safeEqual(providedToken, sessionToken);
}

export function writePolicyViolation(request: IncomingMessage, socket: Duplex, reason: string): void {
  const key = headerValue(request.headers["sec-websocket-key"]);
  if (!key) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return;
  }

  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  const reasonBuffer = Buffer.from(reason.slice(0, 100), "utf8");
  const payloadLength = 2 + reasonBuffer.length;
  const frame = Buffer.alloc(2 + payloadLength);
  frame[0] = 0x88;
  frame[1] = payloadLength;
  frame.writeUInt16BE(1008, 2);
  reasonBuffer.copy(frame, 4);

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );
  socket.end(frame);
}
