// Shared harness for the Node SSH contract tests: a fake ssh2 client and
// channel, a gateway wired to them, and the websocket helpers the session
// tests need. Split out of node-ssh.contract.test.cjs, which had grown past the
// 700-line limit section C set for a test file.
const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { WebSocket } = require("ws");

const { startGateway } = require("../../dist/main/backend/gateway.js");

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

module.exports = {
  TOKEN,
  autoTrustHostKeys,
  connectPayload,
  createGateway,
  createSshState,
  expectedFingerprint,
  hostKeyBlob,
  knownHostsPath,
  openSshSocket,
  sshUrl,
  waitForClose,
  waitForMessage,
};
