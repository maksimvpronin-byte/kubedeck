import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

import type { ResourceSnapshotCache } from "../cache/resourceSnapshotCache";
import {
  buildKubectlCommand,
  type KubectlCommand,
} from "../kubectl/command";
import {
  sanitizeKubectlText,
  truncateKubectlText,
} from "../kubectl/errors";
import type { SpawnProcess } from "../kubectl/runner";
import type { ResourceWatchEventHub } from "./eventHub";

const WATCH_TAIL_LINES = 20;
const WATCH_TAIL_LINE_CHARS = 1000;
const WATCH_STOP_TIMEOUT_MS = 3000;

export type WatchStatus = "running" | "stopping" | "stopped" | "failed";

interface WatchKey {
  clusterId: string;
  resource: string;
  namespace: string;
}

interface WatchSession {
  id: string;
  key: WatchKey;
  commandPreview: string;
  process: ChildProcessWithoutNullStreams;
  startedAt: number;
  updatedAt: number;
  status: WatchStatus;
  stdoutLines: number;
  stderrLines: number;
  cacheEvents: number;
  cacheInvalidations: number;
  exitCode: number | null;
  stoppedByUser: boolean;
  outputTail: string[];
  errorTail: string[];
  closePromise: Promise<void>;
  resolveClose: () => void;
}

export interface WatchView {
  id: string;
  clusterId: string;
  resource: string;
  namespace: string;
  status: WatchStatus;
  pid: number | null;
  startedAt: number;
  updatedAt: number;
  ageSeconds: number;
  stdoutLines: number;
  stderrLines: number;
  cacheEvents: number;
  cacheInvalidations: number;
  exitCode: number | null;
  stoppedByUser: boolean;
  commandPreview: string;
  outputTail: string[];
  errorTail: string[];
}

export interface WatchStartResult extends WatchView {
  alreadyRunning: boolean;
}

export interface WatchManagerStatus {
  enabled: true;
  mode: "cache-invalidation+websocket-events";
  running: number;
  total: number;
  watches: WatchView[];
  note: string;
}

export class WatchStartError extends Error {
  constructor(
    readonly code: "KUBECTL_NOT_FOUND" | "WATCH_START_FAILED",
    message: string,
    readonly rawStderr: string,
    readonly commandPreview: string,
  ) {
    super(message);
  }
}

interface ParsedWatchEvent {
  eventType: string;
  namespace: string;
  name: string;
}

function normalizedKey(key: WatchKey): string {
  return `${key.clusterId}\u0000${key.resource.toLowerCase()}\u0000${key.namespace}`;
}

function normalizeNamespace(namespace: string): string {
  const value = namespace.trim();
  return value || "all";
}

function tailPush(target: string[], line: string): void {
  const sanitized = sanitizeKubectlText(line).slice(0, WATCH_TAIL_LINE_CHARS);
  target.push(sanitized);
  if (target.length > WATCH_TAIL_LINES) {
    target.splice(0, target.length - WATCH_TAIL_LINES);
  }
}

function parseWatchEvent(line: string): ParsedWatchEvent | null {
  const text = line.trim();
  if (!text.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const object = record.object;
    if (!object || typeof object !== "object" || Array.isArray(object)) return null;
    const metadataValue = (object as Record<string, unknown>).metadata;
    const metadata =
      metadataValue && typeof metadataValue === "object" && !Array.isArray(metadataValue)
        ? (metadataValue as Record<string, unknown>)
        : {};
    const namespace =
      typeof metadata.namespace === "string" && metadata.namespace.trim()
        ? metadata.namespace.trim()
        : "_cluster";
    const name = typeof metadata.name === "string" ? metadata.name : "";
    const eventType =
      typeof record.type === "string" && record.type.trim()
        ? record.type.trim()
        : "OBJECT";
    return { eventType, namespace, name };
  } catch {
    return null;
  }
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
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
}

function waitForClose(session: WatchSession, timeoutMs: number): Promise<boolean> {
  if (session.process.exitCode !== null || session.status === "stopped" || session.status === "failed") {
    return Promise.resolve(true);
  }
  return Promise.race([
    session.closePromise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

export class WatchManager {
  private readonly sessions = new Map<string, WatchSession>();
  private readonly runningByKey = new Map<string, string>();
  private closed = false;

  constructor(
    private readonly log: (message: string) => void,
    private readonly cache: ResourceSnapshotCache,
    private readonly eventHub: ResourceWatchEventHub,
    private readonly spawnProcess: SpawnProcess = spawn as SpawnProcess,
    private readonly now: () => number = Date.now,
    private readonly stopTimeoutMs = WATCH_STOP_TIMEOUT_MS,
  ) {}

  async start(
    command: KubectlCommand,
    resource: string,
    namespace = "all",
  ): Promise<WatchStartResult> {
    if (this.closed) {
      throw new WatchStartError(
        "WATCH_START_FAILED",
        "Watch manager is stopped",
        "",
        "",
      );
    }
    const key: WatchKey = {
      clusterId: command.clusterId,
      resource: resource.trim().toLowerCase(),
      namespace: normalizeNamespace(namespace),
    };
    const keyText = normalizedKey(key);
    const existingId = this.runningByKey.get(keyText);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (existing && existing.status === "running") {
        return { ...this.view(existing), alreadyRunning: true };
      }
      this.runningByKey.delete(keyText);
    }

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
      throw new WatchStartError(
        missing ? "KUBECTL_NOT_FOUND" : "WATCH_START_FAILED",
        missing ? `kubectl not found: ${command.kubectlPath}` : "kubectl watch could not be started",
        truncateKubectlText(sanitizeKubectlText(message)),
        built.preview,
      );
    }

    const startedAt = this.now() / 1000;
    let resolveClose!: () => void;
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const session: WatchSession = {
      id: randomUUID(),
      key,
      commandPreview: built.preview,
      process: child,
      startedAt,
      updatedAt: startedAt,
      status: "running",
      stdoutLines: 0,
      stderrLines: 0,
      cacheEvents: 0,
      cacheInvalidations: 0,
      exitCode: null,
      stoppedByUser: false,
      outputTail: [],
      errorTail: [],
      closePromise,
      resolveClose,
    };

    const stdoutReader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const stderrReader = createInterface({ input: child.stderr, crlfDelay: Infinity });
    stdoutReader.on("line", (line) => this.handleStdoutLine(session, line));
    stderrReader.on("line", (line) => {
      session.stderrLines += 1;
      session.updatedAt = this.now() / 1000;
      tailPush(session.errorTail, line);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      session.updatedAt = this.now() / 1000;
      tailPush(session.errorTail, error.message);
      if (session.status !== "stopping" && session.status !== "stopped") {
        session.status = "failed";
      }
      this.runningByKey.delete(keyText);
      resolveClose();
    });
    child.on("close", (code) => {
      session.exitCode = typeof code === "number" ? code : null;
      session.updatedAt = this.now() / 1000;
      if (session.status === "stopping" || session.stoppedByUser) {
        session.status = "stopped";
      } else if (code === 0) {
        session.status = "stopped";
      } else {
        session.status = "failed";
      }
      this.runningByKey.delete(keyText);
      stdoutReader.close();
      stderrReader.close();
      resolveClose();
      this.log(
        `node watch stopped id=${session.id} status=${session.status} exitCode=${String(session.exitCode)}`,
      );
    });
    child.stdin.on("error", () => {
      // stdin is intentionally closed for kubectl watch.
    });
    child.stdin.end();
    this.sessions.set(session.id, session);
    this.runningByKey.set(keyText, session.id);

    try {
      await waitForSpawn(child);
    } catch (error) {
      this.sessions.delete(session.id);
      this.runningByKey.delete(keyText);
      stdoutReader.close();
      stderrReader.close();
      const message = error instanceof Error ? error.message : String(error);
      const missing = (error as NodeJS.ErrnoException)?.code === "ENOENT";
      throw new WatchStartError(
        missing ? "KUBECTL_NOT_FOUND" : "WATCH_START_FAILED",
        missing ? `kubectl not found: ${command.kubectlPath}` : "kubectl watch could not be started",
        truncateKubectlText(sanitizeKubectlText(message)),
        built.preview,
      );
    }

    this.log(`node watch started id=${session.id} preview=${built.preview}`);
    return { ...this.view(session), alreadyRunning: false };
  }

  private handleStdoutLine(session: WatchSession, line: string): void {
    session.stdoutLines += 1;
    session.updatedAt = this.now() / 1000;
    tailPush(session.outputTail, line);
    const parsed = parseWatchEvent(line);
    if (!parsed) return;

    session.cacheEvents += 1;
    const cleared = this.cache.clearResource(
      session.key.clusterId,
      session.key.resource,
      parsed.namespace,
      "watch.event",
    );
    session.cacheInvalidations += cleared;
    this.eventHub.publish({
      type: "resource.changed",
      clusterId: session.key.clusterId,
      watchId: session.id,
      resource: session.key.resource,
      namespace: parsed.namespace,
      name: parsed.name,
      eventType: parsed.eventType,
      cacheInvalidations: cleared,
    });
  }

  status(): WatchManagerStatus {
    const watches = [...this.sessions.values()]
      .map((session) => this.view(session))
      .sort((a, b) => b.startedAt - a.startedAt);
    return {
      enabled: true,
      mode: "cache-invalidation+websocket-events",
      running: watches.filter((watch) => watch.status === "running").length,
      total: watches.length,
      watches,
      note:
        "Running watches parse kubectl watch events, invalidate matching Node resource snapshots, and publish WebSocket events. HTTP polling remains the fallback.",
    };
  }

  activeCount(): number {
    return [...this.sessions.values()].filter(
      (session) => session.status === "running" || session.status === "stopping",
    ).length;
  }

  async stop(id: string, stoppedByUser = true): Promise<{
    ok: boolean;
    found: boolean;
    id: string;
    watch?: WatchView;
  }> {
    const session = this.sessions.get(id);
    if (!session) return { ok: false, found: false, id };
    await this.stopSession(session, stoppedByUser);
    return { ok: true, found: true, id, watch: this.view(session) };
  }

  async stopCluster(clusterId: string): Promise<number> {
    const sessions = [...this.sessions.values()].filter(
      (session) =>
        session.key.clusterId === clusterId &&
        (session.status === "running" || session.status === "stopping"),
    );
    await Promise.all(sessions.map((session) => this.stopSession(session, false)));
    return sessions.length;
  }

  async stopAll(stoppedByUser = true): Promise<{
    ok: true;
    stopped: number;
    watches: WatchView[];
  }> {
    const sessions = [...this.sessions.values()].filter(
      (session) => session.status === "running" || session.status === "stopping",
    );
    await Promise.all(sessions.map((session) => this.stopSession(session, stoppedByUser)));
    return {
      ok: true,
      stopped: sessions.length,
      watches: sessions.map((session) => this.view(session)),
    };
  }

  private async stopSession(session: WatchSession, stoppedByUser: boolean): Promise<void> {
    if (session.status === "stopped" || session.status === "failed") return;
    session.stoppedByUser = session.stoppedByUser || stoppedByUser;
    session.status = "stopping";
    session.updatedAt = this.now() / 1000;
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
      session.updatedAt = this.now() / 1000;
    }
    this.runningByKey.delete(normalizedKey(session.key));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.stopAll(false);
  }

  private view(session: WatchSession): WatchView {
    const now = this.now() / 1000;
    return {
      id: session.id,
      clusterId: session.key.clusterId,
      resource: session.key.resource,
      namespace: session.key.namespace,
      status: session.status,
      pid: typeof session.process.pid === "number" ? session.process.pid : null,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      ageSeconds: Math.max(0, now - session.startedAt),
      stdoutLines: session.stdoutLines,
      stderrLines: session.stderrLines,
      cacheEvents: session.cacheEvents,
      cacheInvalidations: session.cacheInvalidations,
      exitCode: session.exitCode,
      stoppedByUser: session.stoppedByUser,
      commandPreview: session.commandPreview,
      outputTail: [...session.outputTail],
      errorTail: [...session.errorTail],
    };
  }
}
