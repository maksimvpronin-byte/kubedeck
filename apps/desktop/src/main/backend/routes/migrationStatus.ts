import type { ServerResponse } from "node:http";
import { writeJson } from "../http";
import { routeOwnershipSummary } from "../routeOwnership";
import type { GatewayOptions, MigrationStatus } from "../types";

export async function writeMigrationStatus(
  response: ServerResponse,
  options: GatewayOptions,
  nodeWatchCount = 0,
  nodeTerminalCount = 0,
  nodeSshCount = 0,
  nodePortForwardCount = 0,
): Promise<void> {
  const routes = routeOwnershipSummary();
  const body: MigrationStatus = {
    mode: "node-only",
    gateway: {
      runtime: "node",
      version: options.appVersion,
      processId: process.pid,
      nodeVersion: process.versions.node,
    },
    legacyBackend: {
      enabled: false,
      healthy: false,
    },
    routes,
    processes: {
      watches: nodeWatchCount,
      terminals: nodeTerminalCount,
      portForwards: nodePortForwardCount,
      sshSessions: nodeSshCount,
      source: "node",
    },
  };

  writeJson(response, body);
}
