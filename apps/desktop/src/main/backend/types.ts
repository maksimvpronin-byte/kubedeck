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
    source: "legacy-not-inspected" | "node";
  };
}

export interface GatewayOptions {
  legacyBackendUrl: string;
  sessionToken: string;
  legacyProcessId: () => number | null;
  appDataRoot: string;
  appVersion: string;
  log: (message: string) => void;
}

export interface GatewayHandle {
  baseUrl: string;
  close: () => Promise<void>;
}
