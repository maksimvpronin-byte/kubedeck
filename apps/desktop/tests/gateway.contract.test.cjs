const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const net = require("node:net");
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
    socket.on("end", () => resolve(Buffer.concat(chunks)));
    socket.on("close", () => resolve(Buffer.concat(chunks)));
    socket.on("error", reject);
  });
}

test("Node Gateway contract", async (t) => {
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
    log: () => {},
  });

  t.after(async () => {
    await gateway.close();
    if (legacy.listening) await close(legacy);
  });

  const health = await fetch(`${gateway.baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).runtime, "node");

  const unauthorized = await fetch(`${gateway.baseUrl}/migration/status`);
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).detail.code, "UNAUTHORIZED");

  const status = await fetch(`${gateway.baseUrl}/migration/status`, {
    headers: { "X-KubeDeck-Token": TOKEN },
  });
  const migration = await status.json();
  assert.equal(migration.routes.totalExisting, 49);
  assert.equal(migration.routes.nodeOwned, 1);
  assert.equal(migration.routes.pythonOwned, 48);
  assert.equal(migration.legacyBackend.healthy, true);

  const jsonResponse = await fetch(`${gateway.baseUrl}/json`, {
    headers: { "X-KubeDeck-Token": TOKEN },
  });
  assert.deepEqual(await jsonResponse.json(), { source: "python" });

  const textResponse = await fetch(`${gateway.baseUrl}/text`, {
    headers: { "X-KubeDeck-Token": TOKEN },
  });
  assert.match(textResponse.headers.get("content-type"), /^text\/plain/);
  assert.equal(await textResponse.text(), "legacy text");

  const statusResponse = await fetch(`${gateway.baseUrl}/missing`, {
    headers: { "X-KubeDeck-Token": TOKEN },
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
    headers: { "X-KubeDeck-Token": TOKEN },
  });
  assert.equal(unavailable.status, 502);
  assert.equal((await unavailable.json()).detail.code, "LEGACY_BACKEND_UNAVAILABLE");
});
