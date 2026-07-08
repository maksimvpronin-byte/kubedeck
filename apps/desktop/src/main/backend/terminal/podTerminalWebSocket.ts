import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import type { AuditStore } from "../audit/auditStore";
import { writePolicyViolation } from "../auth";
import { ClusterNotFoundError, type ConfigStore } from "../config/configStore";
import { clusterCommand } from "../kubectl/clusterCommand";
import { buildKubectlCommand, type BuiltKubectlCommand } from "../kubectl/command";
import { KubectlError, sanitizeKubectlText, truncateKubectlText } from "../kubectl/errors";
import type { KubectlRunner, SpawnProcess } from "../kubectl/runner";
import { RequestValidationError, validateIdentifier } from "../validation";

const MAX_CLIENT_MESSAGE_BYTES = 256 * 1024;
const AUTH_TIMEOUT_SECONDS = 15;
const AUTH_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_ROWS = 24;
const DEFAULT_COLS = 100;
const MIN_ROWS = 5;
const MAX_ROWS = 200;
const MIN_COLS = 20;
const MAX_COLS = 500;
const STOP_TIMEOUT_MS = 1200;
const ERROR_TEXT_LIMIT = 12_000;
const EXTRA_PTY_PATH_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

type TerminalShell = "auto" | "sh" | "bash" | "ash";
type TerminalTransport = "pty" | "pipes";

export interface PodTerminalTarget {
  clusterId: string;
  namespace: string;
  name: string;
  container: string;
  shell: TerminalShell;
}

interface PtyExitEvent {
  exitCode: number;
  signal?: number;
}

interface PtyDisposable {
  dispose(): void;
}

interface PtyProcessLike {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): PtyDisposable;
  onExit(listener: (event: PtyExitEvent) => void): PtyDisposable;
}

interface PtySpawnOptions {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

export type TerminalPtyFactory = (
  file: string,
  args: string[],
  options: PtySpawnOptions,
) => PtyProcessLike;

interface TerminalSession {
  id: string;
  target: PodTerminalTarget;
  socket: WebSocket;
  transport: TerminalTransport;
  commandPreview: string;
  stop: (reason: string) => Promise<void>;
}

interface PodTerminalWebSocketOptions {
  spawnProcess?: SpawnProcess;
  ptyFactory?: TerminalPtyFactory | null;
  stopTimeoutMs?: number;
}

interface PtyCommand {
  executable: string;
  args: string[];
  environment: NodeJS.ProcessEnv;
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

function normalizeShell(value: string): TerminalShell {
  const shell = (value || "auto").trim().toLowerCase();
  if (!["auto", "sh", "bash", "ash"].includes(shell)) {
    throw new RequestValidationError(
      400,
      "INVALID_SHELL",
      "Shell must be auto, sh, bash, or ash",
    );
  }
  return shell as TerminalShell;
}

export function matchPodTerminalWebSocket(
  request: IncomingMessage,
): PodTerminalTarget | null {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const match = url.pathname.match(
    /^\/clusters\/([^/]+)\/pods\/([^/]+)\/([^/]+)\/terminal$/,
  );
  if (!match) return null;
  const containerText = url.searchParams.get("container")?.trim() ?? "";
  return {
    clusterId: validateIdentifier(
      decodePart(match[1], "cluster_id"),
      "cluster_id",
      128,
    ),
    namespace: validateIdentifier(
      decodePart(match[2], "namespace"),
      "namespace",
    ),
    name: validateIdentifier(decodePart(match[3], "name"), "name"),
    container: containerText
      ? validateIdentifier(containerText, "container", 253)
      : "",
    shell: normalizeShell(url.searchParams.get("shell") ?? "auto"),
  };
}

export function terminalShellCommand(shell: TerminalShell): string {
  const prefix = "TERM=xterm-256color; export TERM; clear; ";
  if (shell === "auto") {
    return (
      prefix +
      "if command -v bash >/dev/null 2>&1; then exec bash -i; " +
      "elif command -v sh >/dev/null 2>&1; then exec sh -i; " +
      "elif command -v ash >/dev/null 2>&1; then exec ash -i; " +
      "else echo 'KubeDeck: no supported shell found. Try sh, bash, or ash.' >&2; exit 127; fi"
    );
  }
  return (
    prefix +
    `if command -v ${shell} >/dev/null 2>&1; then exec ${shell} -i; ` +
    `else echo 'KubeDeck: selected shell ${shell} was not found in this container. Try Auto or another shell.' >&2; exit 127; fi`
  );
}

function terminalCommand(
  configStore: ConfigStore,
  target: PodTerminalTarget,
  useTty: boolean,
) {
  const args = ["exec", "-i"];
  if (useTty) args.push("-t");
  args.push(target.name, "-n", target.namespace);
  if (target.container) args.push("-c", target.container);
  args.push("--", "sh", "-c", terminalShellCommand(target.shell));
  return clusterCommand(configStore, target.clusterId, args, 0, 0);
}

function rawDataByteLength(data: RawData): number {
  if (typeof data === "string") return Buffer.byteLength(data, "utf8");
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) {
    return data.reduce((total, item) => total + item.length, 0);
  }
  return data.byteLength;
}

function rawDataText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
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

function processEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function ptyPath(environment: NodeJS.ProcessEnv): string {
  const existing = environment.PATH ?? environment.Path ?? process.env.PATH ?? "";
  const values: string[] = [];
  const seen = new Set<string>();
  for (const value of [...existing.split(path.delimiter), ...EXTRA_PTY_PATH_DIRS]) {
    const item = value.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    values.push(item);
  }
  return values.join(path.delimiter);
}

function buildPtyCommand(built: BuiltKubectlCommand): PtyCommand {
  const environment = {
    ...built.environment,
    PATH: ptyPath(built.environment),
  };
  if (process.platform === "win32") {
    if (hasPathSeparator(built.executable)) {
      return {
        executable: built.executable,
        args: built.args,
        environment,
      };
    }
    return {
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", built.executable, ...built.args],
      environment,
    };
  }

  const shellPath = "/bin/sh";
  try {
    fs.accessSync(shellPath, fs.constants.X_OK);
  } catch {
    return {
      executable: built.executable,
      args: built.args,
      environment,
    };
  }

  return {
    executable: shellPath,
    args: ["-lc", "exec \"$@\"", "kubedeck-pty", built.executable, ...built.args],
    environment,
  };
}

function loadNodePty(log: (message: string) => void): TerminalPtyFactory | null {
  try {
    // node-pty is loaded at runtime because it is a native Electron dependency.
    const module = require("node-pty") as {
      spawn?: TerminalPtyFactory;
    };
    if (typeof module.spawn === "function") return module.spawn.bind(module);
    log("node terminal pty unavailable: node-pty does not export spawn");
  } catch (error) {
    log(
      `node terminal pty unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return null;
}

function safeSend(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // Closing a terminal socket is best-effort and must not crash Gateway.
  }
}

function terminalErrorText(error: unknown): string {
  if (error instanceof KubectlError) {
    return error.info.rawStderr || error.info.message;
  }
  if (error instanceof ClusterNotFoundError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

async function verifyTerminalAuthorization(
  configStore: ConfigStore,
  runner: KubectlRunner,
  target: PodTerminalTarget,
): Promise<string> {
  const command = clusterCommand(
    configStore,
    target.clusterId,
    ["auth", "can-i", "create", "pods/exec", "-n", target.namespace],
    AUTH_TIMEOUT_SECONDS,
    AUTH_MAX_OUTPUT_BYTES,
  );
  const result = await runner.run(command);
  const output = result.stdout.trim().toLowerCase();
  if (!new Set(["yes", "y"]).has(output)) {
    throw new RequestValidationError(
      403,
      "KUBECTL_AUTH_DENIED",
      `kubectl auth can-i create pods/exec returned ${output || "no"}`,
    );
  }
  return result.commandPreview;
}

function waitForChildClose(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export class PodTerminalWebSocketServer {
  private readonly server = new WebSocketServer({
    noServer: true,
    clientTracking: true,
    maxPayload: MAX_CLIENT_MESSAGE_BYTES,
  });
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly spawnProcess: SpawnProcess;
  private readonly ptyFactory: TerminalPtyFactory | null;
  private readonly stopTimeoutMs: number;
  private closed = false;

  constructor(
    private readonly configStore: ConfigStore,
    private readonly auditStore: AuditStore,
    private readonly runner: KubectlRunner,
    private readonly log: (message: string) => void,
    options: PodTerminalWebSocketOptions = {},
  ) {
    this.spawnProcess = options.spawnProcess ?? (spawn as SpawnProcess);
    this.ptyFactory =
      options.ptyFactory === undefined
        ? loadNodePty(log)
        : options.ptyFactory;
    this.stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  }

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    let target: PodTerminalTarget | null;
    try {
      target = matchPodTerminalWebSocket(request);
    } catch (error) {
      if (this.isTerminalPath(request)) {
        writePolicyViolation(
          request,
          socket,
          error instanceof Error ? error.message : "Invalid terminal route",
        );
        return true;
      }
      return false;
    }
    if (!target) return false;
    if (this.closed) {
      writePolicyViolation(request, socket, "Terminal service is shutting down");
      return true;
    }
    this.server.handleUpgrade(request, socket, head, (websocket) => {
      void this.open(websocket, target as PodTerminalTarget);
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
      sessions.map((session) => session.stop("Cluster was removed")),
    );
    return sessions.length;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const sessions = [...this.sessions.values()];
    await Promise.all(
      sessions.map((session) => session.stop("KubeDeck is shutting down")),
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

  private async open(socket: WebSocket, target: PodTerminalTarget): Promise<void> {
    safeSend(socket, { type: "status", data: "authorizing" });
    try {
      await verifyTerminalAuthorization(this.configStore, this.runner, target);
    } catch (error) {
      safeSend(socket, {
        type: "error",
        data:
          error instanceof RequestValidationError
            ? error.message
            : terminalErrorText(error),
      });
      socket.close(1008, "Terminal authorization failed");
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) return;

    const id = randomUUID();
    if (!this.ptyFactory) {
      const message = "Interactive pod terminal requires node-pty, but the native PTY module is unavailable in this build.";
      this.log(`node terminal refused: ${message}`);
      safeSend(socket, {
        type: "error",
        data: message,
      });
      socket.close(1011, "Terminal PTY unavailable");
      return;
    }

    let session: TerminalSession;
    try {
      session = this.startPtySession(id, socket, target);
    } catch (error) {
      this.log(
        `node terminal pty start failed: ${terminalErrorText(error)}`,
      );
      safeSend(socket, {
        type: "error",
        data: truncateKubectlText(
          sanitizeKubectlText(terminalErrorText(error)),
          ERROR_TEXT_LIMIT,
        ),
      });
      socket.close(1011, "Terminal PTY failed");
      return;
    }

    this.sessions.set(id, session);
    this.auditStore.append({
      action: "pod.terminal",
      status: "opened",
      clusterId: target.clusterId,
      namespace: target.namespace,
      resource: "pods",
      name: target.name,
      commandPreview: session.commandPreview,
      extra: {
        container: target.container,
        shell: target.shell,
        transport: session.transport,
      },
    });
    this.log(
      `node terminal opened cluster=${target.clusterId} namespace=${target.namespace} pod=${target.name} transport=${session.transport}`,
    );
    safeSend(socket, {
      type: "status",
      data: "connected",
      commandPreview: session.commandPreview,
      transport: session.transport,
    });
  }

  private startPtySession(
    id: string,
    socket: WebSocket,
    target: PodTerminalTarget,
  ): TerminalSession {
    const command = terminalCommand(this.configStore, target, true);
    const built = buildKubectlCommand(command);
    const ptyCommand = buildPtyCommand(built);
    const pty = (this.ptyFactory as TerminalPtyFactory)(
      ptyCommand.executable,
      ptyCommand.args,
      {
        name: "xterm-256color",
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        cwd: process.cwd(),
        env: processEnvironment(ptyCommand.environment),
      },
    );
    let finished = false;
    let stopping: Promise<void> | null = null;
    const dataSubscription = pty.onData((data) => {
      safeSend(socket, { type: "output", stream: "pty", data });
    });
    const exitSubscription = pty.onExit(({ exitCode }) => {
      void finish(`Terminal process exited with code ${exitCode}`, false);
    });

    const finish = async (reason: string, terminate: boolean): Promise<void> => {
      if (stopping) return stopping;
      stopping = (async () => {
        if (finished) return;
        finished = true;
        dataSubscription.dispose();
        exitSubscription.dispose();
        if (terminate) {
          try {
            pty.kill();
          } catch {
            // Best effort only.
          }
        }
        this.completeSession(id, target, built, "pty", reason, socket);
      })();
      return stopping;
    };

    socket.on("message", (data) => {
      if (rawDataByteLength(data) > MAX_CLIENT_MESSAGE_BYTES) {
        socket.close(1009, "Message too large");
        return;
      }
      this.handleClientMessage(socket, rawDataText(data), {
        input: (value) => pty.write(value),
        resize: (cols, rows) => pty.resize(cols, rows),
        close: () => void finish("Closed by user", true),
      });
    });
    socket.once("close", () => void finish("WebSocket closed", true));
    socket.once("error", (error) => {
      this.log(`node terminal websocket error: ${error.message}`);
      void finish("WebSocket error", true);
    });

    return {
      id,
      target,
      socket,
      transport: "pty",
      commandPreview: built.preview,
      stop: (reason) => finish(reason, true),
    };
  }

  private startPipeSession(
    id: string,
    socket: WebSocket,
    target: PodTerminalTarget,
  ): TerminalSession {
    const command = terminalCommand(this.configStore, target, false);
    const built = buildKubectlCommand(command);
    const child = this.spawnPipeProcess(built);
    let finished = false;
    let stopping: Promise<void> | null = null;

    const finish = async (reason: string, terminate: boolean): Promise<void> => {
      if (stopping) return stopping;
      stopping = (async () => {
        if (finished) return;
        finished = true;
        if (terminate && child.exitCode === null && !child.killed) {
          try {
            child.kill("SIGTERM");
          } catch {
            // Best effort only.
          }
          const closed = waitForChildClose(child, this.stopTimeoutMs);
          await closed;
          if (child.exitCode === null) {
            try {
              child.kill("SIGKILL");
            } catch {
              // Best effort only.
            }
          }
        }
        this.completeSession(id, target, built, "pipes", reason, socket);
      })();
      return stopping;
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      safeSend(socket, {
        type: "output",
        stream: "stdout",
        data: Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk),
      });
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      safeSend(socket, {
        type: "output",
        stream: "stderr",
        data: Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk),
      });
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      safeSend(socket, {
        type: "error",
        data:
          error.code === "ENOENT"
            ? `kubectl not found: ${command.kubectlPath}`
            : truncateKubectlText(
                sanitizeKubectlText(error.message),
                ERROR_TEXT_LIMIT,
              ),
      });
      void finish("Terminal process error", false);
    });
    child.on("close", (code) => {
      void finish(`Terminal process exited with code ${code ?? -1}`, false);
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") {
        safeSend(socket, {
          type: "error",
          data: truncateKubectlText(
            sanitizeKubectlText(error.message),
            ERROR_TEXT_LIMIT,
          ),
        });
      }
    });

    socket.on("message", (data) => {
      if (rawDataByteLength(data) > MAX_CLIENT_MESSAGE_BYTES) {
        socket.close(1009, "Message too large");
        return;
      }
      this.handleClientMessage(socket, rawDataText(data), {
        input: (value) => {
          if (!child.stdin.destroyed && child.stdin.writable) {
            child.stdin.write(value, "utf8");
          }
        },
        resize: () => undefined,
        close: () => void finish("Closed by user", true),
      });
    });
    socket.once("close", () => void finish("WebSocket closed", true));
    socket.once("error", (error) => {
      this.log(`node terminal websocket error: ${error.message}`);
      void finish("WebSocket error", true);
    });

    return {
      id,
      target,
      socket,
      transport: "pipes",
      commandPreview: built.preview,
      stop: (reason) => finish(reason, true),
    };
  }

  private spawnPipeProcess(
    built: BuiltKubectlCommand,
  ): ChildProcessWithoutNullStreams {
    return this.spawnProcess(built.executable, built.args, {
      shell: false,
      windowsHide: true,
      env: built.environment,
    });
  }

  private handleClientMessage(
    socket: WebSocket,
    text: string,
    handlers: {
      input: (data: string) => void;
      resize: (cols: number, rows: number) => void;
      close: () => void;
    },
  ): void {
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Terminal message must be an object");
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      safeSend(socket, { type: "error", data: "Invalid terminal message" });
      return;
    }
    const type = typeof payload.type === "string" ? payload.type : "";
    if (type === "input") {
      handlers.input(typeof payload.data === "string" ? payload.data : "");
      return;
    }
    if (type === "resize") {
      handlers.resize(
        clampInteger(payload.cols, DEFAULT_COLS, MIN_COLS, MAX_COLS),
        clampInteger(payload.rows, DEFAULT_ROWS, MIN_ROWS, MAX_ROWS),
      );
      return;
    }
    if (type === "close") {
      handlers.close();
      return;
    }
    safeSend(socket, { type: "error", data: "Unsupported terminal message" });
  }

  private completeSession(
    id: string,
    target: PodTerminalTarget,
    built: BuiltKubectlCommand,
    transport: TerminalTransport,
    reason: string,
    socket: WebSocket,
  ): void {
    const existed = this.sessions.delete(id);
    if (!existed) return;
    this.auditStore.append({
      action: "pod.terminal",
      status: "closed",
      clusterId: target.clusterId,
      namespace: target.namespace,
      resource: "pods",
      name: target.name,
      commandPreview: built.preview,
      message: reason,
      extra: {
        container: target.container,
        shell: target.shell,
        transport,
      },
    });
    safeSend(socket, { type: "status", data: "closed" });
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.close(1000, "Terminal closed");
      } catch {
        socket.terminate();
      }
    }
    this.log(
      `node terminal closed cluster=${target.clusterId} namespace=${target.namespace} pod=${target.name} transport=${transport}`,
    );
  }

  private isTerminalPath(request: IncomingMessage): boolean {
    try {
      return new URL(request.url ?? "/", "http://127.0.0.1").pathname.endsWith(
        "/terminal",
      );
    } catch {
      return false;
    }
  }
}
