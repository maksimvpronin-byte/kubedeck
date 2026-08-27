import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { IncomingMessage } from "node:http";
import { createInterface } from "node:readline";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer } from "ws";

import { writePolicyViolation } from "../auth";
import type { ConfigStore } from "../config/configStore";
import { buildKubectlCommand } from "../kubectl/command";
import { clusterCommand } from "../kubectl/clusterCommand";
import { sanitizeKubectlText, truncateKubectlText } from "../kubectl/errors";
import type { SpawnProcess } from "../kubectl/runner";
import { decodePathPart, validateIdentifier } from "../validation";
import { rawDataByteLength, rawDataText } from "../webSocketMessages";

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_CLIENT_MESSAGE_BYTES = 1024;
// Lines are sent in batches: a pod that logs a thousand lines a second would
// otherwise be a thousand WebSocket frames a second, and the renderer would
// re-render for every one of them.
const FLUSH_INTERVAL_MS = 120;
const MAX_LINES_PER_FLUSH = 500;
// What the socket will hold for a client that cannot keep up. Beyond this the
// oldest lines are dropped and the client is told how many - the tab shows a
// tail, so the newest lines are the ones worth keeping.
const MAX_PENDING_LINES = 5000;
const MAX_LINE_CHARS = 8000;
const DEFAULT_TAIL_LINES = 500;

interface PodLogsTarget {
  clusterId: string;
  namespace: string;
  pod: string;
  container: string;
  tail: number;
  timestamps: boolean;
  previous: boolean;
}

function parseTail(value: string | null): number {
  if (!value) return DEFAULT_TAIL_LINES;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000) return DEFAULT_TAIL_LINES;
  return parsed;
}

function parseFlag(value: string | null): boolean {
  return value === "true" || value === "1";
}

export function matchPodLogsWebSocket(request: IncomingMessage): PodLogsTarget | null {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const match = url.pathname.match(/^\/clusters\/([^/]+)\/pods\/([^/]+)\/([^/]+)\/logs\/stream$/);
  if (!match) return null;

  const rawContainer = url.searchParams.get("container")?.trim() ?? "";
  return {
    clusterId: validateIdentifier(decodePathPart(match[1], "cluster_id"), "cluster_id", 128),
    namespace: validateIdentifier(decodePathPart(match[2], "namespace"), "namespace"),
    pod: validateIdentifier(decodePathPart(match[3], "name"), "name", 253),
    container: rawContainer ? validateIdentifier(rawContainer, "container", 253) : "",
    tail: parseTail(url.searchParams.get("tail")),
    timestamps: parseFlag(url.searchParams.get("timestamps")),
    previous: parseFlag(url.searchParams.get("previous")),
  };
}

export function podLogsArgs(target: PodLogsTarget): string[] {
  const args = ["logs", target.pod, "-n", target.namespace, "-f", `--tail=${target.tail}`];
  if (target.container) args.push("-c", target.container);
  if (target.previous) args.push("--previous");
  if (target.timestamps) args.push("--timestamps");
  return args;
}

interface LogsSession {
  clusterId: string;
  socket: WebSocket;
  child: ChildProcessWithoutNullStreams;
}

// Following a pod used to mean re-running `kubectl logs --tail=500` every three
// seconds and transferring the whole tail again, whatever had changed. This
// keeps one `kubectl logs -f` per open tab and sends the lines as they arrive.
export class PodLogsWebSocketServer {
  private readonly server = new WebSocketServer({ noServer: true, clientTracking: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });
  private readonly sessions = new Set<LogsSession>();

  constructor(
    private readonly configStore: ConfigStore,
    private readonly log: (message: string) => void,
    private readonly spawnProcess: SpawnProcess,
  ) {}

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    let target: PodLogsTarget | null;
    try {
      target = matchPodLogsWebSocket(request);
    } catch (error) {
      if (this.isLogsPath(request)) {
        writePolicyViolation(request, socket, error instanceof Error ? error.message : "Invalid pod logs route");
        return true;
      }
      return false;
    }
    if (!target) return false;

    this.server.handleUpgrade(request, socket, head, (websocket) => this.open(websocket, target as PodLogsTarget));
    return true;
  }

  private open(socket: WebSocket, target: PodLogsTarget): void {
    let built: ReturnType<typeof buildKubectlCommand>;
    try {
      // No timeout and no output cap: this command is meant to run until the
      // tab is closed, and its output is bounded by what the socket accepts.
      built = buildKubectlCommand(clusterCommand(this.configStore, target.clusterId, podLogsArgs(target), 0, 0));
    } catch (error) {
      this.send(socket, { type: "error", message: error instanceof Error ? error.message : "Unable to build the kubectl command" });
      socket.close(1011, "Unable to start log stream");
      return;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnProcess(built.executable, built.args, { shell: false, windowsHide: true, env: built.environment });
    } catch (error) {
      this.send(socket, { type: "error", message: `kubectl could not be started: ${error instanceof Error ? error.message : String(error)}` });
      socket.close(1011, "Unable to start log stream");
      return;
    }

    const session: LogsSession = { clusterId: target.clusterId, socket, child };
    this.sessions.add(session);

    let pending: string[] = [];
    let dropped = 0;
    let flushTimer: NodeJS.Timeout | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    let closed = false;

    const flush = () => {
      flushTimer = undefined;
      if (closed || pending.length === 0 || socket.readyState !== WebSocket.OPEN) return;
      const lines = pending.length > MAX_LINES_PER_FLUSH ? pending.slice(-MAX_LINES_PER_FLUSH) : pending;
      const skipped = dropped + (pending.length - lines.length);
      pending = [];
      dropped = 0;
      this.send(socket, skipped > 0 ? { type: "lines", lines, dropped: skipped } : { type: "lines", lines });
    };

    const scheduleFlush = () => {
      if (closed || flushTimer) return;
      flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
      flushTimer.unref?.();
    };

    const scheduleHeartbeat = () => {
      if (heartbeat) clearTimeout(heartbeat);
      heartbeat = setTimeout(() => {
        this.send(socket, { type: "heartbeat", at: Date.now() / 1000 });
        scheduleHeartbeat();
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref?.();
    };

    const stdout = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
    stdout.on("line", (line) => {
      if (closed) return;
      if (pending.length >= MAX_PENDING_LINES) {
        pending.shift();
        dropped += 1;
      }
      pending.push(line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line);
      scheduleFlush();
    });

    const stderr = createInterface({ input: child.stderr, crlfDelay: Number.POSITIVE_INFINITY });
    stderr.on("line", (line) => {
      if (closed || !line.trim()) return;
      this.send(socket, { type: "error", message: truncateKubectlText(sanitizeKubectlText(line), 2000) });
    });

    const cleanup = (reason: string) => {
      if (closed) return;
      closed = true;
      if (flushTimer) clearTimeout(flushTimer);
      if (heartbeat) clearTimeout(heartbeat);
      stdout.close();
      stderr.close();
      this.sessions.delete(session);
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill();
        } catch {
          // Best effort only.
        }
      }
      this.log(`node pod logs stream closed cluster=${target.clusterId} pod=${target.pod} reason=${reason}`);
    };

    child.on("error", (error) => {
      this.send(socket, { type: "error", message: `kubectl failed: ${error.message}` });
      cleanup("spawn-error");
      if (socket.readyState === WebSocket.OPEN) socket.close(1011, "kubectl failed");
    });

    child.on("close", (code) => {
      flush();
      // A pod that is deleted, or a container that ends, ends the stream too -
      // the tab says so rather than silently stopping.
      this.send(socket, { type: "ended", exitCode: typeof code === "number" ? code : null });
      cleanup("kubectl-exit");
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "Log stream ended");
    });

    socket.once("close", () => cleanup("client-closed"));
    socket.once("error", (error) => {
      this.log(`node pod logs websocket error: ${error.message}`);
      cleanup("socket-error");
    });
    socket.on("message", (data) => {
      if (rawDataByteLength(data) > MAX_CLIENT_MESSAGE_BYTES) {
        socket.close(1009, "Message too large");
        return;
      }
      if (rawDataText(data).trim() === "ping") this.send(socket, { type: "pong", at: Date.now() / 1000 });
      scheduleHeartbeat();
    });

    child.stdin.end();
    this.send(socket, { type: "status", data: "connected", clusterId: target.clusterId, namespace: target.namespace, pod: target.pod, container: target.container, commandPreview: built.preview });
    scheduleHeartbeat();
    this.log(`node pod logs stream started preview=${built.preview}`);
  }

  private send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      this.log(`node pod logs send failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private isLogsPath(request: IncomingMessage): boolean {
    try {
      return new URL(request.url ?? "/", "http://127.0.0.1").pathname.endsWith("/logs/stream");
    } catch {
      return false;
    }
  }

  activeCount(): number {
    return this.sessions.size;
  }

  clusterSessionCount(clusterId: string): number {
    let count = 0;
    for (const session of this.sessions) if (session.clusterId === clusterId) count += 1;
    return count;
  }

  // Disconnecting a cluster has to stop what is still talking to it.
  stopCluster(clusterId: string): void {
    for (const session of [...this.sessions]) {
      if (session.clusterId !== clusterId) continue;
      try {
        session.socket.close(1001, "Cluster disconnected");
      } catch {
        session.socket.terminate();
      }
    }
  }

  close(): void {
    for (const session of [...this.sessions]) {
      try {
        session.socket.close(1001, "KubeDeck is shutting down");
      } catch {
        session.socket.terminate();
      }
    }
    this.server.close();
  }
}
