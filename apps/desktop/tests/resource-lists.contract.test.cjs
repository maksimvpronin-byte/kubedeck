const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { ResourceSnapshotCache } = require("../dist/main/backend/cache/resourceSnapshotCache.js");
const {
  normalizeResourceItems,
  podSummary,
  nodeSummary,
  keyValueSummary,
  deploymentSummary,
  nodeLabelItems,
  nodeRoles,
  nodeAnnotationItems,
} = require("../dist/main/backend/resources/normalizers.js");

test("Secret summary exposes metadata without values", () => {
  const row = keyValueSummary({ metadata: { name: "api-key", namespace: "tools" }, kind: "Secret", type: "Opaque", data: { token: "c2VjcmV0", password: "c2VjcmV0Mg==" } });
  assert.equal(row.type, "Opaque");
  assert.equal(row.keyCount, 2);
  assert.equal(row.keyNames, "password, token");
  assert.doesNotMatch(JSON.stringify(row), /c2VjcmV0/);
});
const {
  applyNamespaceMetrics,
  applyNodeDiskMetrics,
  applyNodeMetrics,
  applyPodMetrics,
  clearNodeDiskMetricsCache,
  loadNodeDiskMetrics,
  parseNodeMetrics,
  parsePodMetrics,
} = require("../dist/main/backend/resources/metrics.js");

test("node metrics preserve CPU and memory usage for used/free calculations", () => {
  const metrics = parseNodeMetrics("worker-1 125m 6% 768Mi 39%\nworker-2 1 50% 2Gi 75%\n");
  assert.deepEqual(metrics.get("worker-1"), { cpu: "125m", cpuPercent: "6%", memory: "768Mi", memoryPercent: "39%" });
  assert.deepEqual(metrics.get("worker-2"), { cpu: "1", cpuPercent: "50%", memory: "2Gi", memoryPercent: "75%" });
});

test("node list metrics use one top command regardless of node count", async () => {
  const commands = [];
  const rows = Array.from({ length: 120 }, (_, index) => ({
    uid: String(index),
    name: `worker-${index}`,
    cpuAllocatableRaw: "2",
    memoryAllocatableRaw: "2Gi",
  }));
  const runner = {
    async run(command) {
      commands.push(command);
      return {
        stdout: rows.map((row) => `${row.name} 100m 5% 512Mi 25%`).join("\n"),
      };
    },
  };
  await applyNodeMetrics(fakeConfigStore(), runner, "cluster-1", rows);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].args, ["top", "nodes", "--no-headers"]);
  assert.equal(rows[0].cpuUsage, "100m");
  assert.equal(rows[0].cpuUsageRaw, "100m");
  assert.equal(rows[119].memoryUsage, "512 MiB");
  assert.equal(rows[119].memoryUsageRaw, "512Mi");
  // The table sorts on these; the displayed values are formatted strings.
  assert.equal(rows[0].cpuUsagePercentValue, 5);
  assert.equal(rows[0].memoryUsagePercentValue, 25);
  assert.equal(
    commands.some((command) => command.args.some((arg) => arg.includes("/stats/summary"))),
    false,
  );
});

test("node disk metrics are cached per node for a TTL, then refetched, and can be cleared", async () => {
  const clusterId = "cluster-disk-cache";
  clearNodeDiskMetricsCache(clusterId);
  let clock = 2_000_000_000_000;
  let calls = 0;
  const runner = {
    async runJson(command) {
      calls += 1;
      const match = command.args[1].match(/nodes\/([^/]+)\/proxy/);
      return { node: { fs: { usedBytes: "1000", availableBytes: "9000", capacityBytes: "10000" } }, name: match[1] };
    },
  };
  const configStore = fakeConfigStore();

  const first = await loadNodeDiskMetrics(configStore, runner, clusterId, "worker-1", () => clock);
  assert.equal(calls, 1);
  assert.equal(first.diskUsagePercent, 10);

  const second = await loadNodeDiskMetrics(configStore, runner, clusterId, "worker-1", () => clock);
  assert.equal(calls, 1, "second lookup within the TTL must reuse the cached value");
  assert.equal(second.diskUsagePercent, 10);

  clock += 301_000;
  await loadNodeDiskMetrics(configStore, runner, clusterId, "worker-1", () => clock);
  assert.equal(calls, 2, "lookup past the TTL must refetch");

  clearNodeDiskMetricsCache(clusterId);
  await loadNodeDiskMetrics(configStore, runner, clusterId, "worker-1", () => clock);
  assert.equal(calls, 3, "clearNodeDiskMetricsCache must force a refetch on the next lookup");
});

test("concurrent lookups of the same node share one kubectl process", async () => {
  const clusterId = "cluster-disk-inflight";
  clearNodeDiskMetricsCache(clusterId);
  const clock = 4_000_000_000_000;
  let calls = 0;
  let release = () => {};
  const started = new Promise((resolve) => {
    release = resolve;
  });
  const runner = {
    async runJson() {
      calls += 1;
      await started;
      return { node: { fs: { usedBytes: "1000", availableBytes: "9000", capacityBytes: "10000" } } };
    },
  };
  const configStore = fakeConfigStore();

  // The nodes table, the overview and the list warm-up can all ask at once.
  const pending = [
    loadNodeDiskMetrics(configStore, runner, clusterId, "worker-1", () => clock),
    loadNodeDiskMetrics(configStore, runner, clusterId, "worker-1", () => clock),
    loadNodeDiskMetrics(configStore, runner, clusterId, "worker-1", () => clock),
  ];
  release();
  const results = await Promise.all(pending);

  assert.equal(calls, 1, "overlapping lookups of one node must not spawn one kubectl process each");
  for (const result of results) assert.equal(result.diskUsagePercent, 10);

  // Once settled, the entry is served from the cache rather than a stale promise.
  await loadNodeDiskMetrics(configStore, runner, clusterId, "worker-1", () => clock);
  assert.equal(calls, 1);
});

test("applyNodeDiskMetrics reuses the per-node cache across a bulk overview poll", async () => {
  const clusterId = "cluster-disk-cache-bulk";
  clearNodeDiskMetricsCache(clusterId);
  let clock = 3_000_000_000_000;
  let calls = 0;
  const runner = {
    async runJson(command) {
      calls += 1;
      const match = command.args[1].match(/nodes\/([^/]+)\/proxy/);
      return { node: { fs: { usedBytes: "1000", availableBytes: "9000", capacityBytes: "10000" } }, name: match[1] };
    },
  };
  const rows = [
    { uid: "n1", name: "worker-1" },
    { uid: "n2", name: "worker-2" },
  ];
  const configStore = fakeConfigStore();

  await applyNodeDiskMetrics(configStore, runner, clusterId, rows, () => clock);
  assert.equal(calls, 2);
  assert.equal(rows[0].diskUsagePercent, 10);

  await applyNodeDiskMetrics(configStore, runner, clusterId, rows, () => clock);
  assert.equal(calls, 2, "a second poll within the TTL must not spawn new kubectl calls per node");
});

test("namespace usage aggregates quota without double-counting ephemeral storage", async () => {
  const rows = [{ uid: "n1", name: "tools" }];
  const runner = {
    async run() {
      return { stdout: "tools api 250m 512Mi\n" };
    },
    async runJson() {
      return {
        items: [
          {
            metadata: { namespace: "tools" },
            status: {
              hard: { "limits.cpu": "2", "limits.memory": "4Gi", "requests.storage": "20Gi", "requests.ephemeral-storage": "5Gi", "limits.ephemeral-storage": "8Gi" },
              used: { "requests.storage": "2Gi", "requests.ephemeral-storage": "1Gi", "limits.ephemeral-storage": "3Gi" },
            },
          },
        ],
      };
    },
  };
  await applyNamespaceMetrics(fakeConfigStore(), runner, "cluster-1", rows);
  assert.equal(rows[0].namespaceCpuUsagePercent, 13);
  assert.equal(rows[0].namespaceMemoryUsagePercent, 13);
  assert.equal(rows[0].namespaceStorageQuota, "28 GiB");
  assert.equal(rows[0].namespaceStorageUsed, "5 GiB");
  assert.equal(rows[0].namespaceStorageUsagePercent, 18);
});

test("pod metrics use limits as denominator and keep unbounded pods percentage-free", async () => {
  const rows = [
    { uid: "p1", name: "api", namespace: "tools", podCpuLimitValue: 500, podMemoryLimitValue: 1024 ** 3 },
    { uid: "p2", name: "worker", namespace: "tools", podCpuLimitValue: null, podMemoryLimitValue: null },
  ];
  const runner = {
    async run() {
      return { stdout: "tools api 125m 256Mi\ntools worker 50m 64Mi\n" };
    },
  };
  await applyPodMetrics(fakeConfigStore(), runner, "cluster-1", "all", rows);
  assert.equal(rows[0].podCpuUsagePercent, 25);
  assert.equal(rows[0].podMemoryUsagePercent, 25);
  assert.equal(rows[1].podCpuUsagePercent, null);
  assert.equal(rows[1].podMemoryUsagePercent, null);
});

test("pods without a limit fall back to their request, unclamped", async () => {
  const rows = [
    // A limit wins over the request, and its ratio stays clamped.
    { uid: "p1", name: "api", namespace: "tools", podCpuLimitValue: 500, podCpuRequestValue: 100, podMemoryLimitValue: 1024 ** 3, podMemoryRequestValue: 256 * 1024 ** 2 },
    // No CPU limit: 125m against a 50m request is 250%, which must not be clamped.
    { uid: "p2", name: "worker", namespace: "tools", podCpuLimitValue: null, podCpuRequestValue: 50, podMemoryLimitValue: null, podMemoryRequestValue: 512 * 1024 ** 2 },
    // Neither limit nor request leaves both ratios undefined.
    { uid: "p3", name: "bare", namespace: "tools" },
  ];
  const runner = {
    async run() {
      return { stdout: "tools api 125m 256Mi\ntools worker 125m 256Mi\ntools bare 10m 32Mi\n" };
    },
  };
  await applyPodMetrics(fakeConfigStore(), runner, "cluster-1", "all", rows);

  assert.equal(rows[0].podCpuUsagePercent, 25);
  assert.equal(rows[0].podCpuRequestPercent, 125);

  assert.equal(rows[1].podCpuUsagePercent, null);
  assert.equal(rows[1].podCpuRequestPercent, 250);
  assert.equal(rows[1].podMemoryRequestPercent, 50);

  assert.equal(rows[2].podCpuRequestPercent, null);
  assert.equal(rows[2].podMemoryRequestPercent, null);
  assert.equal(rows[2].cpuUsage, "10m");

  // Absolute usage is what the table sorts pods by, and it is available even
  // when neither a limit nor a request makes a percentage possible.
  assert.equal(rows[2].podCpuUsageValue, 10);
  assert.equal(rows[2].podMemoryUsageValue, 32 * 1024 ** 2);
});

test("deployment conditions preserve simultaneous Lens-style labels", () => {
  const row = deploymentSummary({
    metadata: { uid: "d1", name: "web", namespace: "default", generation: 4 },
    spec: { replicas: 3, template: { spec: { containers: [] } } },
    status: {
      observedGeneration: 4,
      replicas: 3,
      readyReplicas: 2,
      updatedReplicas: 2,
      availableReplicas: 2,
      conditions: [
        { type: "Available", status: "True", reason: "MinimumReplicasAvailable", message: "Deployment has minimum availability." },
        { type: "Progressing", status: "True", reason: "ReplicaSetUpdated", message: "ReplicaSet is progressing." },
        { type: "ReplicaFailure", status: "True", reason: "FailedCreate", message: "Quota exceeded." },
      ],
    },
  });
  assert.deepEqual(
    row.workloadConditions.map((condition) => condition.label),
    ["ReplicaFailure", "Available", "Progressing"],
  );
  assert.match(row.workloadConditionsText, /FailedCreate/);
  assert.match(row.status, /Available/);
  assert.match(row.status, /ReplicaFailure/);
});

test("a Service carries the pieces an address is built from, not only a printed port list", () => {
  const [row] = normalizeResourceItems("services", [
    {
      metadata: { name: "web", namespace: "shop" },
      spec: {
        type: "LoadBalancer",
        clusterIP: "10.43.7.21",
        externalIPs: ["198.51.100.7"],
        ports: [{ name: "http", port: 80, targetPort: 8080, nodePort: 31080, protocol: "TCP", appProtocol: "http" }],
      },
      status: { loadBalancer: { ingress: [{ ip: "203.0.113.4" }, { hostname: "lb.example.com" }] } },
    },
  ]);

  // The printed list stays - a table cell still needs it - and the pieces
  // travel beside it, because an address cannot be built from "80 → 8080/TCP".
  assert.equal(row.ports, "http · 80 → 8080/TCP");
  assert.deepEqual(row.servicePortItems, [{ name: "http", port: 80, targetPort: "8080", nodePort: 31080, protocol: "TCP", appProtocol: "http" }]);
  assert.deepEqual(row.loadBalancerAddresses, ["203.0.113.4", "lb.example.com"]);
  assert.deepEqual(row.externalIps, ["198.51.100.7"]);
  assert.equal(row.externalName, "");

  const [external] = normalizeResourceItems("services", [{ metadata: { name: "vendor", namespace: "shop" }, spec: { type: "ExternalName", externalName: "api.vendor.example.com" }, status: {} }]);
  assert.equal(external.externalName, "api.vendor.example.com");
  assert.deepEqual(external.servicePortItems, []);
  assert.deepEqual(external.loadBalancerAddresses, []);
});

test("node labels lead with what somebody set, and roles are not labels", () => {
  const labels = {
    "node-role.kubernetes.io/control-plane": "",
    "node-role.kubernetes.io/master": "true",
    "topology.kubernetes.io/zone": "eu-1a",
    "failure-domain.beta.kubernetes.io/zone": "eu-1a",
    "kubernetes.io/hostname": "worker-1",
    "kubernetes.io/os": "linux",
    "example.com/team": "platform",
  };
  const items = nodeLabelItems(labels, "worker-1");

  // "Role: true" said nothing - the value of a role label is empty or "true" -
  // so roles left the chips for a column of their own, and the hostname is the
  // row's own name. What is left leads with the label somebody in this cluster
  // chose: "OS: linux" is on every row and tells two nodes apart never.
  assert.deepEqual(
    items.map((item) => `${item.label}:${item.value}`),
    ["team:platform", "Zone:eu-1a", "OS:linux"],
  );
  assert.equal(items[0].full, "example.com/team=platform");

  assert.deepEqual(nodeRoles(labels), ["control-plane", "master"]);
  // The spelling from before 1.16, which some distributions still write.
  assert.deepEqual(nodeRoles({ "kubernetes.io/role": "worker" }), ["worker"]);
  assert.deepEqual(nodeRoles({ "node-role.kubernetes.io/": "" }), []);
  assert.deepEqual(nodeRoles({}), []);
});

test("node annotations reach the row, without the manifest kubectl stores on apply", () => {
  const items = nodeAnnotationItems({
    "kubectl.kubernetes.io/last-applied-configuration": '{"apiVersion":"v1"}',
    "node.alpha.kubernetes.io/ttl": "0",
    "flannel.alpha.coreos.com/backend-type": "vxlan",
  });
  assert.deepEqual(
    items.map((item) => item.key),
    ["flannel.alpha.coreos.com/backend-type", "node.alpha.kubernetes.io/ttl"],
  );
  assert.equal(items[1].value, "0");

  const [row] = normalizeResourceItems("nodes", [
    {
      metadata: { name: "worker-1", labels: { "node-role.kubernetes.io/worker": "" }, annotations: { "node.alpha.kubernetes.io/ttl": "0" } },
      spec: {},
      status: { conditions: [{ type: "Ready", status: "True" }] },
    },
  ]);
  assert.equal(row.roles, "worker");
  assert.equal(row.nodeAnnotationsSearch, "node.alpha.kubernetes.io/ttl=0");
  assert.deepEqual(
    row.nodeAnnotationItems.map((item) => item.key),
    ["node.alpha.kubernetes.io/ttl"],
  );
});
const { handleResourceListRequest, matchResourceListRoute } = require("../dist/main/backend/routes/resourceLists.js");
const { KubectlError } = require("../dist/main/backend/kubectl/errors.js");

function fakeUsageHistory() {
  return {
    ensureCluster() {},
    ingest() {},
    attributePods() {},
    backfillPodMetrics() {},
    history: () => ({ pod: null, workload: null, workloadKey: "", workloadExact: false, workloadPods: 0, points: [], bucketMs: 300000, retentionMs: 86400000 }),
  };
}

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
          resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "512Mi" } },
        },
      ],
      initContainers: [{ name: "init", resources: { limits: { cpu: "250m", memory: "1Gi" } } }],
      overhead: { cpu: "10m", memory: "16Mi" },
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
  assert.equal(pod.podCpuLimitValue, 510);
  assert.equal(pod.podMemoryLimitValue, 1090519040);

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
      fakeUsageHistory(),
      () => true,
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
  // The list and its `kubectl top` enrichment run concurrently, so the contract
  // is that both commands are issued, not the order they are issued in.
  assert.ok(commands.some((command) => command.args.join(" ") === "get pods -n default -o json"));
  assert.ok(commands.some((command) => command.args.join(" ") === "top pods --no-headers -n default"));

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
      fakeUsageHistory(),
      () => true,
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

test("browsing a disconnected cluster does not restart its usage sampling", async (t) => {
  const started = [];
  const usageHistory = { ...fakeUsageHistory(), ensureCluster: (clusterId) => started.push(clusterId) };
  const cache = new ResourceSnapshotCache();
  const runner = {
    async run(command) {
      const args = command.args.join(" ");
      if (args.startsWith("get pods")) return { stdout: JSON.stringify({ items: [] }), stderr: "", commandPreview: args, returnCode: 0 };
      return { stdout: "", stderr: "", commandPreview: args, returnCode: 0 };
    },
  };

  let connected = false;
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
      usageHistory,
      () => connected,
      () => {},
    );
    if (!handled) {
      response.statusCode = 404;
      response.end();
    }
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  // Disconnecting has to stick. A resource list load is the one place that
  // starts sampling, so if it ignored the connection state the user's
  // disconnect would silently undo itself the moment they looked at a table.
  await fetch(`${baseUrl}/clusters/cluster-1/resources/pods?namespace=default&forceRefresh=true`);
  assert.deepEqual(started, [], "a disconnected cluster must not be sampled");

  connected = true;
  await fetch(`${baseUrl}/clusters/cluster-1/resources/pods?namespace=default&forceRefresh=true`);
  assert.deepEqual(started, ["cluster-1"], "a connected cluster still starts sampling on first browse");
});
