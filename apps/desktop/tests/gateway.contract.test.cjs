const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { startGateway } = require("../dist/main/backend/gateway.js");

const TOKEN = "gateway-contract-test-token";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function websocketRequest(port, token) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const socket = net.connect({ host: "127.0.0.1", port });
    const chunks = [];
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    };

    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error("WebSocket test timed out"));
    });
    socket.on("connect", () => {
      socket.write(
        [
          `GET /clusters/test/resources/pods/watch-events?namespace=all&token=${encodeURIComponent(token)} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "Origin: http://127.0.0.1:5173",
          "",
          "",
        ].join("\r\n"),
      );
    });
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", finish);
    socket.on("close", finish);
    socket.on("error", reject);
  });
}

function settings(overrides = {}) {
  return {
    kubectlPath: "kubectl",
    language: "system",
    theme: "system",
    refreshIntervalSeconds: 10,
    logsTailLines: 500,
    secretRevealTimeoutSeconds: 30,
    restartProblemThreshold: 3,
    terminalFontSize: 13,
    logsSince: "",
    llm: {
      enabled: true,
      provider: "openai_compatible",
      baseUrl: " http://127.0.0.1:1234/v1 ",
      model: " test-model ",
      apiKey: "do-not-write-this-key-to-audit",
      temperature: 0.2,
      timeoutSeconds: 60,
      maxContextChars: 60000,
      maxOutputTokens: 4096,
    },
    ssh: {
      defaultUsername: " user ",
      defaultPort: 22,
      defaultAuthMethod: "agent",
      useJumpHost: false,
      jumpHost: "",
      jumpPort: 22,
      jumpUsername: "",
      jumpAuthMethod: "agent",
    },
    ...overrides,
  };
}

test("Node Gateway alpha.2.1 cluster management contract", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-gateway-"));
  const sourceKubeconfig = path.join(appDataRoot, "source.test.yaml");
  const externalKubeconfig = path.join(appDataRoot, "external-owned-by-user.yaml");
  fs.writeFileSync(sourceKubeconfig, "apiVersion: v1\nclusters: []\n", "utf8");
  fs.writeFileSync(externalKubeconfig, "apiVersion: v1\nexternal: true\n", "utf8");
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));

  const cacheClearClusterIds = [];
  const legacy = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/health") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/resource-cache/clear") {
      cacheClearClusterIds.push(url.searchParams.get("cluster_id"));
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ cleared: 1 }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/clusters/test/open") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ source: "python-open" }));
      return;
    }
    if (url.pathname === "/json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ source: "python" }));
      return;
    }
    response.statusCode = 418;
    response.end("teapot");
  });

  legacy.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    const accept = crypto
      .createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.end(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "LEGACY_OK",
      ].join("\r\n"),
    );
  });

  const legacyUrl = await listen(legacy);
  const gateway = await startGateway({
    legacyBackendUrl: legacyUrl,
    sessionToken: TOKEN,
    legacyProcessId: () => 1234,
    appDataRoot,
    appVersion: "2.0.0-alpha.2.1",
    log: () => {},
  });

  t.after(async () => {
    await gateway.close();
    if (legacy.listening) await close(legacy);
  });

  const authHeaders = {
    "Content-Type": "application/json",
    "X-KubeDeck-Token": TOKEN,
  };

  const health = await fetch(`${gateway.baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).gatewayVersion, "2.0.0-alpha.2.1");

  const status = await fetch(`${gateway.baseUrl}/migration/status`, { headers: authHeaders });
  const migration = await status.json();
  assert.equal(migration.routes.totalExisting, 49);
  assert.equal(migration.routes.nodeOwned, 9);
  assert.equal(migration.routes.pythonOwned, 40);

  const initialClusters = await fetch(`${gateway.baseUrl}/clusters`, { headers: authHeaders });
  assert.deepEqual((await initialClusters.json()).clusters, []);

  const missingImport = await fetch(`${gateway.baseUrl}/clusters/import`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ sourcePath: path.join(appDataRoot, "missing.yaml") }),
  });
  assert.equal(missingImport.status, 400);
  assert.equal((await missingImport.json()).detail.code, "IMPORT_FAILED");

  const importResponse = await fetch(`${gateway.baseUrl}/clusters/import`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ sourcePath: sourceKubeconfig, displayName: "Imported cluster" }),
  });
  assert.equal(importResponse.status, 200);
  const imported = await importResponse.json();
  assert.equal(imported.displayName, "Imported cluster");
  assert.match(imported.id, /^[0-9a-f-]{36}$/i);
  assert.equal(path.dirname(imported.kubeconfigPath), path.join(appDataRoot, "kubeconfigs"));
  assert.equal(fs.readFileSync(imported.kubeconfigPath, "utf8"), fs.readFileSync(sourceKubeconfig, "utf8"));

  const listAfterImport = await fetch(`${gateway.baseUrl}/clusters`, { headers: authHeaders });
  assert.equal((await listAfterImport.json()).clusters.length, 1);

  await new Promise((resolve) => setTimeout(resolve, 5));
  const renameResponse = await fetch(`${gateway.baseUrl}/clusters/${imported.id}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({ displayName: "  Renamed cluster  " }),
  });
  assert.equal(renameResponse.status, 200);
  const renamed = await renameResponse.json();
  assert.equal(renamed.displayName, "Renamed cluster");
  assert.notEqual(renamed.updatedAt, imported.updatedAt);

  const proxiedOpen = await fetch(`${gateway.baseUrl}/clusters/test/open`, {
    method: "POST",
    headers: authHeaders,
  });
  assert.deepEqual(await proxiedOpen.json(), { source: "python-open" });

  const managedCopy = imported.kubeconfigPath;
  const deleteResponse = await fetch(`${gateway.baseUrl}/clusters/${imported.id}`, {
    method: "DELETE",
    headers: authHeaders,
  });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { ok: true });
  assert.equal(fs.existsSync(managedCopy), false);
  assert.equal(fs.existsSync(sourceKubeconfig), true);
  assert.ok(cacheClearClusterIds.includes(imported.id));

  const configPath = path.join(appDataRoot, "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const externalCluster = {
    id: "external-cluster",
    displayName: "External cluster",
    kubeconfigPath: externalKubeconfig,
    lastOpened: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  config.clusters.push(externalCluster);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");

  const externalDelete = await fetch(`${gateway.baseUrl}/clusters/external-cluster`, {
    method: "DELETE",
    headers: authHeaders,
  });
  assert.equal(externalDelete.status, 200);
  assert.equal(fs.existsSync(externalKubeconfig), true);
  assert.ok(cacheClearClusterIds.includes("external-cluster"));

  const missingRename = await fetch(`${gateway.baseUrl}/clusters/not-found`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({ displayName: "Nope" }),
  });
  assert.equal(missingRename.status, 404);
  assert.equal((await missingRename.json()).detail.code, "CLUSTER_NOT_FOUND");

  const updatedSettings = settings();
  const updateResponse = await fetch(`${gateway.baseUrl}/settings`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({ settings: updatedSettings }),
  });
  assert.equal(updateResponse.status, 200);

  const auditResponse = await fetch(`${gateway.baseUrl}/audit?limit=50`, { headers: authHeaders });
  const audit = await auditResponse.json();
  const actions = audit.items.map((item) => `${item.action}:${item.status}`);
  assert.ok(actions.includes("cluster.import:success"));
  assert.ok(actions.includes("cluster.import:failed"));
  assert.ok(actions.includes("cluster.rename:success"));
  assert.ok(actions.includes("cluster.rename:failed"));
  assert.ok(actions.filter((value) => value === "cluster.remove:success").length >= 2);
  assert.equal(JSON.stringify(audit).includes(updatedSettings.llm.apiKey), false);

  const jsonResponse = await fetch(`${gateway.baseUrl}/json`, { headers: authHeaders });
  assert.deepEqual(await jsonResponse.json(), { source: "python" });

  const gatewayPort = Number(new URL(gateway.baseUrl).port);
  const invalidWs = await websocketRequest(gatewayPort, "wrong-token");
  const closeFrameOffset = invalidWs.indexOf(Buffer.from([0x88]));
  assert.notEqual(closeFrameOffset, -1);
  assert.equal(invalidWs.readUInt16BE(closeFrameOffset + 2), 1008);

  const validWs = await websocketRequest(gatewayPort, TOKEN);
  assert.match(validWs.toString("latin1"), /LEGACY_OK/);
});
