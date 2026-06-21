import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import {
  isAllowedOrigin,
  isAuthorized,
  requestOrigin,
  requestToken,
  websocketToken,
  writePolicyViolation,
} from "./auth";
import { writeError } from "./errors";
import { proxyHttpRequest, proxyWebSocketUpgrade } from "./legacyProxy";
import { writeHealth } from "./routes/health";
import { writeMigrationStatus } from "./routes/migrationStatus";
import type { GatewayHandle, GatewayOptions } from "./types";

const ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Content-Type,X-KubeDeck-Token";

function applyCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = requestOrigin(request);
  if (!isAllowedOrigin(origin)) {
    writeError(response, 403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed");
    return false;
  }

  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
    response.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  }

  return true;
}

function requestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
}

function isHealthRequest(request: IncomingMessage): boolean {
  return request.method === "GET" && requestPath(request) === "/health";
}

function isMigrationStatusRequest(request: IncomingMessage): boolean {
  return request.method === "GET" && requestPath(request) === "/migration/status";
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: GatewayOptions,
): void {
  if (!applyCors(request, response)) return;

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (isHealthRequest(request)) {
    writeHealth(response);
    return;
  }

  if (!isAuthorized(requestToken(request), options.sessionToken)) {
    writeError(
      response,
      401,
      "UNAUTHORIZED",
      "KubeDeck session token is missing or invalid",
    );
    return;
  }

  if (isMigrationStatusRequest(request)) {
    void writeMigrationStatus(response, options).catch((error) => {
      options.log(`gateway migration status failed: ${String(error)}`);
      writeError(response, 500, "MIGRATION_STATUS_FAILED", "Unable to build migration status");
    });
    return;
  }

  proxyHttpRequest(request, response, options.legacyBackendUrl, options.log);
}

function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  options: GatewayOptions,
): void {
  const origin = requestOrigin(request);
  if (!isAllowedOrigin(origin)) {
    writePolicyViolation(request, socket, "Origin not allowed");
    return;
  }

  if (!isAuthorized(websocketToken(request), options.sessionToken)) {
    writePolicyViolation(request, socket, "Unauthorized");
    return;
  }

  proxyWebSocketUpgrade(request, socket, head, options.legacyBackendUrl, options.log);
}

export async function startGateway(options: GatewayOptions): Promise<GatewayHandle> {
  const sockets = new Set<Socket>();
  const server = http.createServer((request, response) => handleRequest(request, response, options));

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  server.on("upgrade", (request, socket, head) => {
    handleUpgrade(request, socket, head, options);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to determine Node Gateway address");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  options.log(`node gateway ready url=${baseUrl}`);

  let closing: Promise<void> | null = null;

  return {
    baseUrl,
    close: () => {
      if (closing) return closing;

      closing = new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          options.log("node gateway stopped");
          resolve();
        });
      });

      return closing;
    },
  };
}
