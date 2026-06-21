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

test("Node Gateway alpha.2 config/settings/audit contract", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-gateway-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));

  const legacy = http.createServer((request, response) => {
    if (request.url === "/health") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === "/json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ source: "python" }));
      return;
    }
    if (request.url === "/text") {
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end("legacy text");
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
    appVersion: "2.0.0-alpha.2",
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
  assert.equal((await health.json()).gatewayVersion, "2.0.0-alpha.2");

  const unauthorized = await fetch(`${gateway.baseUrl}/migration/status`);
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).detail.code, "UNAUTHORIZED");

  const status = await fetch(`${gateway.baseUrl}/migration/status`, {
    headers: authHeaders,
  });
  const migration = await status.json();
  assert.equal(migration.routes.totalExisting, 49);
  assert.equal(migration.routes.nodeOwned, 5);
  assert.equal(migration.routes.pythonOwned, 44);
  assert.equal(migration.legacyBackend.healthy, true);

  const initialConfigResponse = await fetch(`${gateway.baseUrl}/config`, {
    headers: authHeaders,
  });
  const initialConfig = await initialConfigResponse.json();
  assert.equal(initialConfig.settings.kubectlPath, "kubectl");
  assert.deepEqual(initialConfig.clusters, []);

  const updatedSettings = settings();
  const updateResponse = await fetch(`${gateway.baseUrl}/settings`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({ settings: updatedSettings }),
  });
  assert.equal(updateResponse.status, 200);
  const updatedConfig = await updateResponse.json();
  assert.equal(updatedConfig.settings.llm.baseUrl, "http://127.0.0.1:1234/v1");
  assert.equal(updatedConfig.settings.llm.model, "test-model");
  assert.equal(updatedConfig.settings.ssh.defaultUsername, "user");
  assert.equal(fs.existsSync(path.join(appDataRoot, "config.backup.json")), true);

  const savedConfig = JSON.parse(
    fs.readFileSync(path.join(appDataRoot, "config.json"), "utf8"),
  );
  assert.equal(savedConfig.settings.llm.apiKey, updatedSettings.llm.apiKey);

  const appInfoResponse = await fetch(`${gateway.baseUrl}/app/info`, {
    headers: authHeaders,
  });
  const appInfo = await appInfoResponse.json();
  assert.equal(appInfo.runtime, "node");
  assert.equal(appInfo.backendVersion, "2.0.0-alpha.2");
  assert.equal(appInfo.pythonVersion, "");
  assert.equal(appInfo.settings.kubectlPath, "kubectl");
  assert.equal(appInfo.clusters, 0);

  const auditResponse = await fetch(`${gateway.baseUrl}/audit?limit=20`, {
    headers: authHeaders,
  });
  const audit = await auditResponse.json();
  assert.equal(audit.limit, 20);
  assert.equal(audit.items[0].action, "settings.update");
  assert.equal(audit.items[0].status, "success");
  assert.equal(JSON.stringify(audit).includes(updatedSettings.llm.apiKey), false);

  const invalidLimit = await fetch(`${gateway.baseUrl}/audit?limit=0`, {
    headers: authHeaders,
  });
  assert.equal(invalidLimit.status, 422);
  assert.equal((await invalidLimit.json()).detail.code, "INVALID_LIMIT");

  const invalidSettings = await fetch(`${gateway.baseUrl}/settings`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({
      settings: settings({ kubectlPath: "not-kubectl.exe" }),
    }),
  });
  assert.equal(invalidSettings.status, 400);
  assert.equal((await invalidSettings.json()).detail.code, "INVALID_SETTINGS");

  const jsonResponse = await fetch(`${gateway.baseUrl}/json`, {
    headers: authHeaders,
  });
  assert.deepEqual(await jsonResponse.json(), { source: "python" });

  const textResponse = await fetch(`${gateway.baseUrl}/text`, {
    headers: authHeaders,
  });
  assert.match(textResponse.headers.get("content-type"), /^text\/plain/);
  assert.equal(await textResponse.text(), "legacy text");

  const statusResponse = await fetch(`${gateway.baseUrl}/missing`, {
    headers: authHeaders,
  });
  assert.equal(statusResponse.status, 418);

  const gatewayPort = Number(new URL(gateway.baseUrl).port);
  const invalidWs = await websocketRequest(gatewayPort, "wrong-token");
  assert.match(invalidWs.toString("latin1"), /101 Switching Protocols/);
  const closeFrameOffset = invalidWs.indexOf(Buffer.from([0x88]));
  assert.notEqual(closeFrameOffset, -1);
  assert.equal(invalidWs.readUInt16BE(closeFrameOffset + 2), 1008);

  const validWs = await websocketRequest(gatewayPort, TOKEN);
  assert.match(validWs.toString("latin1"), /LEGACY_OK/);

  await close(legacy);
  const unavailable = await fetch(`${gateway.baseUrl}/json`, {
    headers: authHeaders,
  });
  assert.equal(unavailable.status, 502);
  assert.equal((await unavailable.json()).detail.code, "LEGACY_BACKEND_UNAVAILABLE");
});
