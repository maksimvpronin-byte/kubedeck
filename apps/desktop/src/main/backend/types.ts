import type { SpawnProcess } from "./kubectl/runner";
import type { TerminalPtyFactory } from "./terminal/podTerminalWebSocket";
import type { SshClientFactory } from "./ssh/nodeSshWebSocket";

export type RouteOwner = "node" | "python";
export type RouteTransport = "http" | "websocket";

export interface RouteOwnership {
  method: string;
  path: string;
  transport: RouteTransport;
  owner: RouteOwner;
  targetRelease: string;
  migratedIn?: string;
  sourceModule: string;
  notes?: string;
}

export interface MigrationStatus {
  mode: "hybrid" | "node-only";
  gateway: {
    runtime: "node";
    version: string;
    processId: number;
    nodeVersion: string;
  };
  legacyBackend: {
    enabled: boolean;
    healthy: boolean;
    processId?: number;
  };
  routes: {
    totalExisting: number;
    nodeOwned: number;
    pythonOwned: number;
    node: Array<{
      method: string;
      path: string;
      transport: RouteTransport;
      migratedIn?: string;
    }>;
    python: Array<{
      method: string;
      path: string;
      transport: RouteTransport;
      targetRelease: string;
    }>;
  };
  processes: {
    watches: number;
    terminals: number;
    portForwards: number;
    sshSessions: number;
    source: "legacy-not-inspected" | "node" | "hybrid";
  };
}

export interface GatewayOptions {
  legacyBackendUrl: string;
  sessionToken: string;
  legacyProcessId: () => number | null;
  appDataRoot: string;
  appVersion: string;
  log: (message: string) => void;
  spawnKubectl?: SpawnProcess;
  terminalPtyFactory?: TerminalPtyFactory | null;
  sshClientFactory?: SshClientFactory;
}

export interface GatewayHandle {
  baseUrl: string;
  close: () => Promise<void>;
}
