const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { startGateway } = require("../dist/main/backend/gateway.js");
const { createKubectlCommand } = require("../dist/main/backend/kubectl/command.js");
const { KubectlRunner } = require("../dist/main/backend/kubectl/runner.js");
const { ConfigStore } = require("../dist/main/backend/config/configStore.js");
const { AuditStore } = require("../dist/main/backend/audit/auditStore.js");

const TOKEN = "gateway-contract-test-token";

test("cluster removal stays successful when its managed kubeconfig cannot be unlinked", (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-remove-cluster-"));
  const source = path.join(appDataRoot, "source.yaml");
  fs.writeFileSync(source, "apiVersion: v1\n", "utf8");
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));

  const store = new ConfigStore(appDataRoot);
  const cluster = store.importCluster(source, "test");
  const originalUnlink = fs.unlinkSync;
  fs.unlinkSync = (target) => {
    if (target === cluster.kubeconfigPath) {
      const error = new Error("busy");
      error.code = "EBUSY";
      throw error;
    }
    return originalUnlink(target);
  };
  t.after(() => {
    fs.unlinkSync = originalUnlink;
  });

  const result = store.removeCluster(cluster.id);
  assert.equal(result.removedManagedFile, false);
  assert.deepEqual(store.listClusters(), []);
  assert.equal(fs.existsSync(cluster.kubeconfigPath), true);
});

test("config recovery uses a valid backup and preserves files on access errors", (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-config-recovery-"));
  const source = path.join(appDataRoot, "source.yaml");
  fs.writeFileSync(source, "apiVersion: v1\n", "utf8");
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));

  const store = new ConfigStore(appDataRoot);
  const cluster = store.importCluster(source, "before rename");
  store.renameCluster(cluster.id, "after rename");
  fs.writeFileSync(store.paths.config, "{broken", "utf8");

  const recovered = store.load();
  assert.equal(recovered.clusters.length, 1);
  assert.equal(recovered.clusters[0].displayName, "before rename");
  assert.equal(fs.existsSync(path.join(appDataRoot, "config.broken.json")), true);

  const configPath = store.paths.config;
  const beforeAccessError = fs.readFileSync(configPath, "utf8");
  const originalRead = fs.readFileSync;
  fs.readFileSync = (target, ...args) => {
    if (target === configPath) {
      const error = new Error("denied");
      error.code = "EACCES";
      throw error;
    }
    return originalRead(target, ...args);
  };
  try {
    assert.throws(() => store.load(), { code: "EACCES" });
  } finally {
    fs.readFileSync = originalRead;
  }
  assert.equal(fs.readFileSync(configPath, "utf8"), beforeAccessError);
});

test("audit storage rotates at its configured size without losing the newest event", (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-audit-rotation-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const audit = new AuditStore(appDataRoot, () => {}, 512);

  for (let index = 0; index < 20; index += 1) {
    audit.append({ action: "bench", status: "ok", message: `event-${index}` });
  }

  const previousPath = path.join(appDataRoot, "logs", "audit.previous.jsonl");
  assert.equal(fs.existsSync(previousPath), true);
  assert.equal(audit.read(20)[0].message, "event-19");
  for (const file of [audit.filePath, previousPath]) {
    for (const line of fs.readFileSync(file, "utf8").trim().split("\n")) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
  }
});

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

function createFakeChild(onKill) {
  const child = new EventEmitter();
  child.pid = Math.floor(Math.random() * 100000) + 1000;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.kill = () => {
    if (child.killed) return true;
    child.killed = true;
    onKill?.();
    process.nextTick(() => {
      child.exitCode = null;
      child.emit("close", null, "SIGTERM");
    });
    return true;
  };
  return child;
}

function fakeKubectlSpawn(executable, args) {
  const child = createFakeChild();

  process.nextTick(() => {
    if (String(executable).includes("missing")) {
      const error = new Error(`spawn ${executable} ENOENT`);
      error.code = "ENOENT";
      child.emit("error", error);
      return;
    }

    const kubeconfigIndex = args.indexOf("--kubeconfig");
    const kubeconfigPath = kubeconfigIndex >= 0 ? args[kubeconfigIndex + 1] : "";
    const commandArgs = args.filter((arg, index) => {
      if (arg.startsWith("--request-timeout=")) return false;
      if (index === kubeconfigIndex || index === kubeconfigIndex + 1) return false;
      return true;
    });

    let kubeconfig = "";
    if (kubeconfigPath && fs.existsSync(kubeconfigPath)) {
      kubeconfig = fs.readFileSync(kubeconfigPath, "utf8");
    }

    if (kubeconfig.includes("unavailable: true")) {
      child.stderr.write("Unable to connect to the server: connection refused");
      child.stderr.end();
      child.stdout.end();
      child.exitCode = 1;
      child.emit("close", 1, null);
      return;
    }

    if (commandArgs[0] === "version") {
      child.stdout.write(JSON.stringify({
        clientVersion: {
          gitVersion: "v1.31.0-test",
          platform: "windows/amd64",
        },
      }));
    } else if (commandArgs[0] === "cluster-info") {
      child.stdout.write("Kubernetes control plane is running");
    } else if (
      commandArgs[0] === "get" &&
      commandArgs[1] === "namespaces"
    ) {
      child.stdout.write(JSON.stringify({
        items: [
          { metadata: { name: "default" } },
          { metadata: { name: "kube-system" } },
        ],
      }));
    } else {
      child.stdout.write(JSON.stringify({ ok: true }));
    }

    child.stdout.end();
    child.stderr.end();
    child.exitCode = 0;
    child.emit("close", 0, null);
  });

  return child;
}

function hangingSpawnFactory(state) {
  return () => {
    const child = createFakeChild(() => {
      state.kills += 1;
    });
    state.children.push(child);
    return child;
  };
}

function oversizedSpawn() {
  const child = createFakeChild();
  process.nextTick(() => {
    child.stdout.write("x".repeat(100));
  });
  return child;
}

function websocketRequest(port, token, pathname = "/legacy/test/websocket") {
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
          `GET ${pathname}?token=${encodeURIComponent(token)} HTTP/1.1`,
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

test("Node Gateway alpha.3 kubectl runtime contract", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-gateway-"));
  const goodSource = path.join(appDataRoot, "good.yaml");
  const unavailableSource = path.join(appDataRoot, "unavailable.yaml");
  fs.writeFileSync(
    goodSource,
    [
      "apiVersion: v1",
      "clusters:",
      "- cluster:",
      "    server: https://10.10.10.10:6443",
      "  name: test",
      "contexts: []",
      "current-context: test",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    unavailableSource,
    "apiVersion: v1\nunavailable: true\n",
    "utf8",
  );
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));

  const legacy = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");

    if (url.pathname === "/health") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/resource-cache/clear") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ cleared: 1 }));
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
    appVersion: "2.0.0-alpha.3",
    log: () => {},
    spawnKubectl: fakeKubectlSpawn,
  });

  t.after(async () => {
    await gateway.close();
    if (legacy.listening) await close(legacy);
  });

  const authHeaders = {
    "Content-Type": "application/json",
    "X-KubeDeck-Token": TOKEN,
  };

  const migrationResponse = await fetch(`${gateway.baseUrl}/migration/status`, {
    headers: authHeaders,
  });
  const migration = await migrationResponse.json();
  assert.equal(migration.routes.totalExisting, 50);
  assert.equal(migration.routes.nodeOwned, 50);
  assert.equal(migration.routes.pythonOwned, 0);

  const kubectlStatus = await fetch(`${gateway.baseUrl}/kubectl/status`, {
    headers: authHeaders,
  });
  assert.equal(kubectlStatus.status, 200);
  const kubectlStatusBody = await kubectlStatus.json();
  assert.equal(kubectlStatusBody.ok, true);
  assert.equal(kubectlStatusBody.version.gitVersion, "v1.31.0-test");
  assert.match(kubectlStatusBody.commandPreview, /version --client -o json/);

  const noLastCluster = await fetch(`${gateway.baseUrl}/clusters/last/open`, {
    method: "POST",
    headers: authHeaders,
  });
  assert.deepEqual(await noLastCluster.json(), { cluster: null });

  const importGood = await fetch(`${gateway.baseUrl}/clusters/import`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      sourcePath: goodSource,
      displayName: "Good cluster",
    }),
  });
  const goodCluster = await importGood.json();
  assert.equal(importGood.status, 200);

  const openGood = await fetch(`${gateway.baseUrl}/clusters/${goodCluster.id}/open`, {
    method: "POST",
    headers: authHeaders,
  });
  assert.equal(openGood.status, 200);
  const opened = await openGood.json();
  assert.equal(opened.cluster.id, goodCluster.id);
  assert.equal(opened.cluster.lastOpened, true);
  assert.deepEqual(
    opened.namespaces.map((item) => item.metadata.name),
    ["default", "kube-system"],
  );

  const lastOpen = await fetch(`${gateway.baseUrl}/clusters/last/open`, {
    method: "POST",
    headers: authHeaders,
  });
  assert.equal(lastOpen.status, 200);
  assert.equal((await lastOpen.json()).cluster.id, goodCluster.id);

  const namespaces = await fetch(
    `${gateway.baseUrl}/clusters/${goodCluster.id}/namespaces`,
    { headers: authHeaders },
  );
  assert.equal(namespaces.status, 200);
  assert.equal((await namespaces.json()).items.length, 2);

  const missingCluster = await fetch(
    `${gateway.baseUrl}/clusters/not-found/namespaces`,
    { headers: authHeaders },
  );
  assert.equal(missingCluster.status, 404);
  assert.equal((await missingCluster.json()).detail.code, "CLUSTER_NOT_FOUND");

  const importMissingFile = await fetch(`${gateway.baseUrl}/clusters/import`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      sourcePath: goodSource,
      displayName: "Missing kubeconfig",
    }),
  });
  const missingFileCluster = await importMissingFile.json();
  fs.rmSync(missingFileCluster.kubeconfigPath);

  const missingFileOpen = await fetch(
    `${gateway.baseUrl}/clusters/${missingFileCluster.id}/open`,
    { method: "POST", headers: authHeaders },
  );
  assert.equal(missingFileOpen.status, 400);
  assert.equal((await missingFileOpen.json()).detail.code, "CLUSTER_UNAVAILABLE");

  const importUnavailable = await fetch(`${gateway.baseUrl}/clusters/import`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      sourcePath: unavailableSource,
      displayName: "Unavailable cluster",
    }),
  });
  const unavailableCluster = await importUnavailable.json();

  const unavailableOpen = await fetch(
    `${gateway.baseUrl}/clusters/${unavailableCluster.id}/open`,
    { method: "POST", headers: authHeaders },
  );
  assert.equal(unavailableOpen.status, 502);
  assert.equal((await unavailableOpen.json()).detail.code, "CLUSTER_UNAVAILABLE");

  const configPath = path.join(appDataRoot, "config.json");
  const desiredOrder = [unavailableCluster.id, goodCluster.id, missingFileCluster.id];
  const reorderResponse = await fetch(`${gateway.baseUrl}/clusters/order`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({ clusterIds: desiredOrder }),
  });
  assert.equal(reorderResponse.status, 200);
  const reordered = await reorderResponse.json();
  assert.deepEqual(reordered.clusters.map((cluster) => cluster.id), desiredOrder);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(configPath, "utf8")).clusters.map((cluster) => cluster.id),
    desiredOrder,
  );

  const invalidReorder = await fetch(`${gateway.baseUrl}/clusters/order`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({
      clusterIds: [unavailableCluster.id, unavailableCluster.id, missingFileCluster.id],
    }),
  });
  assert.equal(invalidReorder.status, 422);
  assert.equal((await invalidReorder.json()).detail.code, "INVALID_CLUSTER_ORDER");

  const renameAfterReorder = await fetch(`${gateway.baseUrl}/clusters/${goodCluster.id}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({ displayName: "Renamed good cluster" }),
  });
  assert.equal(renameAfterReorder.status, 200);

  const reopenAfterReorder = await fetch(`${gateway.baseUrl}/clusters/${goodCluster.id}/open`, {
    method: "POST",
    headers: authHeaders,
  });
  assert.equal(reopenAfterReorder.status, 200);

  const listAfterRenameAndOpen = await fetch(`${gateway.baseUrl}/clusters`, {
    headers: authHeaders,
  });
  assert.deepEqual(
    (await listAfterRenameAndOpen.json()).clusters.map((cluster) => cluster.id),
    desiredOrder,
  );

  const removeAfterReorder = await fetch(
    `${gateway.baseUrl}/clusters/${unavailableCluster.id}`,
    { method: "DELETE", headers: authHeaders },
  );
  assert.equal(removeAfterReorder.status, 200);

  const importAfterReorder = await fetch(`${gateway.baseUrl}/clusters/import`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ sourcePath: goodSource, displayName: "Newest cluster" }),
  });
  assert.equal(importAfterReorder.status, 200);
  const newestCluster = await importAfterReorder.json();
  const finalClusterList = await fetch(`${gateway.baseUrl}/clusters`, { headers: authHeaders });
  assert.deepEqual(
    (await finalClusterList.json()).clusters.map((cluster) => cluster.id),
    [goodCluster.id, missingFileCluster.id, newestCluster.id],
  );

  const auditText = fs.readFileSync(path.join(appDataRoot, "logs", "audit.jsonl"), "utf8");
  assert.match(auditText, /"action":"cluster.reorder"/);
  assert.doesNotMatch(auditText, new RegExp(unavailableCluster.kubeconfigPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const badConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  badConfig.settings.kubectlPath = path.join(appDataRoot, "missing", "kubectl.exe");
  fs.writeFileSync(configPath, JSON.stringify(badConfig, null, 2) + "\n", "utf8");

  const missingKubectl = await fetch(`${gateway.baseUrl}/kubectl/status`, {
    headers: authHeaders,
  });
  assert.equal(missingKubectl.status, 502);
  assert.equal((await missingKubectl.json()).detail.code, "KUBECTL_NOT_FOUND");

  const missingRoute = await fetch(`${gateway.baseUrl}/json`, {
    headers: authHeaders,
  });
  assert.equal(missingRoute.status, 404);
  assert.equal((await missingRoute.json()).detail.code, "ROUTE_NOT_FOUND");

  const gatewayPort = Number(new URL(gateway.baseUrl).port);
  const invalidWs = await websocketRequest(gatewayPort, "wrong-token");
  const closeFrameOffset = invalidWs.indexOf(Buffer.from([0x88]));
  assert.notEqual(closeFrameOffset, -1);
  assert.equal(invalidWs.readUInt16BE(closeFrameOffset + 2), 1008);

  const validWs = await websocketRequest(gatewayPort, TOKEN);
  const unknownCloseOffset = validWs.indexOf(Buffer.from([0x88]));
  assert.notEqual(unknownCloseOffset, -1);
  assert.equal(validWs.readUInt16BE(unknownCloseOffset + 2), 1008);
});

test("Node kubectl runtime enforces timeout, output limit, and shutdown", async () => {
  const timeoutState = { kills: 0, children: [] };
  const timeoutRunner = new KubectlRunner(() => {}, hangingSpawnFactory(timeoutState));

  await assert.rejects(
    timeoutRunner.run(createKubectlCommand({
      args: ["get", "pods"],
      kubectlPath: "kubectl",
      timeoutSeconds: 0.02,
      maxOutputBytes: 1024,
    })),
    (error) => error.info?.code === "TIMEOUT",
  );
  assert.equal(timeoutState.kills, 1);
  await timeoutRunner.close();

  const outputRunner = new KubectlRunner(() => {}, oversizedSpawn);
  await assert.rejects(
    outputRunner.run(createKubectlCommand({
      args: ["get", "pods", "-o", "json"],
      kubectlPath: "kubectl",
      timeoutSeconds: 5,
      maxOutputBytes: 16,
    })),
    (error) => error.info?.code === "OUTPUT_TOO_LARGE",
  );
  await outputRunner.close();

  const shutdownState = { kills: 0, children: [] };
  const shutdownRunner = new KubectlRunner(() => {}, hangingSpawnFactory(shutdownState));
  const pending = shutdownRunner.run(createKubectlCommand({
    args: ["get", "pods"],
    kubectlPath: "kubectl",
    timeoutSeconds: 0,
    maxOutputBytes: 1024,
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownRunner.activeCount(), 1);
  await shutdownRunner.close();
  await assert.rejects(
    pending,
    (error) => error.info?.code === "KUBECTL_CANCELLED",
  );
  assert.equal(shutdownState.kills, 1);
  assert.equal(shutdownRunner.activeCount(), 0);

  const abortState = { kills: 0, children: [] };
  const abortRunner = new KubectlRunner(() => {}, hangingSpawnFactory(abortState));
  const controller = new AbortController();
  const aborted = abortRunner.run(createKubectlCommand({
    args: ["get", "pods"],
    kubectlPath: "kubectl",
    timeoutSeconds: 0,
    maxOutputBytes: 1024,
  }), controller.signal);
  controller.abort();
  await assert.rejects(aborted, (error) => error.info?.code === "KUBECTL_CANCELLED");
  assert.equal(abortState.kills, 1);
  assert.equal(abortRunner.activeCount(), 0);
  await abortRunner.close();
});
