const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { WebSocket } = require("ws");

const { startGateway } = require("../dist/main/backend/gateway.js");
const {
  buildSshCommandPreview,
  matchNodeSshWebSocket,
  normalizeSshConnectPayload,
} = require("../dist/main/backend/ssh/nodeSshWebSocket.js");

const TOKEN = "node-ssh-contract-token";

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

class FakeChannel extends EventEmitter {
  constructor(state) {
    super();
    this.state = state;
    this.stderr = new EventEmitter();
    this.destroyed = false;
  }

  write(data) {
    this.state.inputs.push(data);
    return true;
  }

  setWindow(rows, cols, height, width) {
    this.state.resizes.push({ rows, cols, height, width });
  }

  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    process.nextTick(() => this.emit("close"));
  }

  end() {
    this.close();
  }

  destroy() {
    this.close();
  }
}

class FakeSshClient extends EventEmitter {
  constructor(state) {
    super();
    this.state = state;
    this.channel = null;
    this.closed = false;
  }

  connect(config) {
    this.state.configs.push(config);
    if (this.state.failHost && config.host === this.state.failHost) {
      process.nextTick(() => this.emit("error", new Error("Authentication failed secret-password")));
      return;
    }
    process.nextTick(() => this.emit("ready"));
  }

  shell(window, callback) {
    this.state.windows.push({ ...window });
    this.channel = new FakeChannel(this.state);
    this.state.channels.push(this.channel);
    callback(undefined, this.channel);
    setTimeout(() => this.channel?.emit("data", Buffer.from("ssh-ready\r\n")), 10);
  }

  forwardOut(sourceHost, sourcePort, destinationHost, destinationPort, callback) {
    this.state.forwardOut.push({ sourceHost, sourcePort, destinationHost, destinationPort });
    callback(undefined, new PassThrough());
  }

  end() {
    this.state.clientEnds += 1;
    this.finish();
  }

  destroy() {
    this.state.clientDestroys += 1;
    this.finish();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    process.nextTick(() => this.emit("close"));
  }
}

function createSshState() {
  return {
    clients: [],
    configs: [],
    windows: [],
    channels: [],
    inputs: [],
    resizes: [],
    forwardOut: [],
    clientEnds: 0,
    clientDestroys: 0,
    failHost: "",
  };
}

function createSshFactory(state) {
  return () => {
    const client = new FakeSshClient(state);
    state.clients.push(client);
    return client;
  };
}

function waitForMessage(socket, predicate, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);
    const onMessage = (data) => {
      let parsed;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!predicate(parsed)) return;
      cleanup();
      resolve(parsed);
    };
    const onClose = (code, reason) => {
      cleanup();
      reject(new Error(`WebSocket closed early: ${code} ${reason}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
    socket.on("message", onMessage);
    socket.on("close", onClose);
  });
}

function waitForClose(socket, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(() => reject(new Error("Timed out waiting for close")), timeoutMs);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function sshUrl(baseUrl, clusterId = "cluster-a", nodeName = "node-a", token = TOKEN) {
  const url = new URL(baseUrl);
  url.protocol = "ws:";
  url.pathname = `/clusters/${clusterId}/nodes/${nodeName}/ssh`;
  url.searchParams.set("token", token);
  return url.toString();
}

async function createGateway(t, state, appDataRoot) {
  const legacy = http.createServer((request, response) => {
    if (request.url === "/health") {
      response.end("ok");
      return;
    }
    response.statusCode = 418;
    response.end("legacy");
  });
  const legacyUrl = await listen(legacy);
  const gateway = await startGateway({
    legacyBackendUrl: legacyUrl,
    sessionToken: TOKEN,
    legacyProcessId: () => 999,
    appDataRoot,
    appVersion: "2.0.0-alpha.9",
    log: () => {},
    sshClientFactory: createSshFactory(state),
  });
  t.after(async () => {
    await gateway.close();
    if (legacy.listening) await close(legacy);
  });
  return gateway;
}

function connectPayload(overrides = {}) {
  return {
    type: "connect",
    host: "10.0.0.10",
    port: 22,
    username: "devops",
    authMethod: "password",
    password: "secret-password",
    keyPath: "",
    keyPassphrase: "",
    useJumpHost: false,
    jumpHost: "",
    jumpPort: 22,
    jumpUsername: "",
    jumpAuthMethod: "agent",
    jumpPassword: "",
    jumpKeyPath: "",
    jumpKeyPassphrase: "",
    cols: 120,
    rows: 40,
    ...overrides,
  };
}

test("Node SSH route and command preview remain compatible", () => {
  assert.deepEqual(
    matchNodeSshWebSocket({ url: "/clusters/cluster-a/nodes/node-a/ssh" }),
    { clusterId: "cluster-a", name: "node-a" },
  );
  const payload = normalizeSshConnectPayload(connectPayload({
    port: 2222,
    useJumpHost: true,
    jumpHost: "jump.example.test",
    jumpPort: 2200,
    jumpUsername: "jump-user",
    jumpAuthMethod: "password",
    jumpPassword: "jump-secret",
  }));
  const preview = buildSshCommandPreview(payload);
  assert.equal(
    preview,
    "ssh -p 2222 -J jump-user@jump.example.test:2200 devops@10.0.0.10",
  );
  assert.equal(preview.includes("secret-password"), false);
  assert.equal(preview.includes("jump-secret"), false);
  assert.throws(
    () => normalizeSshConnectPayload(connectPayload({ host: "bad host" })),
    (error) => error.code === "INVALID_SSH_HOST",
  );
});

test("Node SSH password session supports output, input, resize, audit redaction, and shutdown", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-node-ssh-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = new WebSocket(sshUrl(gateway.baseUrl), {
    origin: "http://127.0.0.1:5173",
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const connectedPromise = waitForMessage(
    socket,
    (message) => message.type === "status" && message.data === "Connected",
  );
  const outputPromise = waitForMessage(
    socket,
    (message) => message.type === "output",
  );
  socket.send(JSON.stringify(connectPayload()));
  await connectedPromise;
  const output = await outputPromise;
  assert.match(output.data, /ssh-ready/);

  socket.send(JSON.stringify({ type: "input", data: "whoami\r" }));
  socket.send(JSON.stringify({ type: "resize", cols: 160, rows: 55 }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(state.inputs, ["whoami\r"]);
  assert.deepEqual(state.resizes, [{ rows: 55, cols: 160, height: 0, width: 0 }]);
  assert.equal(state.configs[0].host, "10.0.0.10");
  assert.equal(state.configs[0].password, "secret-password");
  assert.deepEqual(state.windows[0], {
    term: "xterm-256color",
    cols: 120,
    rows: 40,
    height: 0,
    width: 0,
  });

  const response = await fetch(`${gateway.baseUrl}/audit?limit=100`, {
    headers: { "X-KubeDeck-Token": TOKEN },
  });
  const auditText = JSON.stringify(await response.json());
  assert.equal(auditText.includes("secret-password"), false);
  assert.equal(auditText.includes("whoami"), false);
  assert.match(auditText, /node\.ssh/);

  const closed = waitForClose(socket);
  await gateway.close();
  await closed;
  assert.ok(state.clientEnds >= 1);
  assert.ok(state.clientDestroys >= 1);
});

test("Node SSH private key through jump host opens a forwarded target connection", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-node-ssh-jump-"));
  const keyPath = path.join(appDataRoot, "id_test");
  fs.writeFileSync(keyPath, "FAKE-PRIVATE-KEY", "utf8");
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = new WebSocket(sshUrl(gateway.baseUrl, "cluster-b", "node-b"), {
    origin: "file://",
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const connected = waitForMessage(
    socket,
    (message) => message.type === "status" && message.data === "Connected",
  );
  socket.send(JSON.stringify(connectPayload({
    authMethod: "privateKey",
    password: "",
    keyPath,
    keyPassphrase: "target-passphrase",
    useJumpHost: true,
    jumpHost: "jump.example.test",
    jumpPort: 2200,
    jumpUsername: "jump-user",
    jumpAuthMethod: "password",
    jumpPassword: "jump-secret",
  })));
  await connected;
  assert.equal(state.configs.length, 2);
  assert.equal(state.configs[0].host, "jump.example.test");
  assert.equal(state.configs[0].password, "jump-secret");
  assert.equal(state.configs[1].host, "10.0.0.10");
  assert.equal(Buffer.isBuffer(state.configs[1].privateKey), true);
  assert.equal(state.configs[1].passphrase, "target-passphrase");
  assert.ok(state.configs[1].sock);
  assert.deepEqual(state.forwardOut, [{
    sourceHost: "127.0.0.1",
    sourcePort: 0,
    destinationHost: "10.0.0.10",
    destinationPort: 22,
  }]);
  socket.send(JSON.stringify({ type: "close" }));
  await waitForClose(socket);
});

test("Node SSH rejects unauthorized websocket and redacts failed authentication", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-node-ssh-fail-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  state.failHost = "10.0.0.99";
  const gateway = await createGateway(t, state, appDataRoot);

  const unauthorized = new WebSocket(sshUrl(gateway.baseUrl, "cluster-a", "node-a", "wrong"), {
    origin: "http://127.0.0.1:5173",
  });
  await waitForClose(unauthorized);

  const socket = new WebSocket(sshUrl(gateway.baseUrl), {
    origin: "http://127.0.0.1:5173",
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const errorPromise = waitForMessage(socket, (message) => message.type === "error");
  socket.send(JSON.stringify(connectPayload({ host: "10.0.0.99" })));
  const message = await errorPromise;
  assert.equal(message.data.includes("secret-password"), false);
  assert.match(message.data, /REDACTED/);
  await waitForClose(socket);
});
