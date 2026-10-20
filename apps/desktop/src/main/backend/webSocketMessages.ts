import { WebSocket, type RawData } from "ws";
export function rawDataByteLength(data: RawData): number {
  if (typeof data === "string") return Buffer.byteLength(data, "utf8");
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) return data.reduce((sum, item) => sum + item.length, 0);
  return data.byteLength;
}
export function rawDataText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}
export function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  // Only primitives are converted: Number() on a parsed object such as
  // {"toString":null} throws, and this runs inside a socket callback.
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}
export function safeSend(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    /* Closing sockets are best-effort. */
  }
}
