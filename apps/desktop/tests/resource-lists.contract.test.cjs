const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { ResourceSnapshotCache } = require("../dist/main/backend/cache/resourceSnapshotCache.js");
const { normalizeResourceItems, podSummary, nodeSummary, keyValueSummary } = require("../dist/main/backend/resources/normalizers.js");

test("Secret summary exposes metadata without values", () => {
  const row = keyValueSummary({ metadata: { name: "api-key", namespace: "tools" }, kind: "Secret", type: "Opaque", data: { token: "c2VjcmV0", password: "c2VjcmV0Mg==" } });
  assert.equal(row.type, "Opaque");
  assert.equal(row.keyCount, 2);
  assert.equal(row.keyNames, "password, token");
  assert.doesNotMatch(JSON.stringify(row), /c2VjcmV0/);
});
const { parseNodeMetrics, parsePodMetrics } = require("../dist/main/backend/resources/metrics.js");

test("node metrics preserve CPU and memory usage for used/free calculations", () => {
  const metrics = parseNodeMetrics("worker-1 125m 6% 768Mi 39%\nworker-2 1 50% 2Gi 75%\n");
  assert.deepEqual(metrics.get("worker-1"), { cpu: "125m", cpuPercent: "6%", memory: "768Mi", memoryPercent: "39%" });
  assert.deepEqual(metrics.get("worker-2"), { cpu: "1", cpuPercent: "50%", memory: "2Gi", memoryPercent: "75%" });
});
const { handleResourceListRequest, matchResourceListRoute } = require("../dist/main/backend/routes/resourceLists.js");
const { KubectlError } = require("../dist/main/backend/kubectl/errors.js");

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

function fakeConfigStore() {
  return {
    load() {
      return {
        settings: { kubectlPath: "kubectl" },
        clusters: [],
      };
    },
    getCluster(clusterId) {
      return {
        id: clusterId,
        kubeconfigPath: "C:\\temp\\cluster.yaml",
      };
    },
  };
}

test("resource normalizers preserve KubeDeck row contracts", () => {
  const pod = podSummary({
    metadata: {
      uid: "pod-uid",
      name: "demo",
      namespace: "default",
      creationTimestamp: "2026-06-22T00:00:00Z",
    },
    spec: {
      nodeName: "worker-1",
      serviceAccountName: "default",
      containers: [
        {
          name: "main",
          ports: [{ containerPort: 8080, protocol: "TCP" }],
        },
      ],
    },
    status: {
      phase: "Running",
      podIP: "10.0.0.10",
      containerStatuses: [
        {
          name: "main",
          ready: true,
          restartCount: 2,
          state: { running: { startedAt: "2026-06-22T00:01:00Z" } },
          lastState: {
            terminated: {
              reason: "Error",
              exitCode: 1,
              finishedAt: "2026-06-22T00:00:50Z",
            },
          },
        },
      ],
    },
  });

  assert.equal(pod.name, "demo");
  assert.equal(pod.ready, "1/1");
  assert.equal(pod.restarts, 2);
  assert.deepEqual(pod.containerStates, [
    {
      name: "main",
      ready: true,
      state: "ready",
      reason: "",
      message: "",
      restartCount: 2,
    },
  ]);
  assert.equal(pod.lastRestartReason, "Error");
  assert.equal(pod.lastRestartExitCode, 1);
  assert.equal(pod.ports, "8080/TCP");
  assert.equal(pod.cpuUsage, "");
  assert.equal(pod.memoryUsage, "");

  const node = nodeSummary({
    metadata: { uid: "node-uid", name: "worker-1" },
    spec: { unschedulable: true },
    status: {
      conditions: [{ type: "Ready", status: "True" }],
      addresses: [{ type: "InternalIP", address: "10.0.0.20" }],
      capacity: { cpu: "4", memory: "8Gi", pods: "110" },
      allocatable: { cpu: "3900m", memory: "7Gi", pods: "110" },
      nodeInfo: {
        operatingSystem: "linux",
        kubeletVersion: "v1.31.0",
      },
    },
  });

  assert.equal(node.status, "Ready, SchedulingDisabled");
  assert.equal(node.internalIp, "10.0.0.20");
  assert.equal(node.memoryCapacity, "8.00 GiB");

  const crdRows = normalizeResourceItems("widgets.example.io", [
    {
      apiVersion: "example.io/v1",
      kind: "Widget",
      metadata: { uid: "w1", name: "example", namespace: "default" },
      status: { phase: "Ready" },
    },
  ]);

  assert.equal(crdRows[0].crdInstance, true);
  assert.equal(crdRows[0].resource, "widgets.example.io");
  assert.equal(crdRows[0].apiVersion, "example.io/v1");
});

test("pod summary exposes per-container table indicators", () => {
  const pod = podSummary({
    metadata: {
      uid: "multi-pod-uid",
      name: "multi",
      namespace: "default",
      creationTimestamp: "2026-07-10T00:00:00Z",
    },
    spec: {
      containers: [{ name: "api" }, { name: "sidecar" }],
    },
    status: {
      phase: "Running",
      containerStatuses: [
        {
          name: "api",
          ready: true,
          restartCount: 0,
          state: { running: { startedAt: "2026-07-10T00:00:10Z" } },
        },
        {
          name: "sidecar",
          ready: false,
          restartCount: 1,
          state: { waiting: { reason: "CrashLoopBackOff", message: "back-off restarting failed container" } },
        },
      ],
    },
  });

  assert.equal(pod.ready, "1/2");
  assert.deepEqual(pod.containers, ["api", "sidecar"]);
  assert.deepEqual(pod.containerStates, [
    {
      name: "api",
      ready: true,
      state: "ready",
      reason: "",
      message: "",
      restartCount: 0,
    },
    {
      name: "sidecar",
      ready: false,
      state: "waiting",
      reason: "CrashLoopBackOff",
      message: "back-off restarting failed container",
      restartCount: 1,
    },
  ]);
});

test("resource cache expires, tracks hits, and clears by cluster", () => {
  let now = 1_000;
  const cache = new ResourceSnapshotCache(15, () => now);

  cache.set("cluster-a", "pods", "default", {
    items: [{ uid: "1", name: "demo" }],
    rawCount: 1,
  });
  cache.set("cluster-b", "nodes", "_cluster", {
    items: [{ uid: "2", name: "worker" }],
    rawCount: 1,
  });

  const cached = cache.get("cluster-a", "pods", "default");
  assert.equal(cached.cached, true);
  assert.equal(cached.cacheTtlSeconds, 15);

  const status = cache.status();
  assert.equal(status.entries, 2);
  const entry = status.items.find((item) => item.clusterId === "cluster-a");
  assert.equal(entry.hits, 1);

  assert.equal(cache.clear("cluster-a"), 1);
  assert.equal(cache.get("cluster-a", "pods", "default"), null);
  assert.notEqual(cache.get("cluster-b", "nodes", "_cluster"), null);

  now += 16_000;
  assert.equal(cache.get("cluster-b", "nodes", "_cluster"), null);
});

test("pod metrics parser supports namespaced and all-namespace output", () => {
  const namespaced = parsePodMetrics("demo-1 25m 64Mi\ndemo-2 2m 12Mi\n", false);
  assert.deepEqual(namespaced.get("demo-1"), {
    cpu: "25m",
    memory: "64Mi",
  });

  const all = parsePodMetrics("default demo-1 25m 64Mi\nkube-system coredns 3m 20Mi\n", true);
  assert.deepEqual(all.get("kube-system/coredns"), {
    cpu: "3m",
    memory: "20Mi",
  });
});

test("resource list route builds kubectl query, enriches pods, and serves verified cache", async (t) => {
  const commands = [];
  const discoveryClears = [];
  const cache = new ResourceSnapshotCache();
  const runner = {
    async runJson(command) {
      commands.push(command);
      return {
        items: [
          {
            metadata: {
              uid: "pod-uid",
              name: "demo",
              namespace: "default",
            },
            spec: {
              containers: [{ name: "main" }],
            },
            status: {
              phase: "Running",
              containerStatuses: [
                {
                  name: "main",
                  ready: true,
                  restartCount: 0,
                  state: { running: {} },
                },
              ],
            },
          },
        ],
      };
    },
    async run(command) {
      commands.push(command);
      if (command.args[0] === "top") {
        return {
          ok: true,
          stdout: "demo 25m 64Mi\n",
          stderr: "",
          commandPreview: "kubectl top pods",
          returnCode: 0,
        };
      }
      return {
        ok: true,
        stdout: "ok\n",
        stderr: "",
        commandPreview: "kubectl get --raw=/readyz",
        returnCode: 0,
      };
    },
  };

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handleResourceListRequest(
      request,
      response,
      pathname,
      fakeConfigStore(),
      runner,
      cache,
      (clusterId) => discoveryClears.push(clusterId),
      () => {},
    );
    if (!handled) {
      response.statusCode = 404;
      response.end();
    }
  });

  const baseUrl = await listen(server);
  t.after(() => close(server));

  const freshResponse = await fetch(`${baseUrl}/clusters/cluster-1/resources/pods?namespace=default&forceRefresh=true`);
  assert.equal(freshResponse.status, 200);
  const fresh = await freshResponse.json();
  assert.equal(fresh.cached, false);
  assert.equal(fresh.rawCount, 1);
  assert.equal(fresh.items[0].cpuUsage, "25m");
  assert.equal(fresh.items[0].memoryUsage, "64Mi");
  assert.deepEqual(commands[0].args, ["get", "pods", "-n", "default", "-o", "json"]);

  const cachedResponse = await fetch(`${baseUrl}/clusters/cluster-1/resources/pods?namespace=default&useCache=true`);
  assert.equal(cachedResponse.status, 200);
  const cached = await cachedResponse.json();
  assert.equal(cached.cached, true);
  assert.ok(commands.some((command) => command.args[0] === "get" && command.args[1] === "--raw=/readyz"));

  const statusResponse = await fetch(`${baseUrl}/resource-cache/status`);
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).entries, 1);

  const clearResponse = await fetch(`${baseUrl}/resource-cache/clear?cluster_id=cluster-1`, { method: "POST" });
  assert.equal(clearResponse.status, 200);
  assert.equal((await clearResponse.json()).cleared, 1);
  assert.deepEqual(discoveryClears, ["cluster-1"]);
});

test("cached rows are discarded when cluster readiness fails", async (t) => {
  const cache = new ResourceSnapshotCache();
  cache.set("cluster-1", "pods", "default", {
    items: [{ uid: "1", name: "stale", namespace: "default" }],
    rawCount: 1,
  });

  const runner = {
    async run() {
      throw new KubectlError({
        code: "NETWORK",
        message: "kubectl command failed",
        rawStderr: "connection refused",
        commandPreview: "kubectl get --raw=/readyz",
      });
    },
    async runJson() {
      throw new Error("runJson must not be called");
    },
  };

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    handleResourceListRequest(
      request,
      response,
      pathname,
      fakeConfigStore(),
      runner,
      cache,
      () => {},
      () => {},
    );
  });

  const baseUrl = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl}/clusters/cluster-1/resources/pods?namespace=default&useCache=true`);

  assert.notEqual(response.status, 200);
  const body = await response.json();
  assert.equal(body.detail.code, "NETWORK");
  assert.equal(cache.get("cluster-1", "pods", "default"), null);
});

test("resource route matcher validates query and scope", () => {
  assert.deepEqual(matchResourceListRoute("GET", "/clusters/cluster-1/resources/nodes", "/clusters/cluster-1/resources/nodes?namespace=_cluster&useCache=true"), {
    clusterId: "cluster-1",
    resource: "nodes",
    namespace: "_cluster",
    useCache: true,
    forceRefresh: false,
  });

  assert.equal(matchResourceListRoute("POST", "/clusters/cluster-1/resources/nodes", "/clusters/cluster-1/resources/nodes"), null);
});
