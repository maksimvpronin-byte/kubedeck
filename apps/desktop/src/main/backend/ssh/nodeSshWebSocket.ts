import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import { Client, type ConnectConfig } from "ssh2";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import type { AuditStore } from "../audit/auditStore";
import { writePolicyViolation } from "../auth";
import { RequestValidationError, validateIdentifier } from "../validation";

const MAX_CLIENT_MESSAGE_BYTES = 256 * 1024;
const MAX_SECRET_BYTES = 128 * 1024;
const MAX_PRIVATE_KEY_BYTES = 2 * 1024 * 1024;
const FIRST_MESSAGE_TIMEOUT_MS = 90_000;
const CONNECT_TIMEOUT_MS = 20_000;
const DEFAULT_ROWS = 30;
const DEFAULT_COLS = 100;
const MIN_ROWS = 8;
const MAX_ROWS = 200;
const MIN_COLS = 20;
const MAX_COLS = 500;

type SshAuthMethod = "password" | "privateKey" | "agent";

type SshWindow = {
  term: string;
  rows: number;
  cols: number;
  height: number;
  width: number;
};

export interface SshChannelLike {
  stderr?: {
    on(event: "data", listener: (data: Buffer | string) => void): unknown;
  };
  destroyed?: boolean;
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  write(data: string): unknown;
  setWindow(rows: number, cols: number, height: number, width: number): void;
  close(): void;
  end(): void;
  destroy(): void;
}

export interface SshClientLike {
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;
  connect(config: ConnectConfig): void;
  shell(
    window: SshWindow,
    callback: (error?: Error, stream?: SshChannelLike) => void,
  ): void;
  forwardOut(
    sourceHost: string,
    sourcePort: number,
    destinationHost: string,
    destinationPort: number,
    callback: (error?: Error, stream?: Duplex) => void,
  ): void;
  end(): void;
  destroy(): void;
}

export type SshClientFactory = () => SshClientLike;

export interface NodeSshTarget {
  clusterId: string;
  name: string;
}

interface NormalizedConnection {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password: string;
  keyPath: string;
  keyPassphrase: string;
}

interface NormalizedConnectPayload {
  target: NormalizedConnection;
  useJumpHost: boolean;
  jump: NormalizedConnection | null;
  rows: number;
  cols: number;
}

interface SshSession {
  id: string;
  target: NodeSshTarget;
  socket: WebSocket;
  clients: Set<SshClientLike>;
  channel: SshChannelLike | null;
  commandPreview: string;
  opened: boolean;
  stop: (reason: string, closeCode?: number) => Promise<void>;
}

interface NodeSshWebSocketOptions {
  clientFactory?: SshClientFactory;
  firstMessageTimeoutMs?: number;
  connectTimeoutMs?: number;
}

function decodePart(value: string, field: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new RequestValidationError(
      400,
      "INVALID_IDENTIFIER",
      `${field} is not valid URL encoding`,
    );
  }
}

function rawDataByteLength(data: RawData): number {
  if (typeof data === "string") return Buffer.byteLength(data, "utf8");
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) return data.reduce((sum, item) => sum + item.length, 0);
  return data.byteLength;
}

function rawDataText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function safeSend(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // Closing sockets are best-effort and must not crash Gateway.
  }
}

function clampInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function limitedText(value: unknown, maxBytes: number, field: string): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new RequestValidationError(
      400,
      "SSH_VALUE_TOO_LARGE",
      `${field} is too large`,
    );
  }
  return text;
}

function normalizeHost(value: unknown, field = "host"): string {
  const host = limitedText(value, 1024, field).trim();
  if (!host) {
    throw new RequestValidationError(400, "SSH_HOST_REQUIRED", `${field} is required`);
  }
  if (/\s/.test(host) || !/^[A-Za-z0-9_.:-]+$/.test(host)) {
    throw new RequestValidationError(
      400,
      "INVALID_SSH_HOST",
      `${field} contains unsupported characters`,
    );
  }
  return host;
}

function normalizePort(value: unknown, field = "port"): number {
  const port = Number(value || 22);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RequestValidationError(
      400,
      "INVALID_SSH_PORT",
      `${field} must be between 1 and 65535`,
    );
  }
  return port;
}

function normalizeUsername(value: unknown, field = "username"): string {
  const username = limitedText(value, 1024, field).trim();
  if (!username) {
    throw new RequestValidationError(
      400,
      "SSH_USERNAME_REQUIRED",
      `${field} is required`,
    );
  }
  if (/\s/.test(username) || !/^[A-Za-z0-9_.@\\-]+$/.test(username)) {
    throw new RequestValidationError(
      400,
      "INVALID_SSH_USERNAME",
      `${field} contains unsupported characters`,
    );
  }
  return username;
}

function normalizeAuthMethod(value: unknown, field = "authMethod"): SshAuthMethod {
  const method = limitedText(value || "agent", 64, field).trim();
  if (!new Set(["password", "privateKey", "agent"]).has(method)) {
    throw new RequestValidationError(
      400,
      "INVALID_SSH_AUTH_METHOD",
      `${field} must be password, privateKey, or agent`,
    );
  }
  return method as SshAuthMethod;
}

function normalizeConnection(
  payload: Record<string, unknown>,
  prefix: "" | "jump",
  fallbackUsername = "",
): NormalizedConnection {
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
    port: normalizePort(payload[portField] || 22, portField),
    username: normalizeUsername(
      payload[usernameField] || fallbackUsername,
      usernameField,
    ),
    authMethod,
    password: limitedText(payload[passwordField], MAX_SECRET_BYTES, passwordField),
    keyPath: limitedText(payload[keyPathField], 4096, keyPathField).trim(),
    keyPassphrase: limitedText(
      payload[keyPassphraseField],
      MAX_SECRET_BYTES,
      keyPassphraseField,
    ),
  };
  if (authMethod === "password" && !connection.password) {
    throw new RequestValidationError(
      400,
      "SSH_PASSWORD_REQUIRED",
      `${capitalized || "SSH"} password is required`,
    );
  }
  if (authMethod === "privateKey" && !connection.keyPath) {
    throw new RequestValidationError(
      400,
      "SSH_PRIVATE_KEY_REQUIRED",
      `${capitalized || "SSH"} private key path is required`,
    );
  }
  return connection;
}

export function normalizeSshConnectPayload(
  value: unknown,
): NormalizedConnectPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError(
      400,
      "INVALID_SSH_MESSAGE",
      "SSH connect message must be an object",
    );
  }
  const payload = value as Record<string, unknown>;
  if (payload.type !== "connect") {
    throw new RequestValidationError(
      400,
      "INVALID_SSH_MESSAGE",
      "First SSH websocket message must be type=connect",
    );
  }
  const target = normalizeConnection(payload, "");
  const useJumpHost = Boolean(payload.useJumpHost);
  return {
    target,
    useJumpHost,
    jump: useJumpHost
      ? normalizeConnection(payload, "jump", target.username)
      : null,
    cols: clampInteger(payload.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS),
    rows: clampInteger(payload.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS),
  };
}

export function matchNodeSshWebSocket(
  request: IncomingMessage,
): NodeSshTarget | null {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const match = url.pathname.match(/^\/clusters\/([^/]+)\/nodes\/([^/]+)\/ssh$/);
  if (!match) return null;
  return {
    clusterId: validateIdentifier(
      decodePart(match[1], "cluster_id"),
      "cluster_id",
      128,
    ),
    name: validateIdentifier(decodePart(match[2], "name"), "name", 253),
  };
}

function quotePreview(value: string): string {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

export function buildSshCommandPreview(
  payload: NormalizedConnectPayload,
): string {
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

function defaultPrivateKeyPath(): string | null {
  const root = process.env.USERPROFILE || homedir();
  for (const name of ["id_ed25519", "id_ecdsa", "id_rsa", "id_dsa"]) {
    const candidate = path.join(root, ".ssh", name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readPrivateKey(keyPath: string): Buffer {
  let size: number;
  try {
    size = statSync(keyPath).size;
  } catch {
    throw new RequestValidationError(
      400,
      "SSH_PRIVATE_KEY_NOT_FOUND",
      `Private key file was not found: ${keyPath}`,
    );
  }
  if (size > MAX_PRIVATE_KEY_BYTES) {
    throw new RequestValidationError(
      400,
      "SSH_PRIVATE_KEY_TOO_LARGE",
      "Private key file is too large",
    );
  }
  try {
    return readFileSync(keyPath);
  } catch {
    throw new RequestValidationError(
      400,
      "SSH_PRIVATE_KEY_READ_FAILED",
      `Unable to read private key file: ${keyPath}`,
    );
  }
}

function connectConfig(
  connection: NormalizedConnection,
  connectTimeoutMs: number,
  sock?: Duplex,
): ConnectConfig {
  const config: ConnectConfig = {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    readyTimeout: connectTimeoutMs,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
    agentForward: false,
    ...(sock ? { sock } : {}),
  };
  if (connection.authMethod === "password") {
    config.password = connection.password;
  } else if (connection.authMethod === "privateKey") {
    config.privateKey = readPrivateKey(connection.keyPath);
    if (connection.keyPassphrase) config.passphrase = connection.keyPassphrase;
  } else {
    const agent = process.env.SSH_AUTH_SOCK?.trim();
    if (agent) {
      config.agent = agent;
    } else {
      const keyPath = defaultPrivateKeyPath();
      if (keyPath) {
        config.privateKey = readPrivateKey(keyPath);
      } else if (process.platform === "win32") {
        // ssh2 uses the special value "pageant" for the Windows Pageant agent.
        config.agent = "pageant";
      }
    }
  }
  return config;
}

function redactError(error: unknown, secrets: string[]): string {
  let text = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret) text = text.replaceAll(secret, "[REDACTED]");
  }
  text = text.replace(/[\r\n\t]+/g, " ").trim();
  return text.slice(0, 12_000) || "SSH operation failed";
}

function closeChannel(channel: SshChannelLike | null): void {
  if (!channel) return;
  for (const close of [
    () => channel.close(),
    () => channel.end(),
    () => channel.destroy(),
  ]) {
    try {
      close();
    } catch {
      // Best effort.
    }
  }
}

function closeClient(client: SshClientLike): void {
  try {
    client.end();
  } catch {
    // Best effort.
  }
  try {
    client.destroy();
  } catch {
    // Best effort.
  }
}

export class NodeSshWebSocketServer {
  private readonly server = new WebSocketServer({
    noServer: true,
    clientTracking: true,
    maxPayload: MAX_CLIENT_MESSAGE_BYTES,
  });
  private readonly sessions = new Map<string, SshSession>();
  private readonly clientFactory: SshClientFactory;
  private readonly firstMessageTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private closed = false;

  constructor(
    private readonly auditStore: AuditStore,
    private readonly log: (message: string) => void,
    options: NodeSshWebSocketOptions = {},
  ) {
    this.clientFactory =
      options.clientFactory ?? (() => new Client() as unknown as SshClientLike);
    this.firstMessageTimeoutMs =
      options.firstMessageTimeoutMs ?? FIRST_MESSAGE_TIMEOUT_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    let target: NodeSshTarget | null;
    try {
      target = matchNodeSshWebSocket(request);
    } catch (error) {
      if (this.isSshPath(request)) {
        writePolicyViolation(
          request,
          socket,
          error instanceof Error ? error.message : "Invalid SSH route",
        );
        return true;
      }
      return false;
    }
    if (!target) return false;
    if (this.closed) {
      writePolicyViolation(request, socket, "SSH service is shutting down");
      return true;
    }
    this.server.handleUpgrade(request, socket, head, (websocket) => {
      void this.open(websocket, target as NodeSshTarget);
    });
    return true;
  }

  activeCount(): number {
    return this.sessions.size;
  }

  async stopCluster(clusterId: string): Promise<number> {
    const sessions = [...this.sessions.values()].filter(
      (session) => session.target.clusterId === clusterId,
    );
    await Promise.all(
      sessions.map((session) => session.stop("Cluster was removed", 1001)),
    );
    return sessions.length;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const sessions = [...this.sessions.values()];
    await Promise.all(
      sessions.map((session) => session.stop("KubeDeck is shutting down", 1001)),
    );
    this.sessions.clear();
    for (const socket of this.server.clients) {
      try {
        socket.close(1001, "KubeDeck is shutting down");
      } catch {
        socket.terminate();
      }
    }
    await new Promise<void>((resolve) => {
      try {
        this.server.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  private async open(socket: WebSocket, target: NodeSshTarget): Promise<void> {
    const id = randomUUID();
    let finishing: Promise<void> | null = null;
    const session: SshSession = {
      id,
      target,
      socket,
      clients: new Set<SshClientLike>(),
      channel: null,
      commandPreview: "",
      opened: false,
      stop: async (reason: string, closeCode = 1000) => {
        if (finishing) return finishing;
        finishing = (async () => {
          const existed = this.sessions.delete(id);
          closeChannel(session.channel);
          session.channel = null;
          for (const client of [...session.clients].reverse()) closeClient(client);
          session.clients.clear();
          if (session.opened && existed) {
            this.auditStore.append({
              action: "node.ssh",
              status: "closed",
              clusterId: target.clusterId,
              namespace: "_cluster",
              resource: "nodes",
              name: target.name,
              commandPreview: session.commandPreview,
              message: reason,
            });
          }
          safeSend(socket, { type: "status", data: "SSH session closed" });
          if (socket.readyState === WebSocket.OPEN) {
            try {
              socket.close(closeCode, reason.slice(0, 120));
            } catch {
              socket.terminate();
            }
          }
          this.log(
            `node ssh closed cluster=${target.clusterId} node=${target.name}`,
          );
        })();
        return finishing;
      },
    };
    this.sessions.set(id, session);

    socket.once("close", () => void session.stop("WebSocket closed"));
    socket.once("error", () => void session.stop("WebSocket error", 1011));
    safeSend(socket, {
      type: "status",
      data: "Waiting for SSH connection settings",
    });

    let payload: NormalizedConnectPayload | null = null;
    try {
      const first = await this.waitForFirstMessage(socket);
      payload = normalizeSshConnectPayload(JSON.parse(first));
      session.commandPreview = buildSshCommandPreview(payload);
      safeSend(socket, { type: "status", data: "Connecting to SSH..." });

      let jumpClient: SshClientLike | null = null;
      let tunnel: Duplex | undefined;
      if (payload.jump) {
        jumpClient = await this.connectClient(
          connectConfig(payload.jump, this.connectTimeoutMs),
          session,
        );
        tunnel = await this.forwardOut(
          jumpClient,
          payload.target.host,
          payload.target.port,
        );
      }
      const targetClient = await this.connectClient(
        connectConfig(payload.target, this.connectTimeoutMs, tunnel),
        session,
      );
      const channel = await this.openShell(
        targetClient,
        payload.cols,
        payload.rows,
      );
      session.channel = channel;
      session.opened = true;
      this.bindConnectedSession(session, payload, channel);

      this.auditStore.append({
        action: "node.ssh",
        status: "opened",
        clusterId: target.clusterId,
        namespace: "_cluster",
        resource: "nodes",
        name: target.name,
        commandPreview: session.commandPreview,
        extra: {
          host: payload.target.host,
          port: payload.target.port,
          username: payload.target.username,
          authMethod: payload.target.authMethod,
          jumpHost: payload.jump?.host ?? "",
        },
      });
      this.log(`node ssh opened cluster=${target.clusterId} node=${target.name}`);
      safeSend(socket, { type: "status", data: "Connected" });
    } catch (error) {
      const secrets = payload
        ? [
            payload.target.password,
            payload.target.keyPassphrase,
            payload.jump?.password ?? "",
            payload.jump?.keyPassphrase ?? "",
          ]
        : [];
      const message = redactError(error, secrets);
      safeSend(socket, { type: "error", data: message });
      this.auditStore.append({
        action: "node.ssh",
        status: "failed",
        clusterId: target.clusterId,
        namespace: "_cluster",
        resource: "nodes",
        name: target.name,
        commandPreview: session.commandPreview,
        message,
      });
      await session.stop("SSH connection failed", 1011);
    }
  }

  private waitForFirstMessage(socket: WebSocket): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for SSH connection settings"));
      }, this.firstMessageTimeoutMs);
      const onMessage = (data: RawData) => {
        cleanup();
        if (rawDataByteLength(data) > MAX_CLIENT_MESSAGE_BYTES) {
          reject(new Error("SSH connection message is too large"));
          return;
        }
        resolve(rawDataText(data));
      };
      const onClose = () => {
        cleanup();
        reject(new Error("SSH websocket closed before connect"));
      };
      const onError = () => {
        cleanup();
        reject(new Error("SSH websocket failed before connect"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("message", onMessage);
        socket.off("close", onClose);
        socket.off("error", onError);
      };
      socket.once("message", onMessage);
      socket.once("close", onClose);
      socket.once("error", onError);
    });
  }

  private connectClient(
    config: ConnectConfig,
    session: SshSession,
  ): Promise<SshClientLike> {
    return new Promise((resolve, reject) => {
      const client = this.clientFactory();
      session.clients.add(client);
      let settled = false;
      const timer = setTimeout(() => {
        fail(new Error("SSH connection timed out"));
      }, this.connectTimeoutMs + 1000);
      const cleanup = () => {
        clearTimeout(timer);
        client.removeListener("ready", ready);
        client.removeListener("error", fail);
        client.removeListener("close", closed);
      };
      const ready = () => {
        if (settled) return;
        settled = true;
        cleanup();
        client.on("error", () => {
          safeSend(session.socket, {
            type: "error",
            data: "SSH connection error",
          });
          void session.stop("SSH connection error", 1011);
        });
        client.once("close", () => void session.stop("SSH connection closed"));
        resolve(client);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const closed = () => fail(new Error("SSH connection closed before ready"));
      client.once("ready", ready);
      client.once("error", fail);
      client.once("close", closed);
      try {
        client.connect(config);
      } catch (error) {
        fail(error);
      }
    });
  }

  private forwardOut(
    client: SshClientLike,
    host: string,
    port: number,
  ): Promise<Duplex> {
    return new Promise((resolve, reject) => {
      client.forwardOut(
        "127.0.0.1",
        0,
        host,
        port,
        (error, stream) => {
          if (error || !stream) {
            reject(error ?? new Error("Jump host tunnel was not created"));
            return;
          }
          resolve(stream);
        },
      );
    });
  }

  private openShell(
    client: SshClientLike,
    cols: number,
    rows: number,
  ): Promise<SshChannelLike> {
    return new Promise((resolve, reject) => {
      client.shell(
        {
          term: "xterm-256color",
          cols,
          rows,
          height: 0,
          width: 0,
        },
        (error, stream) => {
          if (error || !stream) {
            reject(error ?? new Error("SSH shell was not created"));
            return;
          }
          resolve(stream);
        },
      );
    });
  }

  private bindConnectedSession(
    session: SshSession,
    payload: NormalizedConnectPayload,
    channel: SshChannelLike,
  ): void {
    const { socket } = session;
    channel.on("data", (data: Buffer | string) => {
      safeSend(socket, {
        type: "output",
        data: Buffer.isBuffer(data) ? data.toString("utf8") : String(data),
      });
    });
    channel.stderr?.on("data", (data: Buffer | string) => {
      safeSend(socket, {
        type: "output",
        data: Buffer.isBuffer(data) ? data.toString("utf8") : String(data),
      });
    });
    channel.once("close", () => void session.stop("SSH channel closed"));
    channel.once("end", () => void session.stop("SSH channel ended"));
    channel.once("error", (error: unknown) => {
      safeSend(socket, {
        type: "error",
        data: redactError(error, [
          payload.target.password,
          payload.target.keyPassphrase,
          payload.jump?.password ?? "",
          payload.jump?.keyPassphrase ?? "",
        ]),
      });
      void session.stop("SSH channel failed", 1011);
    });

    socket.on("message", (data: RawData) => {
      if (rawDataByteLength(data) > MAX_CLIENT_MESSAGE_BYTES) {
        socket.close(1009, "Message too large");
        return;
      }
      let message: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(rawDataText(data));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("SSH message must be an object");
        }
        message = parsed as Record<string, unknown>;
      } catch {
        safeSend(socket, { type: "error", data: "Invalid SSH message" });
        return;
      }
      if (message.type === "input") {
        const input = limitedText(message.data, MAX_CLIENT_MESSAGE_BYTES, "input");
        if (input && !channel.destroyed) channel.write(input);
        return;
      }
      if (message.type === "resize") {
        if (!channel.destroyed) {
          const cols = clampInteger(
            message.cols,
            DEFAULT_COLS,
            MIN_COLS,
            MAX_COLS,
          );
          const rows = clampInteger(
            message.rows,
            DEFAULT_ROWS,
            MIN_ROWS,
            MAX_ROWS,
          );
          try {
            channel.setWindow(rows, cols, 0, 0);
          } catch {
            // Resize is best-effort.
          }
        }
        return;
      }
      if (message.type === "close") {
        void session.stop("Closed by user");
        return;
      }
      safeSend(socket, { type: "error", data: "Unsupported SSH message" });
    });
  }

  private isSshPath(request: IncomingMessage): boolean {
    try {
      return new URL(request.url ?? "/", "http://127.0.0.1").pathname.endsWith(
        "/ssh",
      );
    } catch {
      return false;
    }
  }
}
