const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const { createKubectlCommand } = require("../dist/main/backend/kubectl/command.js");
const { DirectApiTransport } = require("../dist/main/backend/api/directApi.js");
const { clearConnectionProfiles } = require("../dist/main/backend/api/kubeconfigProfile.js");
const { WatchManager } = require("../dist/main/backend/watch/watchManager.js");
const { ResourceWatchEventHub } = require("../dist/main/backend/watch/eventHub.js");
const { ResourceSnapshotCache } = require("../dist/main/backend/cache/resourceSnapshotCache.js");

// A kubectl watch only said "something changed", and every event sent the
// table back to the API server for the whole list. A watch over the
// cluster's own connection keeps the list in memory and applies each event to
// it, so the reload that follows is answered from there.

const FIXTURES = path.join(__dirname, "fixtures", "direct-api");
const pem = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

function pod(name, resourceVersion, extra = {}) {
  return { metadata: { name, namespace: "shop", uid: `uid-${name}`, resourceVersion }, ...extra };
}

// An API server with one pod list and a watch the test drives.
async function fakeApiServer(t, { list = () => ({ kind: "PodList", apiVersion: "v1", metadata: { resourceVersion: "10" }, items: [pod("a", "8"), pod("b", "9")] }), watchStatus = 200 } = {}) {
  const requests = [];
  const watches = [];
  const server = https.createServer({ key: pem("server.key"), cert: pem("server.crt") }, (request, response) => {
    requests.push(request.url);
    const url = new URL(request.url, "https://x");
    if (url.searchParams.get("watch") === "1") {
      if (watchStatus !== 200) {
        response.writeHead(watchStatus, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ kind: "Status", reason: "Forbidden", message: 'pods is forbidden: User "u" cannot watch resource "pods"' }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.flushHeaders();
      watches.push({ resourceVersion: url.searchParams.get("resourceVersion"), send: (event) => response.write(`${JSON.stringify(event)}\n`), end: () => response.end() });
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(list()));
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, requests, watches };
}

function kubeconfigFor(t, port, user = { token: "t" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-api-watch-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "config");
  fs.writeFileSync(
    file,
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      "current-context": "ctx",
      contexts: [{ name: "ctx", context: { cluster: "c", user: "u" } }],
      clusters: [{ name: "c", cluster: { server: `https://127.0.0.1:${port}`, "certificate-authority-data": Buffer.from(pem("ca.crt")).toString("base64") } }],
      users: [{ name: "u", user }],
    }),
  );
  clearConnectionProfiles();
  return file;
}

function setup(t) {
  const spawned = [];
  const spawn = (command, args) => {
    spawned.push(args.join(" "));
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.exitCode = null;
    child.kill = () => {
      child.exitCode = 0;
      setImmediate(() => child.emit("close", 0));
      return true;
    };
    setImmediate(() => child.emit("spawn"));
    return child;
  };
  const events = [];
  const hub = new ResourceWatchEventHub();
  hub.subscribe((event) => events.push(event));
  const direct = new DirectApiTransport(() => {});
  const manager = new WatchManager(() => {}, new ResourceSnapshotCache(), hub, spawn, Date.now, 100, direct);
  t.after(async () => {
    await manager.close();
    direct.close();
  });
  return { manager, hub, events, spawned };
}

const watchCommand = (kubeconfig, namespace = "shop") =>
  createKubectlCommand({
    clusterId: "c1",
    kubeconfigPath: kubeconfig,
    args: ["get", "pods", "-o", "json", "--watch-only=true", "--output-watch-events=true", ...(namespace === "all" ? ["-A"] : ["-n", namespace])],
    timeoutSeconds: 0,
    maxOutputBytes: 0,
    directApi: true,
  });

async function until(condition, label) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("a watch over the API keeps the list current and the reload is answered from memory", async (t) => {
  const server = await fakeApiServer(t);
  const kubeconfig = kubeconfigFor(t, server.port);
  const { manager, events, spawned } = setup(t);

  const started = await manager.start(watchCommand(kubeconfig), "pods", "shop");
  assert.equal(started.status, "running");
  assert.equal(started.pid, null, "no kubectl process");
  assert.match(started.commandPreview, /watch=1/);
  assert.deepEqual(spawned, []);
  assert.equal((await manager.start(watchCommand(kubeconfig), "pods", "shop")).alreadyRunning, true);

  await until(() => server.watches.length === 1, "the watch");
  assert.equal(server.watches[0].resourceVersion, "10", "the watch starts where the list ended");
  server.watches[0].send({ type: "ADDED", object: pod("c", "11") });
  server.watches[0].send({ type: "MODIFIED", object: pod("a", "12", { status: { phase: "Running" } }) });
  server.watches[0].send({ type: "DELETED", object: pod("b", "13") });
  server.watches[0].send({ type: "BOOKMARK", object: { metadata: { resourceVersion: "14" } } });
  await until(() => events.length === 3, "three changes");
  assert.deepEqual(
    events.map((event) => [event.type, event.eventType, event.namespace, event.name]),
    [
      ["resource.changed", "ADDED", "shop", "c"],
      ["resource.changed", "MODIFIED", "shop", "a"],
      ["resource.changed", "DELETED", "shop", "b"],
    ],
  );

  const snapshot = manager.listSnapshot("c1", "pods", "shop");
  assert.deepEqual(snapshot.items.map((item) => item.metadata.name).sort(), ["a", "c"]);
  assert.equal(snapshot.items.find((item) => item.metadata.name === "a").status.phase, "Running");
  assert.equal(snapshot.items[0].kind, "Pod", "items carry the kind kubectl would have filled in");
  assert.equal(manager.listSnapshot("c1", "pods", "all"), null, "a namespace watch says nothing about all namespaces");
  assert.equal(server.requests.filter((url) => !url.includes("watch=1")).length, 1, "the list was read once");

  // The server ends a long watch: it resumes from the last resourceVersion seen.
  server.watches[0].end();
  await until(() => server.watches.length === 2, "the renewed watch");
  assert.equal(server.watches[1].resourceVersion, "14");
  assert.ok(!events.some((event) => event.type === "watch.ended"), "a renewal is not an end");
});

test("a resourceVersion too old to resume from rebuilds the list and tells the table once", async (t) => {
  let listed = 0;
  const server = await fakeApiServer(t, {
    list: () => {
      listed += 1;
      return { kind: "PodList", apiVersion: "v1", metadata: { resourceVersion: String(100 * listed) }, items: listed === 1 ? [pod("a", "1")] : [pod("a", "1"), pod("z", "150")] };
    },
  });
  const kubeconfig = kubeconfigFor(t, server.port);
  const { manager, events } = setup(t);
  await manager.start(watchCommand(kubeconfig), "pods", "shop");
  await until(() => server.watches.length === 1, "the watch");
  server.watches[0].send({ type: "ERROR", object: { kind: "Status", code: 410, reason: "Expired", message: "too old resource version" } });
  await until(() => server.watches.length === 2, "the watch after the relist");
  assert.equal(server.watches[1].resourceVersion, "200");
  assert.deepEqual(
    events.map((event) => event.eventType),
    ["RESYNC"],
  );
  assert.deepEqual(
    manager
      .listSnapshot("c1", "pods", "shop")
      .items.map((item) => item.metadata.name)
      .sort(),
    ["a", "z"],
  );
});

test("a watch the server refuses ends, and the table is told", async (t) => {
  const server = await fakeApiServer(t, { watchStatus: 403 });
  const kubeconfig = kubeconfigFor(t, server.port);
  const { manager, events } = setup(t);
  await manager.start(watchCommand(kubeconfig), "pods", "shop");
  await until(() => events.some((event) => event.type === "watch.ended"), "the end");
  const ended = events.find((event) => event.type === "watch.ended");
  assert.equal(ended.status, "failed");
  assert.equal(ended.namespace, "shop");
  assert.equal(manager.listSnapshot("c1", "pods", "shop"), null);
  assert.equal(manager.status().running, 0);
});

test("an all-namespaces watch answers each namespace's list too", async (t) => {
  const server = await fakeApiServer(t, {
    list: () => ({ kind: "PodList", apiVersion: "v1", metadata: { resourceVersion: "5" }, items: [pod("a", "1"), { metadata: { name: "x", namespace: "other" } }] }),
  });
  const kubeconfig = kubeconfigFor(t, server.port);
  const { manager } = setup(t);
  await manager.start(watchCommand(kubeconfig, "all"), "pods", "all");
  assert.equal(server.requests[0], "/api/v1/pods");
  assert.deepEqual(
    manager.listSnapshot("c1", "pods", "other").items.map((item) => item.metadata.name),
    ["x"],
  );
  assert.equal(manager.listSnapshot("c1", "pods", "all").items.length, 2);
});

test("a kubeconfig the client does not handle is watched by kubectl as before", async (t) => {
  const kubeconfig = kubeconfigFor(t, 1, { "auth-provider": { name: "oidc" } });
  const { manager, spawned } = setup(t);
  const started = await manager.start(watchCommand(kubeconfig), "pods", "shop");
  assert.equal(started.pid, 4242);
  assert.equal(spawned.length, 1);
  assert.match(spawned[0], /get pods -o json --watch-only=true/);
  assert.equal(manager.listSnapshot("c1", "pods", "shop"), null);
});

test("an API watch nobody listens to is stopped after a while", async (t) => {
  const server = await fakeApiServer(t);
  const kubeconfig = kubeconfigFor(t, server.port);
  let now = 1_000_000;
  const hub = new ResourceWatchEventHub();
  const direct = new DirectApiTransport(() => {});
  const manager = new WatchManager(
    () => {},
    new ResourceSnapshotCache(),
    hub,
    undefined,
    () => now,
    100,
    direct,
  );
  t.after(async () => {
    await manager.close();
    direct.close();
  });
  await manager.start(watchCommand(kubeconfig), "pods", "shop");
  const unsubscribe = hub.subscribe(() => {}, { clusterId: "c1", resource: "pods", namespace: "shop" });
  now += 10 * 60_000;
  manager.sweepIdleApiWatches();
  assert.equal(manager.status().running, 1, "kept while a table listens");
  unsubscribe();
  now += 4 * 60_000;
  manager.sweepIdleApiWatches();
  assert.equal(manager.status().running, 1, "kept for a while after the table went away");
  now += 2 * 60_000;
  manager.sweepIdleApiWatches();
  await until(() => manager.status().running === 0, "the idle stop");
});

test("the list route answers a watched scope from memory", async (t) => {
  const http = require("node:http");
  const { handleResourceListRequest } = require("../dist/main/backend/routes/resourceLists.js");
  const calls = [];
  const runner = {
    async runJson(command) {
      calls.push(command.args.join(" "));
      return { items: [] };
    },
    async run() {
      return { ok: true, stdout: "", stderr: "", commandPreview: "", returnCode: 0 };
    },
  };
  const configStore = { load: () => ({ settings: { kubectlPath: "kubectl" }, clusters: [] }), getCluster: () => ({ id: "c1", kubeconfigPath: "" }) };
  const usageHistory = { ensureCluster() {}, backfillPodMetrics() {}, attributePods() {} };
  const watched = (clusterId, resource, namespace) =>
    resource === "configmaps" && namespace === "shop" ? { kind: "ConfigMapList", items: [{ kind: "ConfigMap", metadata: { uid: "u", name: "settings", namespace: "shop" }, data: { a: "1" } }] } : null;
  const server = http.createServer((request, response) => {
    handleResourceListRequest(
      request,
      response,
      new URL(request.url, "http://x").pathname,
      configStore,
      runner,
      new ResourceSnapshotCache(),
      () => {},
      usageHistory,
      () => true,
      () => {},
      watched,
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(() => resolve())));
  const body = await (await fetch(`http://127.0.0.1:${server.address().port}/clusters/c1/resources/configmaps?namespace=shop&forceRefresh=true`)).json();
  assert.equal(body.items[0].name, "settings");
  assert.deepEqual(calls, [], "no request to the cluster");
});

// The table reloads right after a delete or a scale made from KubeDeck, often
// before the watch has reported it; memory would still show the old state.
test("right after a change from KubeDeck, lists come from the API server until the watch reports it", async (t) => {
  const server = await fakeApiServer(t);
  const kubeconfig = kubeconfigFor(t, server.port);
  let now = 5_000_000;
  const hub = new ResourceWatchEventHub();
  const direct = new DirectApiTransport(() => {});
  const manager = new WatchManager(
    () => {},
    new ResourceSnapshotCache(),
    hub,
    undefined,
    () => now,
    100,
    direct,
  );
  t.after(async () => {
    await manager.close();
    direct.close();
  });
  await manager.start(watchCommand(kubeconfig), "pods", "shop");
  await until(() => server.watches.length === 1, "the watch");
  assert.notEqual(manager.listSnapshot("c1", "pods", "shop"), null);

  manager.noteMutation("c1");
  assert.equal(manager.listSnapshot("c1", "pods", "shop"), null, "not from memory before the event");
  server.watches[0].send({ type: "DELETED", object: pod("b", "11") });
  await until(() => manager.listSnapshot("c1", "pods", "shop") !== null, "the event");
  assert.deepEqual(
    manager.listSnapshot("c1", "pods", "shop").items.map((item) => item.metadata.name),
    ["a"],
  );

  // A change that never shows up here (another resource) stops counting after a moment.
  manager.noteMutation("c1");
  now += 3500;
  assert.notEqual(manager.listSnapshot("c1", "pods", "shop"), null);
});

// Reported from a real cluster: Argo CD Applications in all namespaces were
// over 64 MB of JSON. The table's load failed on its size limit while the
// watch read the same list beside it and kept every Application whole in
// memory - resource trees and sync history - and the application froze.
test("a custom resource is kept in memory as the table reads it, not whole", () => {
  const { tableProjection } = require("../dist/main/backend/resources/normalizers/index.js");
  assert.equal(tableProjection("pods"), null, "built-in types with their own columns keep the whole object");
  const project = tableProjection("applications.argoproj.io");
  const application = {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: { name: "shop", namespace: "argocd", uid: "u1", creationTimestamp: "2026-10-01T00:00:00Z", labels: { team: "a" }, annotations: { big: "x".repeat(10_000) }, resourceVersion: "7" },
    spec: { source: { repoURL: "https://example" }, destination: {} },
    status: { resources: Array.from({ length: 500 }, (_, i) => ({ name: `r${i}` })), history: [{}, {}], conditions: [{ type: "A" }, { type: "SyncError" }], sync: { status: "Synced" } },
  };
  const projected = project(application);
  assert.ok(JSON.stringify(projected).length < 600, "a few hundred bytes, not the resource tree");
  const { normalizeResourceItems } = require("../dist/main/backend/resources/normalizers/index.js");
  assert.deepEqual(normalizeResourceItems("applications.argoproj.io", [projected]), normalizeResourceItems("applications.argoproj.io", [application]), "the row is the same");
});

test("a table's load and its watch read the list once, and the load is answered from the watch", async (t) => {
  const server = await fakeApiServer(t);
  const kubeconfig = kubeconfigFor(t, server.port);
  const { manager, spawned } = setup(t);
  const [listed, started] = await Promise.all([manager.listFromApiWatch(watchCommand(kubeconfig), "pods", "shop"), manager.start(watchCommand(kubeconfig), "pods", "shop")]);
  assert.deepEqual(listed.items.map((item) => item.metadata.name).sort(), ["a", "b"]);
  assert.equal(started.status, "running");
  assert.equal(server.requests.filter((url) => !url.includes("watch=1")).length, 1, "one LIST for both");
  assert.deepEqual(spawned, []);
});

test("a table's load never starts a kubectl watch, and a scope that cannot be watched is not retried at once", async (t) => {
  const kubeconfig = kubeconfigFor(t, 1, { "auth-provider": { name: "oidc" } });
  const { manager, spawned } = setup(t);
  assert.equal(await manager.listFromApiWatch(watchCommand(kubeconfig), "pods", "shop"), null);
  assert.equal(await manager.listFromApiWatch(watchCommand(kubeconfig), "pods", "shop"), null);
  assert.deepEqual(spawned, []);
  assert.equal(manager.status().running, 0);
});
