import type { ServerResponse } from "node:http";

export function writeHealth(response: ServerResponse): void {
  const body = JSON.stringify({
    ok: true,
    service: "kubedeck-backend",
    runtime: "node",
    gatewayVersion: "2.0.0-alpha.1",
  });

  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}
