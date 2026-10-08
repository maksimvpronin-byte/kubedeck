import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

import type { ResourceSnapshotCache } from "../cache/resourceSnapshotCache";
import { buildKubectlCommand, type KubectlCommand } from "../kubectl/command";
import { sanitizeKubectlText, truncateKubectlText } from "../kubectl/errors";
import type { SpawnProcess } from "../kubectl/runner";
import type { KubectlError } from "../kubectl/errors";
import type { ApiInformer, InformerCallbacks } from "./apiInformer";
import type { ResourceWatchEventHub } from "./eventHub";

const WATCH_TAIL_LINES = 20;
const WATCH_TAIL_LINE_CHARS = 1000;
const WATCH_STOP_TIMEOUT_MS = 3000;
const WATCH_TERMINAL_RETENTION_SECONDS = 5 * 60;
// An API watch nobody has listened to for this long is stopped: it holds the
// whole list in memory, and the table that wanted it is gone.
const API_WATCH_IDLE_MS = 5 * 60_000;
const API_WATCH_SWEEP_MS = 60_000;
// After a change made from KubeDeck, how long the lists of that cluster are
// read from the API server instead of memory if no watch event arrives: the
// table reloads right after the change, often before its event does.
const MUTATION_SETTLE_MS = 3000;
// A scope whose API watch could not be started or was refused is not tried
// again from a table load for this long; its lists go to the API server.
const API_WATCH_RETRY_AFTER_MS = 2 * 60_000;

// Where a watch can be kept over the cluster's own API connection instead of
// a kubectl process.
export interface ApiWatchSource {
  // A started informer for the scope, or null when kubectl has to watch it.
  informerFor(command: KubectlCommand, resource: string, namespace: string, callbacks: InformerCallbacks): Promise<ApiInformer | null>;
}

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
  // Exactly one of these: a kubectl watch process, or an API informer.
  process: ChildProcessWithoutNullStreams | null;
  informer: ApiInformer | null;
  // When a subscriber or a list last wanted this watch (API watches only).
  lastWantedAt: number;
  // When KubeDeck changed something on this cluster and no event has
  // arrived since (API watches only).
  mutatedAt: number | null;
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

// Every event is parsed in full for three fields. A cheap textual pre-filter
// was considered and rejected: "name" and "namespace" appear in every object a
// watch emits, so it would skip nothing while making the parse depend on the
// text form of the JSON. The alternative of watching in table form was rejected
// too - it cannot tell added from modified from deleted, which is what the
// subscribers are told.
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
    const metadata = metadataValue && typeof metadataValue === "object" && !Array.isArray(metadataValue) ? (metadataValue as Record<string, unknown>) : {};
    const namespace = typeof metadata.namespace === "string" && metadata.namespace.trim() ? metadata.namespace.trim() : "_cluster";
    const name = typeof metadata.name === "string" ? metadata.name : "";
    const eventType = typeof record.type === "string" && record.type.trim() ? record.type.trim() : "OBJECT";
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
  if (!session.process || session.process.exitCode !== null || session.status === "stopped" || session.status === "failed") {
    return Promise.resolve(true);
  }
  return Promise.race([session.closePromise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs))]);
}

export class WatchManager {
  private readonly sessions = new Map<string, WatchSession>();
  private readonly runningByKey = new Map<string, string>();
  // API watches still listing, so a second start for the same scope waits
  // for the first instead of listing twice.
  private readonly startingByKey = new Map<string, Promise<WatchStartResult | null>>();
  private closed = false;
  private sweepTimer: NodeJS.Timeout | undefined;
  // Scopes whose API watch failed, and when.
  private readonly apiWatchFailedAt = new Map<string, number>();

  constructor(
    private readonly log: (message: string) => void,
    private readonly cache: ResourceSnapshotCache,
    private readonly eventHub: ResourceWatchEventHub,
    private readonly spawnProcess: SpawnProcess = spawn as SpawnProcess,
    private readonly now: () => number = Date.now,
    private readonly stopTimeoutMs = WATCH_STOP_TIMEOUT_MS,
    private readonly apiWatch: ApiWatchSource | null = null,
  ) {
    if (apiWatch) {
      this.sweepTimer = setInterval(() => this.sweepIdleApiWatches(), API_WATCH_SWEEP_MS);
      this.sweepTimer.unref?.();
    }
  }

  async start(command: KubectlCommand, resource: string, namespace = "all"): Promise<WatchStartResult> {
    if (this.apiWatch && !this.closed) {
      const keyText = normalizedKey({ clusterId: command.clusterId, resource: resource.trim().toLowerCase(), namespace: normalizeNamespace(namespace) });
      const running = this.sessions.get(this.runningByKey.get(keyText) ?? "");
      if (running?.status === "running") {
        running.lastWantedAt = this.now();
        return { ...this.view(running), alreadyRunning: true };
      }
      let starting = this.startingByKey.get(keyText);
      if (!starting) {
        starting = this.startApiWatch(command, resource, namespace).finally(() => this.startingByKey.delete(keyText));
        this.startingByKey.set(keyText, starting);
      }
      const started = await starting;
      if (started) return started;
    }
    return this.startProcess(command, resource, namespace);
  }

  // The scope watched over the API, or null when kubectl has to watch it. A
  // refusal of the first list is the answer kubectl would give too, so it is
  // reported, not retried through kubectl.
  private async startApiWatch(command: KubectlCommand, resource: string, namespace: string): Promise<WatchStartResult | null> {
    const key: WatchKey = { clusterId: command.clusterId, resource: resource.trim().toLowerCase(), namespace: normalizeNamespace(namespace) };
    const startedAt = this.now() / 1000;
    let resolveClose!: () => void;
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const session: WatchSession = {
      id: randomUUID(),
      key,
      commandPreview: "",
      process: null,
      informer: null,
      lastWantedAt: this.now(),
      mutatedAt: null,
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
    const publishChange = (namespaceOfObject: string, name: string, eventType: string) => {
      session.mutatedAt = null;
      session.cacheEvents += 1;
      session.updatedAt = this.now() / 1000;
      const cleared = this.cache.clearResource(key.clusterId, key.resource, namespaceOfObject, "watch.event");
      session.cacheInvalidations += cleared;
      this.eventHub.publish({
        type: "resource.changed",
        clusterId: key.clusterId,
        watchId: session.id,
        resource: key.resource,
        namespace: namespaceOfObject,
        name,
        eventType,
        cacheInvalidations: cleared,
      });
    };
    const callbacks: InformerCallbacks = {
      changed: (change) => publishChange(change.namespace, change.name, change.eventType),
      // Changes made while the copy was being rebuilt are in the new list; the
      // table is told to reload once.
      resynced: () => publishChange(key.namespace === "all" ? "_cluster" : key.namespace, "", "RESYNC"),
      failed: (error: KubectlError) => {
        if (session.status !== "running") return;
        this.apiWatchFailedAt.set(normalizedKey(key), this.now());
        session.status = "failed";
        session.updatedAt = this.now() / 1000;
        tailPush(session.errorTail, error.info.rawStderr || error.message);
        this.forgetRunning(session);
        resolveClose();
        if (this.closed) return;
        this.eventHub.publish({ type: "watch.ended", clusterId: key.clusterId, watchId: session.id, resource: key.resource, namespace: key.namespace, status: "failed", exitCode: null });
      },
    };

    let informer: ApiInformer | null;
    try {
      informer = await (this.apiWatch as ApiWatchSource).informerFor(command, key.resource, key.namespace, callbacks);
    } catch (error) {
      const info = (error as { info?: { code?: string; message?: string; rawStderr?: string; commandPreview?: string } }).info;
      throw new WatchStartError(
        "WATCH_START_FAILED",
        info?.message ?? "watch could not be started",
        info?.rawStderr ?? (error instanceof Error ? error.message : String(error)),
        info?.commandPreview ?? "",
      );
    }
    if (!informer) return null;
    if (this.closed) {
      informer.stop();
      return null;
    }
    session.informer = informer;
    session.commandPreview = informer.preview;
    this.sessions.set(session.id, session);
    this.runningByKey.set(normalizedKey(key), session.id);
    this.log(`node watch started id=${session.id} api objects=${informer.size} preview=${informer.preview}`);
    return { ...this.view(session), alreadyRunning: false };
  }

  // The watched list of this scope as `kubectl get -o json` gives it, from
  // memory, or null when no synced API watch covers it. An all-namespaces
  // watch covers each namespace too.
  listSnapshot(clusterId: string, resource: string, namespace: string): Record<string, unknown> | null {
    const lookup = (scope: string) => {
      const session = this.sessions.get(this.runningByKey.get(normalizedKey({ clusterId, resource: resource.trim().toLowerCase(), namespace: scope })) ?? "");
      if (session?.status !== "running" || !session.informer?.synced) return null;
      if (session.mutatedAt !== null && this.now() - session.mutatedAt < MUTATION_SETTLE_MS) return null;
      return session;
    };
    const exact = lookup(normalizeNamespace(namespace));
    if (exact?.informer) {
      exact.lastWantedAt = this.now();
      return exact.informer.snapshot();
    }
    if (namespace === "all" || namespace === "_cluster") return null;
    const wide = lookup("all");
    if (!wide?.informer) return null;
    wide.lastWantedAt = this.now();
    return wide.informer.snapshot(namespace);
  }

  // The list of a scope from its API watch, starting that watch if needed
  // and waiting for one already starting: a table's load and its watch then
  // read the list once, not twice side by side. Null when the scope cannot
  // be watched over the API, so the load reads the server itself.
  async listFromApiWatch(command: KubectlCommand, resource: string, namespace: string): Promise<Record<string, unknown> | null> {
    const ready = this.listSnapshot(command.clusterId, resource, namespace);
    if (ready || !this.apiWatch || this.closed) return ready;
    const key: WatchKey = { clusterId: command.clusterId, resource: resource.trim().toLowerCase(), namespace: normalizeNamespace(namespace) };
    const keyText = normalizedKey(key);
    const running = this.sessions.get(this.runningByKey.get(keyText) ?? "");
    // Running but not synced (relisting), or synced and inside the window
    // after a change: the server answers.
    if (running?.status === "running") return null;
    const failedAt = this.apiWatchFailedAt.get(keyText);
    if (failedAt !== undefined && this.now() - failedAt < API_WATCH_RETRY_AFTER_MS) return null;
    let starting = this.startingByKey.get(keyText);
    if (!starting) {
      starting = this.startApiWatch(command, resource, namespace).finally(() => this.startingByKey.delete(keyText));
      this.startingByKey.set(keyText, starting);
    }
    try {
      if (!(await starting)) {
        this.apiWatchFailedAt.set(keyText, this.now());
        return null;
      }
    } catch {
      this.apiWatchFailedAt.set(keyText, this.now());
      return null;
    }
    return this.listSnapshot(command.clusterId, resource, namespace);
  }

  // KubeDeck just changed something on this cluster: until a watch reports
  // it, its lists come from the API server.
  noteMutation(clusterId: string): void {
    const now = this.now();
    for (const session of this.sessions.values()) {
      if (session.informer && session.key.clusterId === clusterId) session.mutatedAt = now;
    }
  }

  private sweepIdleApiWatches(): void {
    const now = this.now();
    for (const session of this.sessions.values()) {
      if (!session.informer || session.status !== "running") continue;
      if (this.eventHub.hasSubscriber(session.key)) {
        session.lastWantedAt = now;
        continue;
      }
      if (now - session.lastWantedAt < API_WATCH_IDLE_MS) continue;
      this.log(`node watch idle id=${session.id}, stopping`);
      void this.stopSession(session, false);
    }
  }

  private async startProcess(command: KubectlCommand, resource: string, namespace = "all"): Promise<WatchStartResult> {
    if (this.closed) {
      throw new WatchStartError("WATCH_START_FAILED", "Watch manager is stopped", "", "");
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
      informer: null,
      lastWantedAt: this.now(),
      mutatedAt: null,
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

    // A watch that stops on its own - kubectl crashed, lost the API server, or
    // the server closed a long watch - is announced, so a renderer that relies
    // on it can fall back to polling and start it again. A stop somebody asked
    // for is not, and neither is a process that never got as far as running:
    // `start` reports that one to its caller.
    let spawned = false;
    let endAnnounced = false;
    child.once("spawn", () => {
      spawned = true;
    });
    const announceUnexpectedEnd = (wasRunning: boolean) => {
      if (!spawned || endAnnounced || !wasRunning || session.stoppedByUser || this.closed) return;
      endAnnounced = true;
      this.eventHub.publish({
        type: "watch.ended",
        clusterId: key.clusterId,
        watchId: session.id,
        resource: key.resource,
        namespace: key.namespace,
        status: session.status === "stopped" ? "stopped" : "failed",
        exitCode: session.exitCode,
      });
    };

    child.on("error", (error: NodeJS.ErrnoException) => {
      const wasRunning = session.status === "running";
      session.updatedAt = this.now() / 1000;
      tailPush(session.errorTail, error.message);
      if (session.status !== "stopping" && session.status !== "stopped") {
        session.status = "failed";
      }
      this.forgetRunning(session);
      resolveClose();
      announceUnexpectedEnd(wasRunning);
    });
    child.on("close", (code) => {
      const wasRunning = session.status === "running";
      session.exitCode = typeof code === "number" ? code : null;
      session.updatedAt = this.now() / 1000;
      if (session.status === "stopping" || session.stoppedByUser) {
        session.status = "stopped";
      } else if (code === 0) {
        session.status = "stopped";
      } else {
        session.status = "failed";
      }
      this.forgetRunning(session);
      stdoutReader.close();
      stderrReader.close();
      resolveClose();
      this.log(`node watch stopped id=${session.id} status=${session.status} exitCode=${String(session.exitCode)}`);
      announceUnexpectedEnd(wasRunning);
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
      this.forgetRunning(session);
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
    const cleared = this.cache.clearResource(session.key.clusterId, session.key.resource, parsed.namespace, "watch.event");
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

  private sweepTerminalSessions(): void {
    const cutoff = this.now() / 1000 - WATCH_TERMINAL_RETENTION_SECONDS;
    for (const [id, session] of this.sessions) {
      if ((session.status === "stopped" || session.status === "failed") && session.updatedAt < cutoff) {
        this.sessions.delete(id);
      }
    }
  }

  status(): WatchManagerStatus {
    this.sweepTerminalSessions();
    const watches = [...this.sessions.values()].map((session) => this.view(session)).sort((a, b) => b.startedAt - a.startedAt);
    return {
      enabled: true,
      mode: "cache-invalidation+websocket-events",
      running: watches.filter((watch) => watch.status === "running").length,
      total: watches.length,
      watches,
      note: "Watches over the cluster's API connection keep their list in memory and answer table reloads from it; kubectl watches (clusters the API client cannot use) invalidate snapshots. Both publish WebSocket events; HTTP polling remains the fallback.",
    };
  }

  activeCount(): number {
    return [...this.sessions.values()].filter((session) => session.status === "running" || session.status === "stopping").length;
  }

  async stop(
    id: string,
    stoppedByUser = true,
  ): Promise<{
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

  // What a disconnect would stop, counted without stopping it: the
  // confirmation has to name the sessions before they are taken away.
  clusterSessionCount(clusterId: string): number {
    return [...this.sessions.values()].filter((session) => session.key.clusterId === clusterId && (session.status === "running" || session.status === "stopping")).length;
  }

  async stopCluster(clusterId: string): Promise<number> {
    const sessions = [...this.sessions.values()].filter((session) => session.key.clusterId === clusterId && (session.status === "running" || session.status === "stopping"));
    await Promise.all(sessions.map((session) => this.stopSession(session, false)));
    return sessions.length;
  }

  async stopAll(stoppedByUser = true): Promise<{
    ok: true;
    stopped: number;
    watches: WatchView[];
  }> {
    const sessions = [...this.sessions.values()].filter((session) => session.status === "running" || session.status === "stopping");
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
    if (session.informer) {
      session.informer.stop();
      session.status = "stopped";
      session.resolveClose();
      this.forgetRunning(session);
      this.sessions.delete(session.id);
      return;
    }
    if (!session.process) return;
    try {
      if (!session.process.killed) session.process.kill();
    } catch (error) {
      tailPush(session.errorTail, error instanceof Error ? error.message : String(error));
    }
    const closed = await waitForClose(session, this.stopTimeoutMs);
    if (!closed && session.process.exitCode === null) {
      try {
        session.process.kill("SIGKILL");
      } catch (error) {
        tailPush(session.errorTail, error instanceof Error ? error.message : String(error));
      }
      await waitForClose(session, 1000);
    }
    if (session.status === "stopping") {
      session.status = "stopped";
      session.updatedAt = this.now() / 1000;
    }
    this.forgetRunning(session);
    this.sessions.delete(session.id);
  }

  private forgetRunning(session: WatchSession): void {
    const key = normalizedKey(session.key);
    // An error can trigger a replacement before this child's close arrives.
    // Cleanup belongs to the old session, never to that replacement.
    if (this.runningByKey.get(key) === session.id) this.runningByKey.delete(key);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
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
      pid: typeof session.process?.pid === "number" ? session.process.pid : null,
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
