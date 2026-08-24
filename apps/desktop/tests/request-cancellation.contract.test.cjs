const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const { KubectlRunner } = require("../dist/main/backend/kubectl/runner.js");
const { KubectlError } = require("../dist/main/backend/kubectl/errors.js");
const { ClusterNotFoundError } = require("../dist/main/backend/config/configStore.js");
const { ResourceSnapshotCache } = require("../dist/main/backend/cache/resourceSnapshotCache.js");
const { handleResourceListRequest } = require("../dist/main/backend/routes/resourceLists.js");
const { handleSearchRequest } = require("../dist/main/backend/routes/search.js");
const { isRequestCancelled } = require("../dist/main/backend/requestCancellation.js");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function fakeConfigStore() {
  return {
    load() {
      return {
        settings: { kubectlPath: "kubectl" },
        clusters: [{ id: "cluster-1", kubeconfigPath: "C:\\temp\\cluster-1.yaml" }],
      };
    },
    getCluster(clusterId, config = this.load()) {
      const cluster = config.clusters.find((item) => item.id === clusterId);
      if (!cluster) throw new ClusterNotFoundError(clusterId);
      return cluster;
    },
  };
}

function fakeUsageHistory() {
  return {
    ensureCluster() {},
    attributePods() {},
    backfillPodMetrics() {},
  };
}

// A kubectl that never answers on its own: the only way this process ends is
// somebody killing it, which is exactly what an abandoned request must do.
// `answer` lets one command still reply, for fan-outs that need their first
// step to finish before the rest can start.
function hangingSpawn(state, answer) {
  return (_executable, args) => {
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
      state.kills += 1;
      process.nextTick(() => child.emit("close", null, "SIGTERM"));
      return true;
    };
    state.spawns += 1;
    const reply = answer?.(args ?? []);
    if (reply !== undefined) {
      process.nextTick(() => {
        child.stdout.write(reply);
        child.stdout.end();
        child.stderr.end();
        child.exitCode = 0;
        child.emit("close", 0, null);
      });
    }
    return child;
  };
}

function waitFor(predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error("condition was not reached in time"));
      setTimeout(tick, 5);
    };
    tick();
  });
}

test("an aborted resource list request kills its kubectl processes and keeps the cache", async (t) => {
  const state = { spawns: 0, kills: 0 };
  const runner = new KubectlRunner(() => {}, hangingSpawn(state));
  const logs = [];
  const cache = new ResourceSnapshotCache();
  cache.set("cluster-1", "deployments", "default", { items: [{ uid: "1", name: "kept" }], rawCount: 1 });

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handleResourceListRequest(
      request,
      response,
      pathname,
      fakeConfigStore(),
      runner,
      cache,
      () => {},
      fakeUsageHistory(),
      () => true,
      (message) => logs.push(message),
    );
    if (!handled) {
      response.statusCode = 404;
      response.end();
    }
  });
  const baseUrl = await listen(server);
  t.after(async () => {
    await close(server);
    await runner.close();
  });

  const controller = new AbortController();
  const pending = fetch(`${baseUrl}/clusters/cluster-1/resources/pods?namespace=all&forceRefresh=true`, { signal: controller.signal });
  // Both the list and its `kubectl top` companion are running by now.
  await waitFor(() => runner.activeCount() >= 2);
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");

  await waitFor(() => runner.activeCount() === 0);
  assert.equal(state.kills >= 2, true, "every kubectl process behind the abandoned request is killed");

  // A request nobody waited for says nothing about the cluster, so what was
  // already cached for other readers stays.
  assert.equal(cache.status().entries, 1);
  assert.deepEqual(
    logs.filter((message) => message.includes("failed")),
    [],
    "a cancelled request is not logged as a failure",
  );
});

test("an aborted search stops starting the sources it has not reached yet", async (t) => {
  const state = { spawns: 0, kills: 0 };
  // Discovery is shared through a TTL cache and deliberately runs without the
  // signal of one request, so it answers here instead of hanging; everything
  // the fan-out starts afterwards belongs to this request alone.
  const apiResources = ["NAME SHORTNAMES APIVERSION NAMESPACED KIND VERBS", "pods po v1 true Pod get,list"].join("\n");
  const runner = new KubectlRunner(
    () => {},
    hangingSpawn(state, (args) => (args.includes("api-resources") ? apiResources : undefined)),
  );

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handleSearchRequest(request, response, pathname, fakeConfigStore(), runner, () => {});
    if (!handled) {
      response.statusCode = 404;
      response.end();
    }
  });
  const baseUrl = await listen(server);
  t.after(async () => {
    await close(server);
    await runner.close();
  });

  const controller = new AbortController();
  const pending = fetch(`${baseUrl}/clusters/cluster-1/search?q=nginx&namespace=all`, { signal: controller.signal });
  // Discovery plus the first sources the concurrency limit allows.
  await waitFor(() => runner.activeCount() >= 2);
  const spawnsAtAbort = state.spawns;
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");

  await waitFor(() => runner.activeCount() === 0);
  assert.equal(state.kills >= 1, true, "the sources already running are killed");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(state.spawns, spawnsAtAbort, "no further search source is started after the client is gone");
  assert.equal(runner.activeCount(), 0);
});

test("cancellation is recognised by the signal and by the kubectl error it produces", () => {
  const controller = new AbortController();
  const failure = new KubectlError({ code: "FORBIDDEN", message: "denied", rawStderr: "", commandPreview: "" });
  const cancelled = new KubectlError({ code: "KUBECTL_CANCELLED", message: "cancelled", rawStderr: "", commandPreview: "" });

  assert.equal(isRequestCancelled(failure, controller.signal), false);
  assert.equal(isRequestCancelled(cancelled, controller.signal), true);
  assert.equal(isRequestCancelled(new Error("boom"), controller.signal), false);

  controller.abort();
  // After the client is gone every error the request produces is a consequence
  // of that, whatever kubectl called it.
  assert.equal(isRequestCancelled(failure, controller.signal), true);
});
