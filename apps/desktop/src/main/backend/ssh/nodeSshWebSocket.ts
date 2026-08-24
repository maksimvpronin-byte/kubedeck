// The payload checks and the ssh preview live next door; they are re-exported
// here because the gateway has always reached for them through this module.
export { buildSshCommandPreview, matchNodeSshWebSocket, normalizeSshConnectPayload } from "./sshPayload";
export type { NodeSshTarget } from "./sshPayload";
import {
  buildSshCommandPreview,
  limitedText,
  MAX_PRIVATE_KEY_BYTES,
  matchNodeSshWebSocket,
  type NodeSshTarget,
  type NormalizedConnection,
  type NormalizedConnectPayload,
  normalizeSshConnectPayload,
} from "./sshPayload";
import { DEFAULT_COLS, DEFAULT_ROWS, MAX_CLIENT_MESSAGE_BYTES, MAX_COLS, MAX_ROWS, MIN_COLS, MIN_ROWS } from "../terminal/ptyGeometry";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import { Client, type ConnectConfig, type HostVerifier } from "ssh2";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import type { AuditStore } from "../audit/auditStore";
import { writePolicyViolation } from "../auth";
import { RequestValidationError } from "../validation";
import { clampInteger, rawDataByteLength, rawDataText, safeSend } from "../webSocketMessages";
import { sshKeyAlgorithm, sshSha256Fingerprint, type SshHostKeyStore } from "./sshHostKeyStore";

const FIRST_MESSAGE_TIMEOUT_MS = 90_000;
const CONNECT_TIMEOUT_MS = 20_000;
const HOST_KEY_DECISION_TIMEOUT_MS = 120_000;

export type SshHostKeyRole = "target" | "jump";

/**
 * Raised when a connection is refused because of the host key. It is kept
 * separate from generic SSH errors so the renderer can tell "the server is not
 * who it claims to be" apart from "the password was wrong".
 */
export class SshHostKeyError extends Error {
  constructor(
    readonly code: "SSH_HOST_KEY_MISMATCH" | "SSH_HOST_KEY_REJECTED" | "SSH_HOST_KEY_TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "SshHostKeyError";
  }
}

interface HostKeyVerification {
  verifier: HostVerifier;
  failure: () => SshHostKeyError | null;
}

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
  shell(window: SshWindow, callback: (error?: Error, stream?: SshChannelLike) => void): void;
  forwardOut(sourceHost: string, sourcePort: number, destinationHost: string, destinationPort: number, callback: (error?: Error, stream?: Duplex) => void): void;
  end(): void;
  destroy(): void;
}

export type SshClientFactory = () => SshClientLike;

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
  hostKeyDecisionTimeoutMs?: number;
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
    throw new RequestValidationError(400, "SSH_PRIVATE_KEY_NOT_FOUND", `Private key file was not found: ${keyPath}`);
  }
  if (size > MAX_PRIVATE_KEY_BYTES) {
    throw new RequestValidationError(400, "SSH_PRIVATE_KEY_TOO_LARGE", "Private key file is too large");
  }
  try {
    return readFileSync(keyPath);
  } catch {
    throw new RequestValidationError(400, "SSH_PRIVATE_KEY_READ_FAILED", `Unable to read private key file: ${keyPath}`);
  }
}

function connectConfig(connection: NormalizedConnection, connectTimeoutMs: number, sock?: Duplex): ConnectConfig {
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

function withHostVerifier(config: ConnectConfig, verification: HostKeyVerification): ConnectConfig {
  return { ...config, hostVerifier: verification.verifier };
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
  for (const close of [() => channel.close(), () => channel.end(), () => channel.destroy()]) {
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
  private readonly hostKeyDecisionTimeoutMs: number;
  private closed = false;

  constructor(
    private readonly auditStore: AuditStore,
    private readonly hostKeys: SshHostKeyStore,
    private readonly log: (message: string) => void,
    options: NodeSshWebSocketOptions = {},
  ) {
    this.clientFactory = options.clientFactory ?? (() => new Client() as unknown as SshClientLike);
    this.firstMessageTimeoutMs = options.firstMessageTimeoutMs ?? FIRST_MESSAGE_TIMEOUT_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.hostKeyDecisionTimeoutMs = options.hostKeyDecisionTimeoutMs ?? HOST_KEY_DECISION_TIMEOUT_MS;
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    let target: NodeSshTarget | null;
    try {
      target = matchNodeSshWebSocket(request);
    } catch (error) {
      if (this.isSshPath(request)) {
        writePolicyViolation(request, socket, error instanceof Error ? error.message : "Invalid SSH route");
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

  clusterSessionCount(clusterId: string): number {
    return [...this.sessions.values()].filter((session) => session.target.clusterId === clusterId).length;
  }

  async stopCluster(clusterId: string): Promise<number> {
    const sessions = [...this.sessions.values()].filter((session) => session.target.clusterId === clusterId);
    await Promise.all(sessions.map((session) => session.stop("Cluster was removed", 1001)));
    return sessions.length;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const sessions = [...this.sessions.values()];
    await Promise.all(sessions.map((session) => session.stop("KubeDeck is shutting down", 1001)));
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
          this.log(`node ssh closed cluster=${target.clusterId} node=${target.name}`);
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
        const jumpVerification = this.hostKeyVerification(session, payload.jump, "jump");
        jumpClient = await this.connectClient(withHostVerifier(connectConfig(payload.jump, this.connectTimeoutMs), jumpVerification), session, jumpVerification);
        tunnel = await this.forwardOut(jumpClient, payload.target.host, payload.target.port);
      }
      const targetVerification = this.hostKeyVerification(session, payload.target, "target");
      const targetClient = await this.connectClient(withHostVerifier(connectConfig(payload.target, this.connectTimeoutMs, tunnel), targetVerification), session, targetVerification);
      const channel = await this.openShell(targetClient, payload.cols, payload.rows);
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
      const secrets = payload ? [payload.target.password, payload.target.keyPassphrase, payload.jump?.password ?? "", payload.jump?.keyPassphrase ?? ""] : [];
      const message = redactError(error, secrets);
      safeSend(socket, { type: "error", data: message, ...(error instanceof SshHostKeyError ? { code: error.code } : {}) });
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

  /**
   * Builds the `hostVerifier` passed to ssh2. It runs during the key exchange,
   * before any authentication, so a rejected host key means the password,
   * passphrase or agent signature is never offered to the server.
   */
  private hostKeyVerification(session: SshSession, connection: NormalizedConnection, role: SshHostKeyRole): HostKeyVerification {
    let failure: SshHostKeyError | null = null;
    return {
      failure: () => failure,
      verifier: (key, verify) => {
        void this.decideHostKey(session, connection, role, key).then(
          () => verify(true),
          (error: unknown) => {
            failure = error instanceof SshHostKeyError ? error : new SshHostKeyError("SSH_HOST_KEY_REJECTED", redactError(error, []));
            verify(false);
          },
        );
      },
    };
  }

  private async decideHostKey(session: SshSession, connection: NormalizedConnection, role: SshHostKeyRole, key: Buffer): Promise<void> {
    const fingerprint = sshSha256Fingerprint(key);
    const algorithm = sshKeyAlgorithm(key);
    const known = this.hostKeys.lookup(connection.host, connection.port);

    if (known && known.fingerprint === fingerprint) return;

    if (known) {
      this.auditHostKey(session, "host-key-mismatch", connection, role, algorithm, fingerprint);
      this.log(`node ssh host key mismatch host=${connection.host}:${connection.port} role=${role}`);
      throw new SshHostKeyError(
        "SSH_HOST_KEY_MISMATCH",
        `Host key for ${connection.host}:${connection.port} has changed. Remembered ${known.fingerprint}, received ${fingerprint}. Remove the remembered key in Settings if this change is expected.`,
      );
    }

    safeSend(session.socket, { type: "host-key-request", data: { role, host: connection.host, port: connection.port, algorithm, fingerprint } });

    if ((await this.waitForHostKeyDecision(session.socket)) !== "trust") {
      throw new SshHostKeyError("SSH_HOST_KEY_REJECTED", `Host key for ${connection.host}:${connection.port} was not accepted`);
    }

    this.hostKeys.remember(connection.host, connection.port, fingerprint, algorithm);
    this.auditHostKey(session, "host-key-trusted", connection, role, algorithm, fingerprint);
    this.log(`node ssh host key trusted host=${connection.host}:${connection.port} role=${role}`);
  }

  private auditHostKey(session: SshSession, status: string, connection: NormalizedConnection, role: SshHostKeyRole, algorithm: string, fingerprint: string): void {
    this.auditStore.append({
      action: "node.ssh",
      status,
      clusterId: session.target.clusterId,
      namespace: "_cluster",
      resource: "nodes",
      name: session.target.name,
      commandPreview: session.commandPreview,
      // A public key fingerprint is not a secret: it is what the user compares
      // against `ssh-keyscan` output. Passwords and passphrases never appear here.
      extra: { role, host: connection.host, port: connection.port, algorithm, fingerprint },
    });
  }

  private waitForHostKeyDecision(socket: WebSocket): Promise<"trust" | "reject"> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new SshHostKeyError("SSH_HOST_KEY_TIMEOUT", "Timed out waiting for the SSH host key decision"));
      }, this.hostKeyDecisionTimeoutMs);
      const onMessage = (data: RawData) => {
        if (rawDataByteLength(data) > MAX_CLIENT_MESSAGE_BYTES) {
          cleanup();
          reject(new SshHostKeyError("SSH_HOST_KEY_REJECTED", "SSH host key decision message is too large"));
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawDataText(data));
        } catch {
          parsed = null;
        }
        const message = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
        if (message?.type === "close") {
          cleanup();
          reject(new SshHostKeyError("SSH_HOST_KEY_REJECTED", "SSH session was closed before the host key decision"));
          return;
        }
        if (message?.type !== "host-key-decision") {
          // The renderer keeps sending terminal traffic while the dialog is open:
          // xterm reports a resize as soon as the prompt changes the layout. Such
          // messages are ignored, never applied, and the timeout stays the bound.
          return;
        }
        cleanup();
        resolve(message.decision === "trust" ? "trust" : "reject");
      };
      const onClose = () => {
        cleanup();
        reject(new SshHostKeyError("SSH_HOST_KEY_REJECTED", "SSH websocket closed before the host key decision"));
      };
      const onError = () => {
        cleanup();
        reject(new SshHostKeyError("SSH_HOST_KEY_REJECTED", "SSH websocket failed before the host key decision"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("message", onMessage);
        socket.off("close", onClose);
        socket.off("error", onError);
      };
      socket.on("message", onMessage);
      socket.once("close", onClose);
      socket.once("error", onError);
    });
  }

  private connectClient(config: ConnectConfig, session: SshSession, verification?: HostKeyVerification): Promise<SshClientLike> {
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
        // A host key rejection surfaces from ssh2 as a generic handshake error,
        // so the specific reason recorded by the verifier wins.
        const hostKeyFailure = verification?.failure() ?? null;
        reject(hostKeyFailure ?? (error instanceof Error ? error : new Error(String(error))));
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

  private forwardOut(client: SshClientLike, host: string, port: number): Promise<Duplex> {
    return new Promise((resolve, reject) => {
      client.forwardOut("127.0.0.1", 0, host, port, (error, stream) => {
        if (error || !stream) {
          reject(error ?? new Error("Jump host tunnel was not created"));
          return;
        }
        resolve(stream);
      });
    });
  }

  private openShell(client: SshClientLike, cols: number, rows: number): Promise<SshChannelLike> {
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

  private bindConnectedSession(session: SshSession, payload: NormalizedConnectPayload, channel: SshChannelLike): void {
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
        data: redactError(error, [payload.target.password, payload.target.keyPassphrase, payload.jump?.password ?? "", payload.jump?.keyPassphrase ?? ""]),
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
          const cols = clampInteger(message.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS);
          const rows = clampInteger(message.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS);
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
      return new URL(request.url ?? "/", "http://127.0.0.1").pathname.endsWith("/ssh");
    } catch {
      return false;
    }
  }
}
