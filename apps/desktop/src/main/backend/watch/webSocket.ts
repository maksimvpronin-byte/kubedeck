import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import {
  WebSocket,
  WebSocketServer,
  type RawData,
} from "ws";

import { writePolicyViolation } from "../auth";
import { RequestValidationError, validateIdentifier } from "../validation";
import {
  resourceWatchEventMatches,
  type ResourceWatchEventHub,
  type ResourceWatchFilter,
} from "./eventHub";

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_QUEUE_ITEMS = 200;
const MAX_CLIENT_MESSAGE_BYTES = 1024;

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

function matchWatchWebSocket(request: IncomingMessage): ResourceWatchFilter | null {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const match = url.pathname.match(
    /^\/clusters\/([^/]+)\/resources\/([^/]+)\/watch-events$/,
  );
  if (!match) return null;
  const rawNamespace = url.searchParams.get("namespace")?.trim() || "all";
  const namespace =
    rawNamespace === "all" || rawNamespace === "_cluster"
      ? rawNamespace
      : validateIdentifier(rawNamespace, "namespace");
  return {
    clusterId: validateIdentifier(
      decodePart(match[1], "cluster_id"),
      "cluster_id",
      128,
    ),
    resource: validateIdentifier(
      decodePart(match[2], "resource"),
      "resource",
      128,
    ).toLowerCase(),
    namespace,
  };
}

class BoundedSocketQueue {
  private readonly queue: string[] = [];
  private sending = false;
  private closed = false;

  constructor(private readonly socket: WebSocket) {}

  enqueue(value: unknown): void {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return;
    const serialized = JSON.stringify(value);
    if (this.queue.length >= MAX_QUEUE_ITEMS) this.queue.shift();
    this.queue.push(serialized);
    this.flush();
  }

  close(): void {
    this.closed = true;
    this.queue.length = 0;
  }

  private flush(): void {
    if (
      this.closed ||
      this.sending ||
      this.queue.length === 0 ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const next = this.queue.shift();
    if (next === undefined) return;
    this.sending = true;
    this.socket.send(next, (error) => {
      this.sending = false;
      if (error) {
        this.close();
        try {
          this.socket.close(1011, "WebSocket send failed");
        } catch {
          // Best effort only.
        }
        return;
      }
      this.flush();
    });
  }
}

function rawDataByteLength(data: RawData): number {
  if (typeof data === "string") return Buffer.byteLength(data, "utf8");
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) return data.reduce((total, item) => total + item.length, 0);
  return data.byteLength;
}

function rawDataText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

export class ResourceWatchWebSocketServer {
  private readonly server = new WebSocketServer({
    noServer: true,
    clientTracking: true,
    maxPayload: MAX_CLIENT_MESSAGE_BYTES,
  });

  constructor(
    private readonly eventHub: ResourceWatchEventHub,
    private readonly log: (message: string) => void,
  ) {}

  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean {
    let filter: ResourceWatchFilter | null;
    try {
      filter = matchWatchWebSocket(request);
    } catch (error) {
      if (this.isWatchPath(request)) {
        this.rejectUpgrade(
          request,
          socket,
          error instanceof Error ? error.message : "Invalid watch route",
        );
        return true;
      }
      return false;
    }
    if (!filter) return false;

    this.server.handleUpgrade(request, socket, head, (websocket) => {
      this.open(websocket, filter as ResourceWatchFilter);
    });
    return true;
  }

  private open(socket: WebSocket, filter: ResourceWatchFilter): void {
    const queue = new BoundedSocketQueue(socket);
    let heartbeat: NodeJS.Timeout | undefined;
    const scheduleHeartbeat = () => {
      if (heartbeat) clearTimeout(heartbeat);
      heartbeat = setTimeout(() => {
        queue.enqueue({ type: "heartbeat", at: Date.now() / 1000 });
        scheduleHeartbeat();
      }, HEARTBEAT_INTERVAL_MS);
    };
    const unsubscribe = this.eventHub.subscribe((event) => {
      if (!resourceWatchEventMatches(event, filter)) return;
      queue.enqueue(event);
      scheduleHeartbeat();
    });
    const cleanup = () => {
      if (heartbeat) clearTimeout(heartbeat);
      unsubscribe();
      queue.close();
    };

    socket.once("close", cleanup);
    socket.once("error", (error) => {
      this.log(`node resource watch websocket error: ${error.message}`);
      cleanup();
    });
    socket.on("message", (data) => {
      if (rawDataByteLength(data) > MAX_CLIENT_MESSAGE_BYTES) {
        socket.close(1009, "Message too large");
        return;
      }
      if (rawDataText(data).trim() === "ping") {
        queue.enqueue({ type: "pong", at: Date.now() / 1000 });
      }
      scheduleHeartbeat();
    });

    queue.enqueue({
      type: "status",
      data: "connected",
      clusterId: filter.clusterId,
      resource: filter.resource,
      namespace: filter.namespace,
    });
    scheduleHeartbeat();
  }

  private isWatchPath(request: IncomingMessage): boolean {
    try {
      return new URL(request.url ?? "/", "http://127.0.0.1").pathname.includes(
        "/watch-events",
      );
    } catch {
      return false;
    }
  }

  private rejectUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    reason: string,
  ): void {
    writePolicyViolation(request, socket, reason);
  }

  close(): void {
    for (const socket of this.server.clients) {
      try {
        socket.close(1001, "KubeDeck is shutting down");
      } catch {
        socket.terminate();
      }
    }
    this.server.close();
  }
}
