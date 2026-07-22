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
  matchPodTerminalWebSocket,
  terminalShellCommand,
} = require("../dist/main/backend/terminal/podTerminalWebSocket.js");

const TOKEN = "pod-terminal-contract-token";

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

function createChild(state, mode) {
  const child = new EventEmitter();
  child.pid = 30_000 + state.children.length;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.stdin.on("data", (chunk) => state.stdin.push(chunk.toString("utf8")));
  child.kill = (signal = "SIGTERM") => {
    if (child.exitCode !== null) return true;
    child.killed = true;
    state.kills.push(signal);
    process.nextTick(() => {
      child.exitCode = signal === "SIGKILL" ? -1 : 0;
      child.stdout.end();
      child.stderr.end();
      child.stdin.end();
      child.emit("close", child.exitCode, signal);
    });
    return true;
  };
  process.nextTick(() => {
    child.emit("spawn");
    if (mode === "auth-yes") {
      child.stdout.end("yes\n");
      child.stderr.end();
      child.stdin.end();
      child.exitCode = 0;
      child.emit("close", 0, null);
    } else if (mode === "auth-no") {
      child.stdout.end("no\n");
      child.stderr.end();
      child.stdin.end();
      child.exitCode = 0;
      child.emit("close", 0, null);
    } else {
      child.stdout.write("terminal-ready\r\n");
    }
  });
  state.children.push(child);
  return child;
}

function createTerminalSpawn(state, authorize = true) {
  return (executable, args) => {
    state.commands.push({ executable, args: [...args] });
    const auth = args.includes("auth") && args.includes("can-i");
    return createChild(state, auth ? (authorize ? "auth-yes" : "auth-no") : "terminal");
  };
}


function createPtyFactory(state) {
  return (executable, args, options) => {
    const dataListeners = new Set();
    const exitListeners = new Set();
    let closed = false;
    state.ptyCommands.push({ executable, args: [...args], options: { ...options } });
    const ptyProcess = {
      pid: 40_000 + state.ptyCommands.length,
      write(data) {
        state.ptyWrites.push(data);
      },
      resize(cols, rows) {
        state.ptyResizes.push({ cols, rows });
      },
      kill() {
        if (closed) return;
        closed = true;
        state.ptyKills += 1;
        for (const listener of exitListeners) listener({ exitCode: 0 });
      },
      onData(listener) {
        dataListeners.add(listener);
        return { dispose: () => dataListeners.delete(listener) };
      },
      onExit(listener) {
        exitListeners.add(listener);
        return { dispose: () => exitListeners.delete(listener) };
      },
    };
    process.nextTick(() => {
      for (const listener of dataListeners) listener("pty-ready\r\n");
    });
    return ptyProcess;
  };
}

function waitForMessage(socket, predicate, timeoutMs = 2000) {
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

function waitForClose(socket, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(() => reject(new Error("Timed out waiting for close")), timeoutMs);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function terminalUrl(baseUrl, clusterId, shell = "auto", token = TOKEN, size = {}) {
  const url = new URL(baseUrl);
  url.protocol = "ws:";
  url.pathname = `/clusters/${clusterId}/pods/default/demo/terminal`;
  url.searchParams.set("token", token);
  url.searchParams.set("container", "app");
  url.searchParams.set("shell", shell);
  if (size.cols) url.searchParams.set("cols", String(size.cols));
  if (size.rows) url.searchParams.set("rows", String(size.rows));
  return url.toString();
}

test("Pod Terminal route validation and auto-shell command remain compatible", () => {
  const request = {
    url: "/clusters/cluster-a/pods/default/demo/terminal?container=app&shell=auto",
  };
  assert.deepEqual(matchPodTerminalWebSocket(request), {
    clusterId: "cluster-a",
    namespace: "default",
    name: "demo",
    container: "app",
    shell: "auto",
    cols: 100,
    rows: 24,
  });
  const command = terminalShellCommand("auto");
  assert.match(command, /command -v bash/);
  assert.match(command, /command -v sh/);
  assert.match(command, /command -v ash/);
  assert.throws(
    () =>
      matchPodTerminalWebSocket({
        url: "/clusters/cluster-a/pods/default/demo/terminal?shell=zsh",
      }),
    (error) => error.code === "INVALID_SHELL",
  );
});


test("Node Pod Terminal uses PTY input and resize when ConPTY is available", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-terminal-pty-"));
  const source = path.join(appDataRoot, "cluster.yaml");
  fs.writeFileSync(source, "apiVersion: v1\nclusters: []\ncontexts: []\n", "utf8");
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));

  const legacy = http.createServer((request, response) => {
    if (request.url === "/health") {
      response.end("ok");
      return;
    }
    response.statusCode = 418;
    response.end("legacy");
  });
  const legacyUrl = await listen(legacy);
  const state = {
    commands: [], children: [], kills: [], stdin: [],
    ptyCommands: [], ptyWrites: [], ptyResizes: [], ptyKills: 0,
  };
  const gateway = await startGateway({
    legacyBackendUrl: legacyUrl,
    sessionToken: TOKEN,
    legacyProcessId: () => 999,
    appDataRoot,
    appVersion: "2.0.0-alpha.8",
    log: () => {},
    spawnKubectl: createTerminalSpawn(state),
    terminalPtyFactory: createPtyFactory(state),
  });
  t.after(async () => {
    await gateway.close();
    if (legacy.listening) await close(legacy);
  });

  const headers = { "Content-Type": "application/json", "X-KubeDeck-Token": TOKEN };
  const imported = await fetch(`${gateway.baseUrl}/clusters/import`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sourcePath: source, displayName: "PTY cluster" }),
  });
  const cluster = await imported.json();
  const socket = new WebSocket(terminalUrl(gateway.baseUrl, cluster.id, "bash", TOKEN, { cols: 132, rows: 31 }), {
    origin: "http://127.0.0.1:5173",
  });
  const connectedPromise = waitForMessage(
    socket,
    (message) => message.type === "status" && message.data === "connected",
  );
  const outputPromise = waitForMessage(socket, (message) => message.type === "output");
  const connected = await connectedPromise;
  const output = await outputPromise;
  assert.equal(connected.transport, "pty");
  assert.match(output.data, /pty-ready/);

  socket.send(JSON.stringify({ type: "input", data: "whoami\r" }));
  socket.send(JSON.stringify({ type: "resize", cols: 160, rows: 55 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(state.ptyWrites, ["whoami\r"]);
  assert.deepEqual(state.ptyResizes, [{ cols: 160, rows: 55 }]);
  assert.equal(state.ptyCommands.length, 1);
  assert.equal(state.ptyCommands[0].args.includes("-t"), true);
  assert.equal(state.ptyCommands[0].options.cols, 132);
  assert.equal(state.ptyCommands[0].options.rows, 31);
  if (process.platform !== "win32") {
    assert.equal(state.ptyCommands[0].executable, "/bin/sh");
    assert.deepEqual(state.ptyCommands[0].args.slice(0, 4), ["-lc", 'exec "$@"', "kubedeck-pty", "kubectl"]);
    assert.match(state.ptyCommands[0].options.env.PATH, /\/opt\/homebrew\/bin/);
  }

  socket.send(JSON.stringify({ type: "close" }));
  await waitForClose(socket);
  assert.equal(state.ptyKills, 1);
});

test("Node Gateway rejects Pod Terminal when PTY is unavailable", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-terminal-"));
  const source = path.join(appDataRoot, "cluster.yaml");
  fs.writeFileSync(
    source,
    [
      "apiVersion: v1",
      "clusters:",
      "- cluster:",
      "    server: https://127.0.0.1:6443",
      "  name: test",
      "contexts: []",
      "current-context: test",
      "",
    ].join("\n"),
    "utf8",
  );
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));

  const legacy = http.createServer((request, response) => {
    if (request.url === "/health") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.statusCode = 418;
    response.end("legacy");
  });
  const legacyUrl = await listen(legacy);
  const state = { commands: [], children: [], kills: [], stdin: [] };
  const gateway = await startGateway({
    legacyBackendUrl: legacyUrl,
    sessionToken: TOKEN,
    legacyProcessId: () => 999,
    appDataRoot,
    appVersion: "2.0.0-alpha.8",
    log: () => {},
    spawnKubectl: createTerminalSpawn(state),
    terminalPtyFactory: null,
  });
  t.after(async () => {
    await gateway.close();
    if (legacy.listening) await close(legacy);
  });

  const headers = {
    "Content-Type": "application/json",
    "X-KubeDeck-Token": TOKEN,
  };
  const importedResponse = await fetch(`${gateway.baseUrl}/clusters/import`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sourcePath: source, displayName: "Terminal cluster" }),
  });
  assert.equal(importedResponse.status, 200);
  const cluster = await importedResponse.json();

  const socket = new WebSocket(terminalUrl(gateway.baseUrl, cluster.id), {
    origin: "http://127.0.0.1:5173",
  });
  const error = await waitForMessage(socket, (message) => message.type === "error");
  assert.match(error.data, /requires node-pty/i);
  await waitForClose(socket);
  assert.equal(state.stdin.join(""), "");
  assert.equal(state.commands.filter((command) => command.args.includes("exec")).length, 0);

  const migrationResponse = await fetch(`${gateway.baseUrl}/migration/status`, { headers });
  const migration = await migrationResponse.json();
  assert.equal(migration.routes.nodeOwned, 51);
  assert.equal(migration.routes.pythonOwned, 0);
  assert.equal(migration.processes.terminals, 0);
  assert.equal(state.kills.length, 0);
});

test("Pod Terminal rejects denied kubectl auth and invalid shell", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-terminal-denied-"));
  const source = path.join(appDataRoot, "cluster.yaml");
  fs.writeFileSync(source, "apiVersion: v1\nclusters: []\ncontexts: []\n", "utf8");
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));

  const legacy = http.createServer((request, response) => {
    if (request.url === "/health") {
      response.end("ok");
      return;
    }
    response.statusCode = 418;
    response.end("legacy");
  });
  const legacyUrl = await listen(legacy);
  const state = { commands: [], children: [], kills: [], stdin: [] };
  const gateway = await startGateway({
    legacyBackendUrl: legacyUrl,
    sessionToken: TOKEN,
    legacyProcessId: () => 999,
    appDataRoot,
    appVersion: "2.0.0-alpha.8",
    log: () => {},
    spawnKubectl: createTerminalSpawn(state, false),
    terminalPtyFactory: null,
  });
  t.after(async () => {
    await gateway.close();
    if (legacy.listening) await close(legacy);
  });
  const headers = { "Content-Type": "application/json", "X-KubeDeck-Token": TOKEN };
  const imported = await fetch(`${gateway.baseUrl}/clusters/import`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sourcePath: source, displayName: "Denied cluster" }),
  });
  const cluster = await imported.json();

  const denied = new WebSocket(terminalUrl(gateway.baseUrl, cluster.id), {
    origin: "http://127.0.0.1:5173",
  });
  const error = await waitForMessage(denied, (message) => message.type === "error");
  assert.match(error.data, /auth can-i/i);
  await waitForClose(denied);
  assert.equal(state.commands.filter((command) => command.args.includes("exec")).length, 0);

  const invalid = new WebSocket(terminalUrl(gateway.baseUrl, cluster.id, "zsh"), {
    origin: "http://127.0.0.1:5173",
  });
  const closeEvent = await new Promise((resolve) => {
    invalid.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  assert.equal(closeEvent.code, 1008);
});
