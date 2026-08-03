const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { WebSocket } = require("ws");

const { startGateway } = require("../dist/main/backend/gateway.js");
const { buildSshCommandPreview, matchNodeSshWebSocket, normalizeSshConnectPayload } = require("../dist/main/backend/ssh/nodeSshWebSocket.js");

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
    // Real ssh2 verifies the host key during the key exchange and only then
    // offers credentials, so the fake client must do the same or the contract
    // below would pass even without any verification.
    const authenticate = () => {
      this.state.authenticated.push(config.host);
      if (this.state.failHost && config.host === this.state.failHost) {
        process.nextTick(() => this.emit("error", new Error("Authentication failed secret-password")));
        return;
      }
      process.nextTick(() => this.emit("ready"));
    };
    if (typeof config.hostVerifier !== "function") {
      this.state.unverifiedHosts.push(config.host);
      authenticate();
      return;
    }
    const seed = this.state.hostKeys[config.host] ?? `key-for-${config.host}`;
    config.hostVerifier(hostKeyBlob(seed), (accepted) => {
      if (accepted) {
        authenticate();
        return;
      }
      process.nextTick(() => this.emit("error", new Error("Handshake failed: host key verification failed")));
    });
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

function hostKeyBlob(seed, algorithm = "ssh-ed25519") {
  const name = Buffer.from(algorithm, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(name.length, 0);
  return Buffer.concat([length, name, Buffer.from(seed, "utf8")]);
}

function expectedFingerprint(seed, algorithm = "ssh-ed25519") {
  return `SHA256:${crypto.createHash("sha256").update(hostKeyBlob(seed, algorithm)).digest("base64").replace(/=+$/, "")}`;
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
    hostKeys: {},
    authenticated: [],
    unverifiedHosts: [],
  };
}

/** Answers every host key prompt so pre-existing session contracts stay focused. */
function autoTrustHostKeys(socket, decision = "trust") {
  socket.on("message", (data) => {
    let parsed;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (parsed.type === "host-key-request") socket.send(JSON.stringify({ type: "host-key-decision", decision }));
  });
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

async function createGateway(t, state, appDataRoot, gatewayOverrides = {}) {
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
    ...gatewayOverrides,
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
  assert.deepEqual(matchNodeSshWebSocket({ url: "/clusters/cluster-a/nodes/node-a/ssh" }), { clusterId: "cluster-a", name: "node-a" });
  const payload = normalizeSshConnectPayload(
    connectPayload({
      port: 2222,
      useJumpHost: true,
      jumpHost: "jump.example.test",
      jumpPort: 2200,
      jumpUsername: "jump-user",
      jumpAuthMethod: "password",
      jumpPassword: "jump-secret",
    }),
  );
  const preview = buildSshCommandPreview(payload);
  assert.equal(preview, "ssh -p 2222 -J jump-user@jump.example.test:2200 devops@10.0.0.10");
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
  autoTrustHostKeys(socket);
  const connectedPromise = waitForMessage(socket, (message) => message.type === "status" && message.data === "Connected");
  const outputPromise = waitForMessage(socket, (message) => message.type === "output");
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
  autoTrustHostKeys(socket);
  const connected = waitForMessage(socket, (message) => message.type === "status" && message.data === "Connected");
  socket.send(
    JSON.stringify(
      connectPayload({
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
      }),
    ),
  );
  await connected;
  assert.equal(state.configs.length, 2);
  assert.equal(state.configs[0].host, "jump.example.test");
  assert.equal(state.configs[0].password, "jump-secret");
  assert.equal(state.configs[1].host, "10.0.0.10");
  assert.equal(Buffer.isBuffer(state.configs[1].privateKey), true);
  assert.equal(state.configs[1].passphrase, "target-passphrase");
  assert.ok(state.configs[1].sock);
  assert.deepEqual(state.forwardOut, [
    {
      sourceHost: "127.0.0.1",
      sourcePort: 0,
      destinationHost: "10.0.0.10",
      destinationPort: 22,
    },
  ]);
  socket.send(JSON.stringify({ type: "close" }));
  await waitForClose(socket);
});

async function openSshSocket(gateway, clusterId = "cluster-a", nodeName = "node-a") {
  const socket = new WebSocket(sshUrl(gateway.baseUrl, clusterId, nodeName), { origin: "http://127.0.0.1:5173" });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

function knownHostsPath(appDataRoot) {
  return path.join(appDataRoot, "hostkeys.json");
}

test("Node SSH asks before trusting an unknown host key and remembers the accepted fingerprint", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-new-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = await openSshSocket(gateway);

  const promptPromise = waitForMessage(socket, (message) => message.type === "host-key-request");
  socket.send(JSON.stringify(connectPayload()));
  const prompt = await promptPromise;

  assert.equal(prompt.data.role, "target");
  assert.equal(prompt.data.host, "10.0.0.10");
  assert.equal(prompt.data.port, 22);
  assert.equal(prompt.data.algorithm, "ssh-ed25519");
  assert.equal(prompt.data.fingerprint, expectedFingerprint("key-for-10.0.0.10"));
  // Nothing may be authenticated while the user is still deciding.
  assert.deepEqual(state.authenticated, []);
  assert.deepEqual(state.windows, []);

  const connected = waitForMessage(socket, (message) => message.type === "status" && message.data === "Connected");
  socket.send(JSON.stringify({ type: "host-key-decision", decision: "trust" }));
  await connected;
  assert.deepEqual(state.authenticated, ["10.0.0.10"]);
  assert.deepEqual(state.unverifiedHosts, []);

  const stored = JSON.parse(fs.readFileSync(knownHostsPath(appDataRoot), "utf8"));
  assert.equal(stored.version, 1);
  assert.equal(stored.hosts["10.0.0.10:22"].fingerprint, expectedFingerprint("key-for-10.0.0.10"));
  assert.equal(stored.hosts["10.0.0.10:22"].algorithm, "ssh-ed25519");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(knownHostsPath(appDataRoot)).mode & 0o777, 0o600);
  }

  const audit = await (await fetch(`${gateway.baseUrl}/audit?limit=100`, { headers: { "X-KubeDeck-Token": TOKEN } })).json();
  assert.ok(audit.items.some((item) => item.status === "host-key-trusted"));

  socket.send(JSON.stringify({ type: "close" }));
  await waitForClose(socket);
});

test("Node SSH keeps waiting for the host key decision while the terminal reports a resize", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-resize-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = await openSshSocket(gateway);

  const promptPromise = waitForMessage(socket, (message) => message.type === "host-key-request");
  socket.send(JSON.stringify(connectPayload()));
  await promptPromise;

  // xterm fits itself as soon as the confirmation changes the panel layout, so
  // the decision is not necessarily the next message on the socket.
  socket.send(JSON.stringify({ type: "resize", cols: 132, rows: 43 }));
  socket.send(JSON.stringify({ type: "input", data: "ignored\r" }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(state.authenticated, []);
  assert.deepEqual(state.inputs, []);

  const connected = waitForMessage(socket, (message) => message.type === "status" && message.data === "Connected");
  socket.send(JSON.stringify({ type: "host-key-decision", decision: "trust" }));
  await connected;
  assert.deepEqual(state.authenticated, ["10.0.0.10"]);

  socket.send(JSON.stringify({ type: "close" }));
  await waitForClose(socket);
});

test("Node SSH treats an explicit close during the host key prompt as a refusal", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-close-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = await openSshSocket(gateway);

  const promptPromise = waitForMessage(socket, (message) => message.type === "host-key-request");
  socket.send(JSON.stringify(connectPayload()));
  await promptPromise;

  const errorPromise = waitForMessage(socket, (message) => message.type === "error");
  socket.send(JSON.stringify({ type: "close" }));
  const error = await errorPromise;

  assert.equal(error.code, "SSH_HOST_KEY_REJECTED");
  assert.deepEqual(state.authenticated, []);
  assert.equal(fs.existsSync(knownHostsPath(appDataRoot)), false);
  await waitForClose(socket);
});

test("Node SSH refuses the session when the user rejects an unknown host key", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-reject-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = await openSshSocket(gateway);
  autoTrustHostKeys(socket, "reject");

  const errorPromise = waitForMessage(socket, (message) => message.type === "error");
  socket.send(JSON.stringify(connectPayload()));
  const error = await errorPromise;

  assert.equal(error.code, "SSH_HOST_KEY_REJECTED");
  assert.equal(error.data.includes("secret-password"), false);
  assert.deepEqual(state.authenticated, []);
  assert.deepEqual(state.windows, []);
  assert.equal(fs.existsSync(knownHostsPath(appDataRoot)), false);
  await waitForClose(socket);
});

test("Node SSH refuses a changed host key without offering to trust it", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-mismatch-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const remembered = { version: 1, hosts: { "10.0.0.10:22": { algorithm: "ssh-ed25519", fingerprint: expectedFingerprint("old-key"), rememberedAt: "2026-01-01T00:00:00.000Z" } } };
  fs.writeFileSync(knownHostsPath(appDataRoot), `${JSON.stringify(remembered, null, 2)}\n`, "utf8");

  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = await openSshSocket(gateway);
  let prompted = false;
  socket.on("message", (data) => {
    if (JSON.parse(data.toString()).type === "host-key-request") prompted = true;
  });

  const errorPromise = waitForMessage(socket, (message) => message.type === "error");
  socket.send(JSON.stringify(connectPayload()));
  const error = await errorPromise;

  assert.equal(error.code, "SSH_HOST_KEY_MISMATCH");
  assert.equal(prompted, false);
  assert.deepEqual(state.authenticated, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(knownHostsPath(appDataRoot), "utf8")), remembered);

  const audit = await (await fetch(`${gateway.baseUrl}/audit?limit=100`, { headers: { "X-KubeDeck-Token": TOKEN } })).json();
  assert.ok(audit.items.some((item) => item.status === "host-key-mismatch"));
  await waitForClose(socket);
});

test("Node SSH stops waiting for a host key decision after the configured timeout", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-timeout-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot, { sshHostKeyDecisionTimeoutMs: 60 });
  const socket = await openSshSocket(gateway);

  const errorPromise = waitForMessage(socket, (message) => message.type === "error");
  socket.send(JSON.stringify(connectPayload()));
  const error = await errorPromise;

  assert.equal(error.code, "SSH_HOST_KEY_TIMEOUT");
  assert.deepEqual(state.authenticated, []);
  await waitForClose(socket);
});

test("Node SSH verifies the jump host separately from the target", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-jump-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = await openSshSocket(gateway, "cluster-b", "node-b");

  const prompts = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.type !== "host-key-request") return;
    prompts.push(message.data);
    socket.send(JSON.stringify({ type: "host-key-decision", decision: "trust" }));
  });

  const connected = waitForMessage(socket, (message) => message.type === "status" && message.data === "Connected");
  socket.send(JSON.stringify(connectPayload({ useJumpHost: true, jumpHost: "jump.example.test", jumpPort: 2200, jumpUsername: "jump-user", jumpAuthMethod: "password", jumpPassword: "jump-secret" })));
  await connected;

  assert.equal(prompts.length, 2);
  assert.deepEqual(
    prompts.map((prompt) => [prompt.role, prompt.host, prompt.port]),
    [
      ["jump", "jump.example.test", 2200],
      ["target", "10.0.0.10", 22],
    ],
  );
  assert.deepEqual(state.unverifiedHosts, []);

  const stored = JSON.parse(fs.readFileSync(knownHostsPath(appDataRoot), "utf8"));
  assert.deepEqual(Object.keys(stored.hosts).sort(), ["10.0.0.10:22", "jump.example.test:2200"]);

  socket.send(JSON.stringify({ type: "close" }));
  await waitForClose(socket);
});

test("Known SSH host keys can be listed and forgotten, but never added over HTTP", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-api-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const remembered = {
    version: 1,
    hosts: {
      "10.0.0.10:22": { algorithm: "ssh-ed25519", fingerprint: expectedFingerprint("key-a"), rememberedAt: "2026-01-01T00:00:00.000Z" },
      "jump.example.test:2200": { algorithm: "ssh-rsa", fingerprint: expectedFingerprint("key-b"), rememberedAt: "2026-01-02T00:00:00.000Z" },
    },
  };
  fs.writeFileSync(knownHostsPath(appDataRoot), `${JSON.stringify(remembered, null, 2)}\n`, "utf8");
  const gateway = await createGateway(t, createSshState(), appDataRoot);
  const headers = { "X-KubeDeck-Token": TOKEN, "Content-Type": "application/json" };

  const listed = await (await fetch(`${gateway.baseUrl}/ssh/known-hosts`, { headers })).json();
  assert.deepEqual(
    listed.items.map((item) => `${item.host}:${item.port}`),
    ["10.0.0.10:22", "jump.example.test:2200"],
  );

  const unauthorized = await fetch(`${gateway.baseUrl}/ssh/known-hosts`);
  assert.equal(unauthorized.status, 401);

  const created = await fetch(`${gateway.baseUrl}/ssh/known-hosts`, { method: "POST", headers, body: JSON.stringify({ host: "evil.example.test", port: 22, fingerprint: "SHA256:whatever" }) });
  assert.equal(created.status, 405);

  const removed = await (await fetch(`${gateway.baseUrl}/ssh/known-hosts`, { method: "DELETE", headers, body: JSON.stringify({ host: "10.0.0.10", port: 22 }) })).json();
  assert.equal(removed.removed, true);

  const remaining = await (await fetch(`${gateway.baseUrl}/ssh/known-hosts`, { headers })).json();
  assert.deepEqual(
    remaining.items.map((item) => item.host),
    ["jump.example.test"],
  );

  const invalid = await fetch(`${gateway.baseUrl}/ssh/known-hosts`, { method: "DELETE", headers, body: JSON.stringify({ host: "", port: 22 }) });
  assert.equal(invalid.status, 422);
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
  autoTrustHostKeys(socket);
  const errorPromise = waitForMessage(socket, (message) => message.type === "error");
  socket.send(JSON.stringify(connectPayload({ host: "10.0.0.99" })));
  const message = await errorPromise;
  assert.equal(message.data.includes("secret-password"), false);
  assert.match(message.data, /REDACTED/);
  await waitForClose(socket);
});
