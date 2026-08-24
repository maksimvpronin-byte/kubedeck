// Everything the SSH websocket checks before a socket is opened: the shape of
// the connect message, the limits on every field in it, and the ssh command
// line the drawer shows back. All pure, so it can be tested without a network
// and read without the session machinery around it.
import type { IncomingMessage } from "node:http";
import { DEFAULT_COLS, DEFAULT_ROWS, MAX_COLS, MAX_ROWS, MIN_COLS, MIN_ROWS } from "../terminal/ptyGeometry";
import { decodePathPart, RequestValidationError, validateIdentifier } from "../validation";
import { clampInteger } from "../webSocketMessages";

export const MAX_SECRET_BYTES = 128 * 1024;
export const MAX_PRIVATE_KEY_BYTES = 2 * 1024 * 1024;

export type SshAuthMethod = "password" | "privateKey" | "agent";

export interface NodeSshTarget {
  clusterId: string;
  name: string;
}
export interface NormalizedConnection {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password: string;
  keyPath: string;
  keyPassphrase: string;
}

export interface NormalizedConnectPayload {
  target: NormalizedConnection;
  useJumpHost: boolean;
  jump: NormalizedConnection | null;
  rows: number;
  cols: number;
}
export function limitedText(value: unknown, maxBytes: number, field: string): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new RequestValidationError(400, "SSH_VALUE_TOO_LARGE", `${field} is too large`);
  }
  return text;
}

export function normalizeHost(value: unknown, field = "host"): string {
  const host = limitedText(value, 1024, field).trim();
  if (!host) {
    throw new RequestValidationError(400, "SSH_HOST_REQUIRED", `${field} is required`);
  }
  if (/\s/.test(host) || !/^[A-Za-z0-9_.:-]+$/.test(host)) {
    throw new RequestValidationError(400, "INVALID_SSH_HOST", `${field} contains unsupported characters`);
  }
  return host;
}

export const DEFAULT_SSH_PORT = 22;

/**
 * An absent port is 22. A port that was given and cannot work is refused.
 *
 * These used to be the same case: the check read `Number(value || 22)`, so 0 -
 * falsy - became 22 and was accepted. Nothing could reach it that way, because
 * the SSH form defaults an empty field before sending, but a validator that
 * silently substitutes a value for one it was given is not a validator.
 */
export function normalizePort(value: unknown, field = "port"): number {
  if (value === undefined || value === null || value === "") return DEFAULT_SSH_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RequestValidationError(400, "INVALID_SSH_PORT", `${field} must be between 1 and 65535`);
  }
  return port;
}

export function normalizeUsername(value: unknown, field = "username"): string {
  const username = limitedText(value, 1024, field).trim();
  if (!username) {
    throw new RequestValidationError(400, "SSH_USERNAME_REQUIRED", `${field} is required`);
  }
  if (/\s/.test(username) || !/^[A-Za-z0-9_.@\\-]+$/.test(username)) {
    throw new RequestValidationError(400, "INVALID_SSH_USERNAME", `${field} contains unsupported characters`);
  }
  return username;
}

export function normalizeAuthMethod(value: unknown, field = "authMethod"): SshAuthMethod {
  const method = limitedText(value || "agent", 64, field).trim();
  if (!new Set(["password", "privateKey", "agent"]).has(method)) {
    throw new RequestValidationError(400, "INVALID_SSH_AUTH_METHOD", `${field} must be password, privateKey, or agent`);
  }
  return method as SshAuthMethod;
}

export function normalizeConnection(payload: Record<string, unknown>, prefix: "" | "jump", fallbackUsername = ""): NormalizedConnection {
  const capitalized = prefix ? "Jump" : "";
  const field = (name: string) => `${prefix}${prefix ? name[0].toUpperCase() + name.slice(1) : name}`;
  const hostField = field("host");
  const portField = field("port");
  const usernameField = field("username");
  const authField = field("authMethod");
  const passwordField = field("password");
  const keyPathField = field("keyPath");
  const keyPassphraseField = field("keyPassphrase");
  const authMethod = normalizeAuthMethod(payload[authField], authField);
  const connection: NormalizedConnection = {
    host: normalizeHost(payload[hostField], hostField),
    port: normalizePort(payload[portField], portField),
    username: normalizeUsername(payload[usernameField] || fallbackUsername, usernameField),
    authMethod,
    password: limitedText(payload[passwordField], MAX_SECRET_BYTES, passwordField),
    keyPath: limitedText(payload[keyPathField], 4096, keyPathField).trim(),
    keyPassphrase: limitedText(payload[keyPassphraseField], MAX_SECRET_BYTES, keyPassphraseField),
  };
  if (authMethod === "password" && !connection.password) {
    throw new RequestValidationError(400, "SSH_PASSWORD_REQUIRED", `${capitalized || "SSH"} password is required`);
  }
  if (authMethod === "privateKey" && !connection.keyPath) {
    throw new RequestValidationError(400, "SSH_PRIVATE_KEY_REQUIRED", `${capitalized || "SSH"} private key path is required`);
  }
  return connection;
}

export function normalizeSshConnectPayload(value: unknown): NormalizedConnectPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError(400, "INVALID_SSH_MESSAGE", "SSH connect message must be an object");
  }
  const payload = value as Record<string, unknown>;
  if (payload.type !== "connect") {
    throw new RequestValidationError(400, "INVALID_SSH_MESSAGE", "First SSH websocket message must be type=connect");
  }
  const target = normalizeConnection(payload, "");
  const useJumpHost = Boolean(payload.useJumpHost);
  return {
    target,
    useJumpHost,
    jump: useJumpHost ? normalizeConnection(payload, "jump", target.username) : null,
    cols: clampInteger(payload.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS),
    rows: clampInteger(payload.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS),
  };
}

export function matchNodeSshWebSocket(request: IncomingMessage): NodeSshTarget | null {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const match = url.pathname.match(/^\/clusters\/([^/]+)\/nodes\/([^/]+)\/ssh$/);
  if (!match) return null;
  return {
    clusterId: validateIdentifier(decodePathPart(match[1], "cluster_id"), "cluster_id", 128),
    name: validateIdentifier(decodePathPart(match[2], "name"), "name", 253),
  };
}

export function quotePreview(value: string): string {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

export function buildSshCommandPreview(payload: NormalizedConnectPayload): string {
  const parts = ["ssh"];
  if (payload.target.port !== 22) {
    parts.push("-p", String(payload.target.port));
  }
  if (payload.target.authMethod === "privateKey") {
    parts.push("-i", quotePreview(payload.target.keyPath));
  }
  if (payload.jump) {
    let jump = `${payload.jump.username}@${payload.jump.host}`;
    if (payload.jump.port !== 22) jump += `:${payload.jump.port}`;
    parts.push("-J", quotePreview(jump));
  }
  parts.push(`${payload.target.username}@${payload.target.host}`);
  return parts.join(" ");
}
