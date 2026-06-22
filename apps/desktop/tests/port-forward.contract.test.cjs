const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const { createKubectlCommand } = require("../dist/main/backend/kubectl/command.js");
const { startGateway } = require("../dist/main/backend/gateway.js");
const {
  PortForwardManager,
} = require("../dist/main/backend/portForward/portForwardManager.js");

const TOKEN = "port-forward-contract-token";

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

function createPortForwardSpawn(state, mode = "ready") {
  return (executable, args) => {
    const child = new EventEmitter();
    child.pid = 20_000 + state.children.length;
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
        child.stdout.end();
        child.stderr.end();
        child.emit("close", null, signal);
      });
      return true;
    };
    state.commands.push({ executable, args: [...args] });
    state.children.push(child);
    process.nextTick(() => {
      child.emit("spawn");
      if (mode === "ready") {
        child.stderr.write("Forwarding from 127.0.0.1:63001 -> 8080\n");
      } else if (mode === "failed") {
        child.stderr.write("error: unable to listen on port 63001: address already in use\n");
      }
    });
    return child;
  };
}

function commandFactory(localPort) {
  return createKubectlCommand({
    clusterId: "cluster-a",
    kubeconfigPath: "C:\\temp\\cluster.yaml",
    kubectlPath: "kubectl",
    args: [
      "port-forward",
      "--address",
      "127.0.0.1",
      "-n",
      "default",
      "service/demo",
      `${localPort}:8080`,
    ],
    timeoutSeconds: 0,
    maxOutputBytes: 0,
  });
}

test("Node PortForwardManager starts, deduplicates, lists, and stops sessions", async () => {
  const state = { commands: [], children: [], kills: [] };
  const manager = new PortForwardManager(() => {}, {
    spawnProcess: createPortForwardSpawn(state),
    portProbe: async () => true,
    random: () => 0,
    readinessTimeoutMs: 100,
    stopTimeoutMs: 100,
  });
  const input = {
    resource: "service",
    namespace: "default",
    name: "demo",
    localPort: 0,
    remotePort: 8080,
  };

  const [started, concurrentDuplicate] = await Promise.all([
    manager.start(commandFactory, "cluster-a", input),
    manager.start(commandFactory, "cluster-a", input),
  ]);
  assert.equal(started.status, "running");
  assert.equal(concurrentDuplicate.id, started.id);
  assert.equal(concurrentDuplicate.alreadyRunning, true);
  assert.equal(started.localPort, 62000);
  assert.equal(started.url, "http://127.0.0.1:62000");
  assert.equal(started.source, "kubedeck");
  assert.equal(started.stoppable, true);
  assert.equal(started.alreadyRunning, false);
  assert.equal(manager.activeCount(), 1);
  assert.equal(state.commands.length, 1);
  assert.deepEqual(
    state.commands[0].args.slice(-7),
    [
      "port-forward",
      "--address",
      "127.0.0.1",
      "-n",
      "default",
      "service/demo",
      "62000:8080",
    ],
  );

  const duplicate = await manager.start(commandFactory, "cluster-a", input);
  assert.equal(duplicate.id, started.id);
  assert.equal(duplicate.alreadyRunning, true);
  assert.equal(state.commands.length, 1);
  assert.equal(manager.list().length, 1);

  const stopped = await manager.stop(started.id, true);
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.stoppedByUser, true);
  assert.equal(manager.activeCount(), 0);
  assert.deepEqual(state.kills, ["SIGTERM"]);

  await manager.start(commandFactory, "cluster-a", input);
  assert.equal(await manager.stopCluster("cluster-a"), 1);
  assert.equal(manager.activeCount(), 0);
  assert.deepEqual(state.kills, ["SIGTERM", "SIGTERM"]);

  await manager.start(commandFactory, "cluster-a", input);
  await manager.close();
  assert.equal(manager.activeCount(), 0);
  assert.deepEqual(state.kills, ["SIGTERM", "SIGTERM", "SIGTERM"]);
});

test("Node PortForwardManager rejects occupied ports and startup errors", async () => {
  const occupied = new PortForwardManager(() => {}, {
    spawnProcess: createPortForwardSpawn({ commands: [], children: [], kills: [] }),
    portProbe: async () => false,
  });
  await assert.rejects(
    occupied.start(commandFactory, "cluster-a", {
      resource: "service",
      namespace: "default",
      name: "demo",
      localPort: 63001,
      remotePort: 8080,
    }),
    (error) => error.code === "LOCAL_PORT_IN_USE" && error.statusCode === 409,
  );
  await occupied.close();

  const state = { commands: [], children: [], kills: [] };
  const failed = new PortForwardManager(() => {}, {
    spawnProcess: createPortForwardSpawn(state, "failed"),
    portProbe: async () => true,
    readinessTimeoutMs: 100,
    stopTimeoutMs: 100,
  });
  await assert.rejects(
    failed.start(commandFactory, "cluster-a", {
      resource: "service",
      namespace: "default",
      name: "demo",
      localPort: 63001,
      remotePort: 8080,
    }),
    (error) =>
      error.code === "PORT_FORWARD_FAILED" &&
      /address already in use/i.test(error.rawStderr),
  );
  assert.equal(failed.activeCount(), 0);
  await failed.close();
});

test("Node Gateway owns Port Forward HTTP contracts and reports process count", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-port-forward-"));
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
    appVersion: "2.0.0-alpha.7",
    log: () => {},
    spawnKubectl: createPortForwardSpawn(state),
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
    body: JSON.stringify({ sourcePath: source, displayName: "Port forward cluster" }),
  });
  assert.equal(importedResponse.status, 200);
  const cluster = await importedResponse.json();

  const emptyList = await fetch(`${gateway.baseUrl}/port-forwards`, { headers });
  assert.deepEqual(await emptyList.json(), { items: [] });

  const invalidNamespace = await fetch(
    `${gateway.baseUrl}/clusters/${cluster.id}/port-forwards`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        resource: "service",
        namespace: "all",
        name: "demo",
        localPort: 0,
        remotePort: 8080,
      }),
    },
  );
  assert.equal(invalidNamespace.status, 400);
  assert.equal((await invalidNamespace.json()).detail.code, "INVALID_NAMESPACE");

  const startResponse = await fetch(
    `${gateway.baseUrl}/clusters/${cluster.id}/port-forwards`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        resource: "services",
        namespace: "default",
        name: "demo",
        localPort: 0,
        remotePort: 8080,
      }),
    },
  );
  assert.equal(startResponse.status, 200);
  const session = await startResponse.json();
  assert.equal(session.resource, "service");
  assert.equal(session.status, "running");
  assert.match(session.commandPreview, /--address 127\.0\.0\.1/);

  const migrationResponse = await fetch(`${gateway.baseUrl}/migration/status`, {
    headers,
  });
  const migration = await migrationResponse.json();
  assert.equal(migration.routes.nodeOwned, 42);
  assert.equal(migration.routes.pythonOwned, 7);
  assert.equal(migration.processes.portForwards, 1);

  const listResponse = await fetch(`${gateway.baseUrl}/port-forwards`, { headers });
  const list = await listResponse.json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].id, session.id);

  const stopResponse = await fetch(
    `${gateway.baseUrl}/port-forwards/${encodeURIComponent(session.id)}`,
    { method: "DELETE", headers },
  );
  assert.equal(stopResponse.status, 200);
  assert.deepEqual(await stopResponse.json(), { ok: true });

  const missingResponse = await fetch(
    `${gateway.baseUrl}/port-forwards/${encodeURIComponent(session.id)}`,
    { method: "DELETE", headers },
  );
  assert.equal(missingResponse.status, 404);
  assert.equal((await missingResponse.json()).detail.code, "PORT_FORWARD_NOT_FOUND");
  assert.equal(state.kills.length, 1);
});
