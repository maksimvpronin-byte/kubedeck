const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const WebSocket = require("ws");

const {
  ResourceSnapshotCache,
} = require("../dist/main/backend/cache/resourceSnapshotCache.js");
const {
  createKubectlCommand,
} = require("../dist/main/backend/kubectl/command.js");
const { startGateway } = require("../dist/main/backend/gateway.js");
const {
  ResourceWatchEventHub,
  resourceWatchEventMatches,
} = require("../dist/main/backend/watch/eventHub.js");
const {
  WatchManager,
} = require("../dist/main/backend/watch/watchManager.js");

const TOKEN = "watch-contract-test-token";

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

function createWatchSpawn(state) {
  return (executable, args) => {
    const child = new EventEmitter();
    child.pid = 10_000 + state.children.length;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.killed = false;
    child.exitCode = null;
    child.kill = (signal = "SIGTERM") => {
      if (child.killed && signal !== "SIGKILL") return true;
      child.killed = true;
      state.kills.push(signal);
      process.nextTick(() => {
        child.exitCode = null;
        child.stdout.end();
        child.stderr.end();
        child.emit("close", null, signal);
      });
      return true;
    };
    state.commands.push({ executable, args: [...args] });
    state.children.push(child);
    process.nextTick(() => child.emit("spawn"));
    return child;
  };
}

function nextMessage(socket, predicate = () => true, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket message timeout"));
    }, timeoutMs);
    const onMessage = (raw) => {
      const value = JSON.parse(raw.toString("utf8"));
      if (!predicate(value)) return;
      cleanup();
      resolve(value);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}


test("resource watch event filters preserve all, cluster, and namespace semantics", () => {
  const namespaced = {
    type: "resource.changed",
    clusterId: "cluster-a",
    watchId: "watch-a",
    resource: "pods",
    namespace: "default",
    name: "demo",
    eventType: "MODIFIED",
    cacheInvalidations: 1,
    at: 1,
  };
  assert.equal(
    resourceWatchEventMatches(namespaced, {
      clusterId: "cluster-a",
      resource: "PODS",
      namespace: "all",
    }),
    true,
  );
  assert.equal(
    resourceWatchEventMatches(namespaced, {
      clusterId: "cluster-a",
      resource: "pods",
      namespace: "default",
    }),
    true,
  );
  assert.equal(
    resourceWatchEventMatches(namespaced, {
      clusterId: "cluster-a",
      resource: "pods",
      namespace: "kube-system",
    }),
    false,
  );
  assert.equal(
    resourceWatchEventMatches(
      { ...namespaced, resource: "nodes", namespace: "_cluster" },
      { clusterId: "cluster-a", resource: "nodes", namespace: "_cluster" },
    ),
    true,
  );
});

test("Node WatchManager stops active kubectl watches during shutdown", async () => {
  const state = { commands: [], children: [], kills: [] };
  const manager = new WatchManager(
    () => {},
    { clearResource: () => 0 },
    new ResourceWatchEventHub(),
    createWatchSpawn(state),
  );
  await manager.start(
    createKubectlCommand({
      clusterId: "cluster-a",
      kubectlPath: "kubectl",
      args: ["get", "pods", "-o", "json", "--watch=true", "--output-watch-events=true", "-A"],
      timeoutSeconds: 0,
      maxOutputBytes: 0,
    }),
    "pods",
    "all",
  );
  await manager.close();
  assert.equal(manager.activeCount(), 0);
  assert.deepEqual(state.kills, ["SIGTERM"]);
});

test("Node WatchManager deduplicates, invalidates matching cache, publishes events, and stops", async () => {
  const state = { commands: [], children: [], kills: [] };
  const cache = new ResourceSnapshotCache();
  const hub = new ResourceWatchEventHub();
  const manager = new WatchManager(
    () => {},
    cache,
    hub,
    createWatchSpawn(state),
  );
  cache.set("cluster-a", "pods", "default", {
    items: [{ uid: "1", name: "demo", namespace: "default" }],
    rawCount: 1,
  });
  cache.set("cluster-a", "pods", "all", {
    items: [{ uid: "1", name: "demo", namespace: "default" }],
    rawCount: 1,
  });
  cache.set("cluster-a", "services", "default", {
    items: [{ uid: "2", name: "demo", namespace: "default" }],
    rawCount: 1,
  });
  const events = [];
  const unsubscribe = hub.subscribe((event) => events.push(event));
  const command = createKubectlCommand({
    clusterId: "cluster-a",
    kubeconfigPath: "C:\\temp\\cluster.yaml",
    kubectlPath: "kubectl",
    args: [
      "get",
      "pods",
      "-o",
      "json",
      "--watch=true",
      "--output-watch-events=true",
      "-A",
    ],
    timeoutSeconds: 0,
    maxOutputBytes: 0,
  });

  const started = await manager.start(command, "pods", "all");
  assert.equal(started.alreadyRunning, false);
  assert.equal(manager.activeCount(), 1);
  assert.deepEqual(state.commands[0].args.slice(-7), command.args);

  const duplicate = await manager.start(command, "pods", "all");
  assert.equal(duplicate.alreadyRunning, true);
  assert.equal(duplicate.id, started.id);
  assert.equal(state.children.length, 1);

  state.children[0].stdout.write(
    JSON.stringify({
      type: "MODIFIED",
      object: { metadata: { name: "demo", namespace: "default" } },
    }) + "\n",
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(cache.get("cluster-a", "pods", "default"), null);
  assert.equal(cache.get("cluster-a", "pods", "all"), null);
  assert.notEqual(cache.get("cluster-a", "services", "default"), null);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "resource.changed");
  assert.equal(events[0].namespace, "default");
  assert.equal(events[0].eventType, "MODIFIED");
  assert.equal(events[0].cacheInvalidations, 2);

  const stopped = await manager.stop(started.id);
  assert.equal(stopped.ok, true);
  assert.equal(stopped.watch.status, "stopped");
  assert.equal(manager.activeCount(), 0);
  assert.deepEqual(state.kills, ["SIGTERM"]);
  unsubscribe();
  await manager.close();
});

test("Node Gateway owns watch HTTP and resource watch WebSocket contracts", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-watch-"));
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
  const state = { commands: [], children: [], kills: [] };
  const gateway = await startGateway({
    legacyBackendUrl: legacyUrl,
    sessionToken: TOKEN,
    legacyProcessId: () => 999,
    appDataRoot,
    appVersion: "2.0.0-alpha.6",
    log: () => {},
    spawnKubectl: createWatchSpawn(state),
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
    body: JSON.stringify({ sourcePath: source, displayName: "Watch cluster" }),
  });
  assert.equal(importedResponse.status, 200);
  const cluster = await importedResponse.json();

  const statusBefore = await fetch(`${gateway.baseUrl}/watches/status`, { headers });
  assert.equal(statusBefore.status, 200);
  assert.equal((await statusBefore.json()).running, 0);

  const startResponse = await fetch(
    `${gateway.baseUrl}/clusters/${cluster.id}/watches`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ resource: "pods", namespace: "all" }),
    },
  );
  assert.equal(startResponse.status, 200);
  const watch = await startResponse.json();
  assert.equal(watch.alreadyRunning, false);
  assert.equal(watch.status, "running");
  assert.deepEqual(state.commands[0].args.slice(-7), [
    "get",
    "pods",
    "-o",
    "json",
    "--watch=true",
    "--output-watch-events=true",
    "-A",
  ]);

  const wsUrl = gateway.baseUrl
    .replace(/^http:/, "ws:")
    .concat(
      `/clusters/${cluster.id}/resources/pods/watch-events?namespace=all&token=${TOKEN}`,
    );
  const socket = new WebSocket(wsUrl, { origin: "http://127.0.0.1:5173" });
  const statusPromise = nextMessage(socket, (message) => message.type === "status");
  await waitForOpen(socket);
  t.after(() => socket.close());
  const statusMessage = await statusPromise;
  assert.equal(statusMessage.data, "connected");
  assert.equal(statusMessage.namespace, "all");
  const pongPromise = nextMessage(socket, (message) => message.type === "pong");
  socket.send("ping");
  const pong = await pongPromise;
  assert.equal(pong.type, "pong");

  const changedPromise = nextMessage(
    socket,
    (message) => message.type === "resource.changed",
  );
  state.children[0].stdout.write(
    JSON.stringify({
      type: "ADDED",
      object: { metadata: { name: "demo", namespace: "default" } },
    }) + "\n",
  );
  const changed = await changedPromise;
  assert.equal(changed.clusterId, cluster.id);
  assert.equal(changed.resource, "pods");
  assert.equal(changed.namespace, "default");
  assert.equal(changed.name, "demo");
  assert.equal(changed.eventType, "ADDED");

  const duplicateResponse = await fetch(
    `${gateway.baseUrl}/clusters/${cluster.id}/watches`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ resource: "pods", namespace: "all" }),
    },
  );
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicate.alreadyRunning, true);
  assert.equal(duplicate.id, watch.id);

  const migrationResponse = await fetch(`${gateway.baseUrl}/migration/status`, {
    headers,
  });
  const migration = await migrationResponse.json();
  assert.equal(migration.routes.nodeOwned, 45);
  assert.equal(migration.routes.pythonOwned, 4);
  assert.equal(migration.processes.watches, 1);
  assert.equal(migration.processes.source, "hybrid");

  const stopResponse = await fetch(`${gateway.baseUrl}/watches/${watch.id}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(stopResponse.status, 200);
  assert.equal((await stopResponse.json()).watch.status, "stopped");
});

test("invalid watch WebSocket origin is rejected with policy violation", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-watch-origin-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const legacy = http.createServer((request, response) => response.end("ok"));
  const legacyUrl = await listen(legacy);
  const gateway = await startGateway({
    legacyBackendUrl: legacyUrl,
    sessionToken: TOKEN,
    legacyProcessId: () => null,
    appDataRoot,
    appVersion: "2.0.0-alpha.6",
    log: () => {},
    spawnKubectl: createWatchSpawn({ commands: [], children: [], kills: [] }),
  });
  t.after(async () => {
    await gateway.close();
    if (legacy.listening) await close(legacy);
  });

  const wsUrl = gateway.baseUrl
    .replace(/^http:/, "ws:")
    .concat(`/clusters/test/resources/pods/watch-events?namespace=all&token=${TOKEN}`);
  const code = await new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { origin: "https://example.invalid" });
    const timer = setTimeout(() => reject(new Error("WebSocket close timeout")), 3000);
    socket.once("close", (closeCode) => {
      clearTimeout(timer);
      resolve(closeCode);
    });
    socket.once("error", () => {
      // ws emits an error before the close event for rejected upgrades.
    });
  });
  assert.equal(code, 1008);
});
