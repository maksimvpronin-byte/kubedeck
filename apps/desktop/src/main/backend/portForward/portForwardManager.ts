import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";

import {
  buildKubectlCommand,
  type KubectlCommand,
} from "../kubectl/command";
import {
  sanitizeKubectlText,
  truncateKubectlText,
} from "../kubectl/errors";
import type { SpawnProcess } from "../kubectl/runner";

const OUTPUT_TAIL_LINES = 40;
const OUTPUT_TAIL_LINE_CHARS = 1000;
const OUTPUT_TEXT_CHARS = 32 * 1024;
const DEFAULT_STOP_TIMEOUT_MS = 3000;
const DEFAULT_READINESS_TIMEOUT_MS = 5000;
const AUTO_PORT_MIN = 62000;
const AUTO_PORT_MAX = 65535;
const AUTO_PORT_ATTEMPTS = 240;

const READY_MARKERS = [
  "Forwarding from 127.0.0.1:",
  "Forwarding from [::1]:",
  "Forwarding from localhost:",
  "Handling connection for",
];

const ERROR_MARKERS = [
  "unable to listen",
  "address already in use",
  "error forwarding",
  "lost connection to pod",
  "pod is not running",
  "not found",
  "connection refused",
];

export type PortForwardStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export interface PortForwardStartInput {
  resource: "pod" | "service" | "deployment";
  namespace: string;
  name: string;
  localPort: number;
  remotePort: number;
}

interface PortForwardSession {
  id: string;
  key: string;
  clusterId: string;
  namespace: string;
  resource: PortForwardStartInput["resource"];
  name: string;
  requestedLocalPort: number;
  localPort: number;
  remotePort: number;
  status: PortForwardStatus;
  process: ChildProcessWithoutNullStreams;
  commandPreview: string;
  startedAt: string;
  updatedAt: string;
  outputTail: string[];
  errorTail: string[];
  outputText: string;
  exitCode: number | null;
  stoppedByUser: boolean;
  closePromise: Promise<void>;
  resolveClose: () => void;
}

export interface PortForwardView {
  id: string;
  clusterId: string;
  namespace: string;
  resource: string;
  name: string;
  localPort: number;
  remotePort: number;
  status: PortForwardStatus;
  pid: number;
  startedAt: string;
  commandPreview: string;
  url: string;
  source: "kubedeck";
  stoppable: true;
  outputTail: string[];
  errorTail: string[];
  exitCode: number | null;
  stoppedByUser: boolean;
}

export interface PortForwardStartResult extends PortForwardView {
  alreadyRunning: boolean;
}

export class PortForwardError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly rawStderr = "",
    readonly commandPreview = "",
  ) {
    super(message);
  }
}

export type PortProbe = (port: number) => Promise<boolean>;

export interface PortForwardManagerOptions {
  spawnProcess?: SpawnProcess;
  portProbe?: PortProbe;
  now?: () => number;
  random?: () => number;
  stopTimeoutMs?: number;
  readinessTimeoutMs?: number;
}

function sessionKey(clusterId: string, input: PortForwardStartInput): string {
  return [
    clusterId,
    input.namespace,
    input.resource,
    input.name,
    input.localPort === 0 ? "auto" : String(input.localPort),
    String(input.remotePort),
  ].join("\u0000");
}

function tailPush(target: string[], text: string): void {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    target.push(sanitizeKubectlText(line).slice(0, OUTPUT_TAIL_LINE_CHARS));
  }
  if (target.length > OUTPUT_TAIL_LINES) {
    target.splice(0, target.length - OUTPUT_TAIL_LINES);
  }
}

function compactOutput(value: string): string {
  const sanitized = sanitizeKubectlText(value);
  return sanitized.length > OUTPUT_TEXT_CHARS
    ? sanitized.slice(sanitized.length - OUTPUT_TEXT_CHARS)
    : sanitized;
}

function containsMarker(value: string, markers: readonly string[]): boolean {
  const lowered = value.toLowerCase();
  return markers.some((marker) => lowered.includes(marker.toLowerCase()));
}

export function canBindLocalPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      server.removeAllListeners();
      resolve(available);
    };
    server.unref();
    server.once("error", () => finish(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => finish(true));
    });
  });
}

function waitForClose(
  session: PortForwardSession,
  timeoutMs: number,
): Promise<boolean> {
  if (
    session.process.exitCode !== null ||
    session.status === "stopped" ||
    session.status === "failed"
  ) {
    return Promise.resolve(true);
  }
  return Promise.race([
    session.closePromise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

export class PortForwardManager {
  private readonly sessions = new Map<string, PortForwardSession>();
  private readonly runningByKey = new Map<string, string>();
  private readonly pendingStarts = new Map<
    string,
    Promise<PortForwardStartResult>
  >();
  private closed = false;
  private readonly spawnProcess: SpawnProcess;
  private readonly portProbe: PortProbe;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly stopTimeoutMs: number;
  private readonly readinessTimeoutMs: number;

  constructor(
    private readonly log: (message: string) => void,
    options: PortForwardManagerOptions = {},
  ) {
    this.spawnProcess = options.spawnProcess ?? (spawn as SpawnProcess);
    this.portProbe = options.portProbe ?? canBindLocalPort;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    this.readinessTimeoutMs =
      options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  }

  list(): PortForwardView[] {
    return [...this.sessions.values()]
      .filter((session) =>
        ["starting", "running", "stopping"].includes(session.status),
      )
      .map((session) => this.view(session))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  get(id: string): PortForwardView | null {
    const session = this.sessions.get(id);
    return session ? this.view(session) : null;
  }

  activeCount(): number {
    return this.list().length;
  }

  async start(
    commandFactory: (localPort: number) => KubectlCommand,
    clusterId: string,
    input: PortForwardStartInput,
  ): Promise<PortForwardStartResult> {
    if (this.closed) {
      throw new PortForwardError(
        503,
        "PORT_FORWARD_MANAGER_STOPPED",
        "Port-forward manager is stopped",
      );
    }

    const key = sessionKey(clusterId, input);
    const pending = this.pendingStarts.get(key);
    if (pending) {
      const result = await pending;
      return { ...result, alreadyRunning: true };
    }

    const operation = this.startInternal(commandFactory, clusterId, input);
    this.pendingStarts.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.pendingStarts.get(key) === operation) {
        this.pendingStarts.delete(key);
      }
    }
  }

  private async startInternal(
    commandFactory: (localPort: number) => KubectlCommand,
    clusterId: string,
    input: PortForwardStartInput,
  ): Promise<PortForwardStartResult> {
    if (this.closed) {
      throw new PortForwardError(
        503,
        "PORT_FORWARD_MANAGER_STOPPED",
        "Port-forward manager is stopped",
      );
    }

    const key = sessionKey(clusterId, input);
    const existingId = this.runningByKey.get(key);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (
        existing &&
        ["starting", "running", "stopping"].includes(existing.status)
      ) {
        return { ...this.view(existing), alreadyRunning: true };
      }
      this.runningByKey.delete(key);
    }

    const localPort = await this.resolveLocalPort(input.localPort);
    if (this.closed) {
      throw new PortForwardError(
        503,
        "PORT_FORWARD_MANAGER_STOPPED",
        "Port-forward manager is stopped",
      );
    }
    const command = commandFactory(localPort);
    const built = buildKubectlCommand(command);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess(built.executable, built.args, {
        shell: false,
        windowsHide: true,
        env: built.environment,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missing = (error as NodeJS.ErrnoException)?.code === "ENOENT";
      throw new PortForwardError(
        502,
        missing ? "KUBECTL_NOT_FOUND" : "PORT_FORWARD_FAILED",
        missing
          ? `kubectl not found: ${command.kubectlPath}`
          : "kubectl port-forward could not be started",
        truncateKubectlText(sanitizeKubectlText(message)),
        built.preview,
      );
    }

    const startedAt = new Date(this.now()).toISOString();
    let resolveClose!: () => void;
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const session: PortForwardSession = {
      id: randomUUID(),
      key,
      clusterId,
      namespace: input.namespace,
      resource: input.resource,
      name: input.name,
      requestedLocalPort: input.localPort,
      localPort,
      remotePort: input.remotePort,
      status: "starting",
      process: child,
      commandPreview: built.preview,
      startedAt,
      updatedAt: startedAt,
      outputTail: [],
      errorTail: [],
      outputText: "",
      exitCode: null,
      stoppedByUser: false,
      closePromise,
      resolveClose,
    };
    this.sessions.set(session.id, session);
    this.runningByKey.set(key, session.id);

    let readySettled = false;
    let resolveReady!: () => void;
    let rejectReady!: (error: PortForwardError) => void;
    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    let readinessTimer: NodeJS.Timeout | undefined;

    const finishReady = () => {
      if (readySettled) return;
      readySettled = true;
      if (readinessTimer) clearTimeout(readinessTimer);
      resolveReady();
    };
    const failReady = (
      message: string,
      raw = session.outputText,
      code = "PORT_FORWARD_FAILED",
    ) => {
      if (readySettled) return;
      readySettled = true;
      if (readinessTimer) clearTimeout(readinessTimer);
      rejectReady(
        new PortForwardError(
          502,
          code,
          message,
          truncateKubectlText(compactOutput(raw)),
          built.preview,
        ),
      );
    };
    const inspectReadiness = () => {
      if (containsMarker(session.outputText, READY_MARKERS)) {
        finishReady();
        return;
      }
      if (containsMarker(session.outputText, ERROR_MARKERS)) {
        failReady("kubectl port-forward did not become ready");
      }
    };
    const collect = (target: string[], chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      tailPush(target, text);
      session.outputText = compactOutput(`${session.outputText}\n${text}`);
      session.updatedAt = new Date(this.now()).toISOString();
      inspectReadiness();
    };

    child.stdout.on("data", (chunk) => collect(session.outputTail, chunk));
    child.stderr.on("data", (chunk) => collect(session.errorTail, chunk));
    child.stdin.on("error", () => {
      // stdin is intentionally closed for kubectl port-forward.
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      tailPush(session.errorTail, error.message);
      session.outputText = compactOutput(`${session.outputText}\n${error.message}`);
      session.status = "failed";
      session.updatedAt = new Date(this.now()).toISOString();
      failReady(
        error.code === "ENOENT"
          ? `kubectl not found: ${command.kubectlPath}`
          : "kubectl port-forward could not be started",
        error.message,
        error.code === "ENOENT" ? "KUBECTL_NOT_FOUND" : "PORT_FORWARD_FAILED",
      );
      this.runningByKey.delete(key);
      this.sessions.delete(session.id);
      session.resolveClose();
    });
    child.on("close", (code) => {
      session.exitCode = typeof code === "number" ? code : null;
      session.updatedAt = new Date(this.now()).toISOString();
      if (session.status === "stopping" || session.stoppedByUser) {
        session.status = "stopped";
      } else if (session.status !== "failed") {
        session.status = code === 0 ? "stopped" : "failed";
      }
      if (!readySettled) {
        failReady(
          `kubectl port-forward exited before becoming ready${
            typeof code === "number" ? ` (code ${code})` : ""
          }`,
        );
      }
      this.runningByKey.delete(key);
      this.sessions.delete(session.id);
      session.resolveClose();
      this.log(
        `node port-forward stopped id=${session.id} status=${session.status} exitCode=${String(
          session.exitCode,
        )}`,
      );
    });
    child.stdin.end();

    readinessTimer = setTimeout(() => {
      failReady("kubectl port-forward did not become ready");
    }, this.readinessTimeoutMs);

    try {
      await new Promise<void>((resolve, reject) => {
        const onSpawn = () => {
          child.off("error", onError);
          resolve();
        };
        const onError = (error: Error) => {
          child.off("spawn", onSpawn);
          reject(error);
        };
        child.once("spawn", onSpawn);
        child.once("error", onError);
      });
      await readyPromise;
      session.status = "running";
      session.updatedAt = new Date(this.now()).toISOString();
      this.log(`node port-forward started id=${session.id} preview=${built.preview}`);
      return { ...this.view(session), alreadyRunning: false };
    } catch (error) {
      if (readinessTimer) clearTimeout(readinessTimer);
      await this.stopSession(session, false);
      this.sessions.delete(session.id);
      this.runningByKey.delete(key);
      if (error instanceof PortForwardError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const missing = (error as NodeJS.ErrnoException)?.code === "ENOENT";
      throw new PortForwardError(
        502,
        missing ? "KUBECTL_NOT_FOUND" : "PORT_FORWARD_FAILED",
        missing
          ? `kubectl not found: ${command.kubectlPath}`
          : "kubectl port-forward could not be started",
        truncateKubectlText(sanitizeKubectlText(message)),
        built.preview,
      );
    }
  }

  async stop(id: string, stoppedByUser = true): Promise<PortForwardView | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    await this.stopSession(session, stoppedByUser);
    return this.view(session);
  }

  async stopCluster(clusterId: string): Promise<number> {
    const prefix = `${clusterId}\u0000`;
    const pending = [...this.pendingStarts.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, operation]) => operation);
    await Promise.allSettled(pending);
    const sessions = [...this.sessions.values()].filter(
      (session) => session.clusterId === clusterId,
    );
    await Promise.all(sessions.map((session) => this.stopSession(session, false)));
    return sessions.length;
  }

  async stopAll(stoppedByUser = false): Promise<number> {
    const sessions = [...this.sessions.values()];
    await Promise.all(
      sessions.map((session) => this.stopSession(session, stoppedByUser)),
    );
    return sessions.length;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([...this.pendingStarts.values()]);
    await this.stopAll(false);
    this.pendingStarts.clear();
  }

  private async resolveLocalPort(requestedPort: number): Promise<number> {
    if (requestedPort !== 0) {
      if (this.portRegistered(requestedPort) || !(await this.portProbe(requestedPort))) {
        throw new PortForwardError(
          409,
          "LOCAL_PORT_IN_USE",
          `Local port ${requestedPort} is already in use`,
        );
      }
      return requestedPort;
    }

    const range = AUTO_PORT_MAX - AUTO_PORT_MIN + 1;
    const preferred =
      AUTO_PORT_MIN + Math.floor(Math.max(0, Math.min(0.999999, this.random())) * range);
    for (let offset = 0; offset < Math.min(AUTO_PORT_ATTEMPTS, range); offset += 1) {
      const port = AUTO_PORT_MIN + ((preferred - AUTO_PORT_MIN + offset) % range);
      if (this.portRegistered(port)) continue;
      if (await this.portProbe(port)) return port;
    }
    throw new PortForwardError(
      409,
      "LOCAL_PORT_UNAVAILABLE",
      "No free local port was found in the automatic port range",
    );
  }

  private portRegistered(port: number): boolean {
    return [...this.sessions.values()].some(
      (session) =>
        session.localPort === port &&
        ["starting", "running", "stopping"].includes(session.status),
    );
  }

  private async stopSession(
    session: PortForwardSession,
    stoppedByUser: boolean,
  ): Promise<void> {
    if (session.status === "stopped" || session.status === "failed") return;
    session.stoppedByUser = session.stoppedByUser || stoppedByUser;
    session.status = "stopping";
    session.updatedAt = new Date(this.now()).toISOString();
    try {
      if (!session.process.killed) session.process.kill();
    } catch (error) {
      tailPush(
        session.errorTail,
        error instanceof Error ? error.message : String(error),
      );
    }
    const closed = await waitForClose(session, this.stopTimeoutMs);
    if (!closed && session.process.exitCode === null) {
      try {
        session.process.kill("SIGKILL");
      } catch (error) {
        tailPush(
          session.errorTail,
          error instanceof Error ? error.message : String(error),
        );
      }
      await waitForClose(session, 1000);
    }
    if (session.status === "stopping") {
      session.status = "stopped";
      session.updatedAt = new Date(this.now()).toISOString();
    }
    this.runningByKey.delete(session.key);
    this.sessions.delete(session.id);
  }

  private view(session: PortForwardSession): PortForwardView {
    return {
      id: session.id,
      clusterId: session.clusterId,
      namespace: session.namespace,
      resource: session.resource,
      name: session.name,
      localPort: session.localPort,
      remotePort: session.remotePort,
      status: session.status,
      pid: typeof session.process.pid === "number" ? session.process.pid : 0,
      startedAt: session.startedAt,
      commandPreview: session.commandPreview,
      url: `http://127.0.0.1:${session.localPort}`,
      source: "kubedeck",
      stoppable: true,
      outputTail: [...session.outputTail],
      errorTail: [...session.errorTail],
      exitCode: session.exitCode,
      stoppedByUser: session.stoppedByUser,
    };
  }
}
