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
import { AuditStore } from "./audit/auditStore";
import { ResourceSnapshotCache } from "./cache/resourceSnapshotCache";
import { ResourceWatchEventHub } from "./watch/eventHub";
import { ResourceWatchWebSocketServer } from "./watch/webSocket";
import { WatchManager } from "./watch/watchManager";
import { PortForwardManager } from "./portForward/portForwardManager";
import { PodTerminalWebSocketServer } from "./terminal/podTerminalWebSocket";
import { NodeSshWebSocketServer } from "./ssh/nodeSshWebSocket";
import { ConfigStore } from "./config/configStore";
import { writeError } from "./errors";
import { KubectlRunner } from "./kubectl/runner";
import { writeAppInfo } from "./routes/appInfo";
import { writeAudit } from "./routes/audit";
import {
  writeClusters,
  writeImportCluster,
  writeNamespaces,
  writeOpenCluster,
  writeOpenLastCluster,
  writeRemoveCluster,
  writeRenameCluster,
} from "./routes/clusters";
import { writeConfig, writeSettings } from "./routes/config";
import { writeHealth } from "./routes/health";
import { writeKubectlStatus } from "./routes/kubectl";
import { writeMigrationStatus } from "./routes/migrationStatus";
import { handleResourceDetailsRequest } from "./routes/resourceDetails";
import {
  clearResourceDefinitionCache,
  handleResourceDiscoveryEventsRequest,
} from "./routes/resourceDiscoveryEvents";
import { handleDeploymentLogsRequest } from "./routes/deploymentLogs";
import { handleYamlRequest } from "./routes/yaml";
import { handleSecretRequest } from "./routes/secrets";
import { handleResourceActionRequest } from "./routes/resourceActions";
import { handlePodExecRequest } from "./routes/podExec";
import { handleResourceListRequest } from "./routes/resourceLists";
import { handleWatchRequest } from "./routes/watch";
import { handlePortForwardRequest } from "./routes/portForward";
import { handleProblemsRequest } from "./routes/problems";
import { handleSearchRequest } from "./routes/search";
import { handleRelatedResourcesRequest } from "./routes/relatedResources";
import { handleLlmRequest } from "./routes/llm";
import type { GatewayHandle, GatewayOptions } from "./types";

const ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Content-Type,X-KubeDeck-Token";

interface GatewayServices {
configStore: ConfigStore;
  auditStore: AuditStore;
  kubectlRunner: KubectlRunner;
  resourceCache: ResourceSnapshotCache;
  watchManager: WatchManager;
  portForwardManager: PortForwardManager;
  terminalWebSocket: PodTerminalWebSocketServer;
  sshWebSocket: NodeSshWebSocketServer;
}

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

function decodePathPart(value: string, response: ServerResponse): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    writeError(response, 400, "INVALID_CLUSTER_ID", "Cluster id is not valid URL encoding");
    return null;
  }
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: GatewayOptions,
  services: GatewayServices,
): void {
  if (!applyCors(request, response)) return;

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  const pathname = requestPath(request);

  if (request.method === "GET" && pathname === "/health") {
    writeHealth(response, options.appVersion);
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

  if (request.method === "GET" && pathname === "/migration/status") {
    void writeMigrationStatus(
      response,
      options,
      services.watchManager.activeCount(),
      services.terminalWebSocket.activeCount(),
      services.sshWebSocket.activeCount(),
      services.portForwardManager.activeCount(),
    ).catch((error) => {
      options.log(`gateway migration status failed: ${String(error)}`);
      writeError(response, 500, "MIGRATION_STATUS_FAILED", "Unable to build migration status");
    });
    return;
  }

  if (request.method === "GET" && pathname === "/app/info") {
    try {
      writeAppInfo(response, options, services.configStore);
    } catch (error) {
      options.log(`gateway app info failed: ${String(error)}`);
      writeError(response, 500, "APP_INFO_FAILED", "Unable to read application information");
    }
    return;
  }

  if (request.method === "GET" && pathname === "/config") {
    try {
      writeConfig(response, services.configStore);
    } catch (error) {
      options.log(`gateway config read failed: ${String(error)}`);
      writeError(response, 500, "CONFIG_READ_FAILED", "Unable to read application config");
    }
    return;
  }

  if (request.method === "PUT" && pathname === "/settings") {
    void writeSettings(
      request,
      response,
      services.configStore,
      services.auditStore,
    ).catch((error) => {
      options.log(`gateway settings update failed: ${String(error)}`);
      writeError(response, 500, "SETTINGS_UPDATE_FAILED", "Unable to update settings");
    });
    return;
  }

  if (request.method === "GET" && pathname === "/audit") {
    writeAudit(request.url, response, services.auditStore);
    return;
  }

  if (request.method === "GET" && pathname === "/kubectl/status") {
    void writeKubectlStatus(
      response,
      services.configStore,
      services.kubectlRunner,
    ).catch((error) => {
      options.log(`gateway kubectl status failed: ${String(error)}`);
      writeError(response, 500, "KUBECTL_STATUS_FAILED", "Unable to read kubectl status");
    });
    return;
  }

  if (request.method === "GET" && pathname === "/clusters") {
    try {
      writeClusters(response, services.configStore);
    } catch (error) {
      options.log(`gateway cluster list failed: ${String(error)}`);
      writeError(response, 500, "CLUSTER_LIST_FAILED", "Unable to read clusters");
    }
    return;
  }

  if (request.method === "POST" && pathname === "/clusters/import") {
    void writeImportCluster(
      request,
      response,
      services.configStore,
      services.auditStore,
    ).catch((error) => {
      options.log(`gateway cluster import failed: ${String(error)}`);
      writeError(response, 500, "IMPORT_FAILED", "Unable to import cluster");
    });
    return;
  }

  if (request.method === "POST" && pathname === "/clusters/last/open") {
    void writeOpenLastCluster(
      response,
      services.configStore,
      services.kubectlRunner,
    ).catch((error) => {
      options.log(`gateway last cluster open failed: ${String(error)}`);
      writeError(response, 500, "CLUSTER_OPEN_FAILED", "Unable to open last cluster");
    });
    return;
  }

  const openClusterMatch = pathname.match(/^\/clusters\/([^/]+)\/open$/);
  if (request.method === "POST" && openClusterMatch) {
    const clusterId = decodePathPart(openClusterMatch[1], response);
    if (clusterId === null) return;

    void writeOpenCluster(
      response,
      clusterId,
      services.configStore,
      services.kubectlRunner,
    ).catch((error) => {
      options.log(`gateway cluster open failed cluster=${clusterId}: ${String(error)}`);
      writeError(response, 500, "CLUSTER_OPEN_FAILED", "Unable to open cluster");
    });
    return;
  }

  const namespacesMatch = pathname.match(/^\/clusters\/([^/]+)\/namespaces$/);
  if (request.method === "GET" && namespacesMatch) {
    const clusterId = decodePathPart(namespacesMatch[1], response);
    if (clusterId === null) return;

    void writeNamespaces(
      response,
      clusterId,
      services.configStore,
      services.kubectlRunner,
    ).catch((error) => {
      options.log(`gateway namespaces failed cluster=${clusterId}: ${String(error)}`);
      writeError(response, 500, "NAMESPACES_FAILED", "Unable to load namespaces");
    });
    return;
  }

  const clusterMatch = pathname.match(/^\/clusters\/([^/]+)$/);
  if (clusterMatch && (request.method === "PATCH" || request.method === "DELETE")) {
    const clusterId = decodePathPart(clusterMatch[1], response);
    if (clusterId === null) return;

    if (request.method === "PATCH") {
      void writeRenameCluster(
        request,
        response,
        clusterId,
        services.configStore,
        services.auditStore,
      ).catch((error) => {
        options.log(`gateway cluster rename failed: ${String(error)}`);
        writeError(response, 500, "CLUSTER_RENAME_FAILED", "Unable to rename cluster");
      });
      return;
    }

    void services.watchManager.stopCluster(clusterId);
    void services.portForwardManager.stopCluster(clusterId);
    void services.terminalWebSocket.stopCluster(clusterId);
    void services.sshWebSocket.stopCluster(clusterId);
    services.resourceCache.clear(clusterId, "cluster.remove");
      clearResourceDefinitionCache(clusterId);
      void writeRemoveCluster(
      response,
      clusterId,
      services.configStore,
      services.auditStore,
    ).catch((error) => {
      options.log(`gateway cluster remove failed: ${String(error)}`);
      writeError(response, 500, "CLUSTER_REMOVE_FAILED", "Unable to remove cluster");
    });
    return;
  }

  if (
    handlePortForwardRequest(
      request,
      response,
      pathname,
      services.configStore,
      services.auditStore,
      services.portForwardManager,
      options.log,
    )
  ) {
    return;
  }

  if (
    handleWatchRequest(
      request,
      response,
      pathname,
      services.configStore,
      services.watchManager,
      options.log,
    )
  ) {
    return;
  }

  if (
    handleProblemsRequest(
      request,
      response,
      pathname,
      services.configStore,
      services.kubectlRunner,
      options.log,
    )
  ) {
    return;
  }
  if (
    handleSearchRequest(
      request,
      response,
      pathname,
      services.configStore,
      services.kubectlRunner,
      options.log,
    )
  ) {
    return;
  }
  if (
    handleLlmRequest(
      request,
      response,
      pathname,
      services.configStore,
      options.log,
    )
  ) {
    return;
  }
  if (
    handleRelatedResourcesRequest(
      request,
      response,
      pathname,
      services.configStore,
      services.kubectlRunner,
      options.log,
    )
  ) {
    return;
  }
  if (
    handleResourceListRequest(
      request,
      response,
      pathname,
      services.configStore,
      services.kubectlRunner,
      services.resourceCache,
      clearResourceDefinitionCache,
      options.log,
    )
  ) {
    return;
  }

  if (
    handlePodExecRequest(
      request,
      response,
      pathname,
      services.configStore,
      services.auditStore,
      services.kubectlRunner,
      options.log,
    )
  ) {
    return;
  }

  if (
    handleSecretRequest(
      request,
      response,
      pathname,
      services.configStore,
      services.auditStore,
      services.kubectlRunner,
      options.log,
    )
  ) {
    return;
  }

  if (
    handleResourceActionRequest(
      request,
      response,
      pathname,
      services.configStore,
      services.auditStore,
      services.kubectlRunner,
      options.log,
      async (clusterId) => {
        services.resourceCache.clear(clusterId, "mutation");
        clearResourceDefinitionCache(clusterId);
      },
    )
  ) {
    return;
  }

  if (
    handleYamlRequest(
      request,
      response,
      pathname,
      services.configStore,
      services.auditStore,
      services.kubectlRunner,
      options.log,
      async (clusterId) => {
        services.resourceCache.clear(clusterId, "mutation");
        clearResourceDefinitionCache(clusterId);
      },
    )
  ) {
    return;
  }

  if (
    handleDeploymentLogsRequest(
      request,
      response,
      pathname,
      services.configStore,
      services.kubectlRunner,
      options.log,
    )
  ) {
    return;
  }

  if (
    handleResourceDiscoveryEventsRequest(
      request,
      response,
      pathname,
      services.configStore,
      services.kubectlRunner,
      options.log,
    )
  ) {
    return;
  }

  if (
    handleResourceDetailsRequest(
      request,
      response,
      pathname,
      services.configStore,
      services.kubectlRunner,
      options.log,
    )
  ) {
    return;
  }

  writeError(response, 404, "ROUTE_NOT_FOUND", "Route is not implemented by KubeDeck");
}

function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  options: GatewayOptions,
  watchWebSocket: ResourceWatchWebSocketServer,
  terminalWebSocket: PodTerminalWebSocketServer,
  sshWebSocket: NodeSshWebSocketServer,
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

  if (sshWebSocket.handleUpgrade(request, socket, head)) return;
  if (terminalWebSocket.handleUpgrade(request, socket, head)) return;
  if (watchWebSocket.handleUpgrade(request, socket, head)) return;
  writePolicyViolation(request, socket, "Unknown WebSocket route");
}

export async function startGateway(options: GatewayOptions): Promise<GatewayHandle> {
  const resourceCache = new ResourceSnapshotCache();
  const watchEvents = new ResourceWatchEventHub();
  const watchManager = new WatchManager(
    options.log,
    resourceCache,
    watchEvents,
    options.spawnKubectl,
  );
  const watchWebSocket = new ResourceWatchWebSocketServer(watchEvents, options.log);
  const configStore = new ConfigStore(options.appDataRoot);
  const auditStore = new AuditStore(options.appDataRoot, options.log);
  const kubectlRunner = new KubectlRunner(options.log, options.spawnKubectl);
  const portForwardManager = new PortForwardManager(options.log, {
    spawnProcess: options.spawnKubectl,
  });
  const terminalWebSocket = new PodTerminalWebSocketServer(
    configStore,
    auditStore,
    kubectlRunner,
    options.log,
    {
      spawnProcess: options.spawnKubectl,
      ptyFactory: options.terminalPtyFactory,
    },
  );
  const sshWebSocket = new NodeSshWebSocketServer(auditStore, options.log, {
    clientFactory: options.sshClientFactory,
  });
  const services: GatewayServices = {
    configStore,
    auditStore,
    kubectlRunner,
    resourceCache,
    watchManager,
    portForwardManager,
    terminalWebSocket,
    sshWebSocket,
  };

  const sockets = new Set<Socket>();
  const server = http.createServer((request, response) =>
    handleRequest(request, response, options, services),
  );

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  server.on("upgrade", (request, socket, head) => {
    handleUpgrade(
      request,
      socket,
      head,
      options,
      watchWebSocket,
      terminalWebSocket,
      sshWebSocket,
    );
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

      closing = (async () => {
        await services.sshWebSocket.close();
      await services.terminalWebSocket.close();
      await services.portForwardManager.close();
      await services.watchManager.close();
      watchWebSocket.close();
      await services.kubectlRunner.close();

        for (const socket of sockets) {
          socket.destroy();
        }

        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });

        options.log("node gateway stopped");
      })();

      return closing;
    },
  };
}
