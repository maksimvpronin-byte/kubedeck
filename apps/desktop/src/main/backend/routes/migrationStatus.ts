import http from "node:http";
import type { ServerResponse } from "node:http";
import { routeOwnershipSummary } from "../routeOwnership";
import type { GatewayOptions, MigrationStatus } from "../types";

async function legacyHealth(
  legacyBackendUrl: string,
  sessionToken: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL("/health", legacyBackendUrl);
    const request = http.request(
      url,
      {
        method: "GET",
        headers: {
          "X-KubeDeck-Token": sessionToken,
        },
      },
      (response) => {
        response.resume();
        resolve(Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300));
      },
    );

    request.setTimeout(750, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
    request.end();
  });
}

export async function writeMigrationStatus(
  response: ServerResponse,
  options: GatewayOptions,
): Promise<void> {
  const healthy = await legacyHealth(options.legacyBackendUrl, options.sessionToken);
  const routes = routeOwnershipSummary();

  const body: MigrationStatus = {
    mode: routes.pythonOwned > 0 ? "hybrid" : "node-only",
    gateway: {
      runtime: "node",
      version: "2.0.0-alpha.1",
      processId: process.pid,
      nodeVersion: process.versions.node,
    },
    legacyBackend: {
      enabled: routes.pythonOwned > 0,
      healthy,
      ...(options.legacyProcessId() ? { processId: options.legacyProcessId() ?? undefined } : {}),
    },
    routes,
    processes: {
      watches: 0,
      terminals: 0,
      portForwards: 0,
      sshSessions: 0,
      source: "legacy-not-inspected",
    },
  };

  const serialized = JSON.stringify(body);
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(serialized));
  response.end(serialized);
}
