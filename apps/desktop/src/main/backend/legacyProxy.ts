import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { writeError } from "./errors";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function outboundHeaders(headers: IncomingHttpHeaders, legacy: URL): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};

  for (const [name, value] of Object.entries(headers)) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase()) || name.toLowerCase() === "host") continue;
    result[name] = value;
  }

  result.host = legacy.host;
  return result;
}

function responseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};

  for (const [name, value] of Object.entries(headers)) {
    const lowered = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowered) || lowered.startsWith("access-control-")) continue;
    result[name] = value;
  }

  return result;
}

export function proxyHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  legacyBackendUrl: string,
  log: (message: string) => void,
): void {
  const legacy = new URL(legacyBackendUrl);

  const upstream = http.request(
    {
      protocol: legacy.protocol,
      hostname: legacy.hostname,
      port: legacy.port,
      method: request.method,
      path: request.url,
      headers: outboundHeaders(request.headers, legacy),
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        responseHeaders(upstreamResponse.headers),
      );
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", (error) => {
    log(`gateway legacy HTTP unavailable: ${error.message}`);
    writeError(
      response,
      502,
      "LEGACY_BACKEND_UNAVAILABLE",
      "The legacy KubeDeck backend is unavailable",
    );
  });

  request.on("aborted", () => upstream.destroy());
  request.pipe(upstream);
}

function rawUpgradeRequest(request: IncomingMessage, legacy: URL): string {
  const lines = [
    `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}`,
    `Host: ${legacy.host}`,
  ];

  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const value = request.rawHeaders[index + 1] ?? "";
    if (name.toLowerCase() === "host") continue;
    lines.push(`${name}: ${value}`);
  }

  lines.push("", "");
  return lines.join("\r\n");
}

export function proxyWebSocketUpgrade(
  request: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  legacyBackendUrl: string,
  log: (message: string) => void,
): void {
  const legacy = new URL(legacyBackendUrl);
  const upstream = net.connect({
    host: legacy.hostname,
    port: Number(legacy.port),
  });

  const closeBoth = () => {
    if (!clientSocket.destroyed) clientSocket.destroy();
    if (!upstream.destroyed) upstream.destroy();
  };

  upstream.on("connect", () => {
    upstream.write(rawUpgradeRequest(request, legacy));
    if (head.length > 0) upstream.write(head);
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  });

  upstream.on("error", (error) => {
    log(`gateway legacy WebSocket unavailable: ${error.message}`);
    if (!clientSocket.destroyed) {
      clientSocket.end(
        "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    }
  });

  clientSocket.on("error", closeBoth);
  clientSocket.on("close", closeBoth);
  upstream.on("close", closeBoth);
}
