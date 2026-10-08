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
} = require("../dist/main/backend/resources/normalizers/index.js");

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

// What the Metrics API answers, from `kubectl top`-style lines.
function podMetricsList(text) {
  return {
    kind: "PodMetricsList",
    items: text
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .map(([namespace, name, cpu, memory]) => ({ metadata: { namespace, name }, containers: [{ name: "main", usage: { cpu, memory } }] })),
  };
}

const isMetricsApi = (command) => command.args.some((arg) => arg.startsWith("/apis/metrics.k8s.io/"));

// `kubectl top` was the same Metrics API reading plus discovery and a node
// list, in a process of its own. The reading is taken directly now, and
// rendered the way `kubectl top` rendered it.
test("node list metrics use one Metrics API read regardless of node count", async () => {
  const commands = [];
  const rows = Array.from({ length: 120 }, (_, index) => ({
    uid: String(index),
    name: `worker-${index}`,
    cpuAllocatableRaw: "2",
    memoryAllocatableRaw: "2Gi",
  }));
  const runner = {
    async runJson(command) {
      commands.push(command);
      // Nanocores and Ki, as metrics-server reports them.
      return { kind: "NodeMetricsList", items: rows.map((row) => ({ metadata: { name: row.name }, usage: { cpu: "99500001n", memory: "524288Ki" } })) };
    },
  };
  await applyNodeMetrics(fakeConfigStore(), runner, "cluster-1", rows);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].args, ["get", "--raw", "/apis/metrics.k8s.io/v1beta1/nodes"]);
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
    async runJson(command) {
      if (isMetricsApi(command)) return podMetricsList("tools api 250m 512Mi");
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
    async runJson() {
      return podMetricsList("tools api 125m 256Mi\ntools worker 50m 64Mi");
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
    async runJson() {
      return podMetricsList("tools api 125m 256Mi\ntools worker 125m 256Mi\ntools bare 10m 32Mi");
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
  assert.deepEqual(
    node.nodeConditions.map((condition) => [condition.label, condition.tone]),
    [
      ["Ready", "success"],
      ["SchedulingDisabled", "warning"],
    ],
  );

  const pressured = nodeSummary({
    metadata: { uid: "node-2", name: "master-2" },
    status: {
      conditions: [
        { type: "MemoryPressure", status: "True", reason: "KubeletHasInsufficientMemory", message: "kubelet has insufficient memory available" },
        { type: "DiskPressure", status: "False" },
        { type: "Ready", status: "True" },
      ],
    },
  });
  assert.deepEqual(
    pressured.nodeConditions.map((condition) => [condition.label, condition.tone]),
    [
      ["MemoryPressure", "warning"],
      ["Ready", "success"],
    ],
    "a node under pressure says so before it says it is Ready",
  );
  assert.match(pressured.nodeConditionsText, /insufficient memory/);
  assert.equal(nodeSummary({ metadata: { name: "gone" }, status: { conditions: [{ type: "Ready", status: "Unknown" }] } }).nodeConditions[0].label, "NotReady");
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
      if (isMetricsApi(command)) return podMetricsList("default demo 25m 64Mi");
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
  // Built-in types are read from their API path; see the raw-list test below.
  assert.ok(commands.some((command) => command.args.join(" ") === "get --raw /api/v1/namespaces/default/pods"));
  assert.ok(commands.some((command) => command.args.join(" ") === "get --raw /apis/metrics.k8s.io/v1beta1/namespaces/default/pods"));

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

// Reported from a real cluster: opening one with ~1700 pods left the Pods table
// blank for seconds. The list was ready; its response was waiting for
// `kubectl top`, which metrics-server answers slowly on a big cluster and which
// may take up to its 12 s timeout. The list now waits a moment at most and
// fills the usage from what the sampler already recorded.
test("a pod list does not wait for a slow kubectl top", async (t) => {
  let releaseTop;
  const topIssued = new Promise((resolve) => {
    releaseTop = resolve;
  });
  const runner = {
    async runJson(command) {
      if (isMetricsApi(command)) {
        // metrics-server taking its time: answers long after the list.
        await new Promise((resolve) => setTimeout(resolve, 5000));
        releaseTop();
        return podMetricsList("default demo 999m 999Mi");
      }
      return { items: [{ metadata: { uid: "u1", name: "demo", namespace: "default" }, spec: { containers: [{ name: "main" }] }, status: { phase: "Running" } }] };
    },
    async run() {
      return { ok: true, stdout: "ok\n", stderr: "", commandPreview: "kubectl", returnCode: 0 };
    },
  };
  const usageHistory = {
    ...fakeUsageHistory(),
    // What the background sampler recorded for this pod a few seconds ago.
    backfillPodMetrics(_clusterId, metrics, rows) {
      for (const row of rows) metrics.set(row.name, { cpu: "25m", memory: "64Mi" });
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
      new ResourceSnapshotCache(),
      () => {},
      usageHistory,
      () => true,
      () => {},
    );
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const started = Date.now();
  const response = await fetch(`${baseUrl}/clusters/cluster-1/resources/pods?namespace=default&forceRefresh=true`);
  const elapsed = Date.now() - started;
  const body = await response.json();
  assert.ok(elapsed < 1500, `the list answered in ${elapsed} ms instead of waiting for kubectl top`);
  assert.equal(body.items[0].cpuUsage, "25m", "the usage comes from the recorded samples");
  assert.equal(body.items[0].memoryUsage, "64Mi");
  // Let the slow command finish before the test ends, so nothing outlives it.
  await topIssued;
});

// Reported from a real cluster of ~1700 pods: `kubectl get pods -A -o json`
// took 1.2-1.4 s, nearly all of it kubectl decoding, converting and
// pretty-printing every object; `kubectl get --raw /api/v1/pods` returned the
// same list in about 0.1 s. Built-in types are read raw now.
test("built-in lists are read from their API path, everything else through kubectl get", () => {
  const { rawListPath } = require("../dist/main/backend/resources/rawListPaths.js");
  assert.equal(rawListPath("pods", "all"), "/api/v1/pods");
  assert.equal(rawListPath("pods", "kube-system"), "/api/v1/namespaces/kube-system/pods");
  assert.equal(rawListPath("deployments", "shop"), "/apis/apps/v1/namespaces/shop/deployments");
  assert.equal(rawListPath("cronjobs", "all"), "/apis/batch/v1/cronjobs");
  // Cluster-scoped types ignore the namespace selection.
  assert.equal(rawListPath("nodes", "shop"), "/api/v1/nodes");
  assert.equal(rawListPath("clusterroles", "all"), "/apis/rbac.authorization.k8s.io/v1/clusterroles");
  // A namespaced list with no namespace means the context's default, which only
  // kubectl knows; custom resources are found through discovery.
  assert.equal(rawListPath("pods", "_cluster"), null);
  assert.equal(rawListPath("widgets.example.com", "all"), null);
  assert.equal(rawListPath("verticalpodautoscalers", "all"), null, "a CRD, wherever the sidebar lists it");
  assert.equal(rawListPath("constructor", "all"), null, "only the table's own entries, never Object.prototype");
});

test("a raw list reaches the normalizers in the shape kubectl get -o json gives", async (t) => {
  const commands = [];
  const runner = {
    async runJson(command) {
      commands.push(command.args.join(" "));
      // What the API server sends: the list says what its items are, the items do not.
      return { kind: "SecretList", apiVersion: "v1", items: [{ metadata: { uid: "s1", name: "db", namespace: "shop" }, type: "Opaque", data: { password: "c2VjcmV0" } }] };
    },
    async run() {
      return { ok: true, stdout: "", stderr: "", commandPreview: "kubectl", returnCode: 0 };
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
      new ResourceSnapshotCache(),
      () => {},
      fakeUsageHistory(),
      () => true,
      () => {},
    );
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const body = await (await fetch(`${baseUrl}/clusters/cluster-1/resources/secrets?namespace=shop&forceRefresh=true`)).json();
  assert.deepEqual(commands, ["get --raw /api/v1/namespaces/shop/secrets"]);
  assert.equal(body.items[0].name, "db");
  // Secrets and ConfigMaps share a normalizer that tells them apart by kind.
  assert.equal(body.items[0].kind, "Secret", "the item kind comes from the list");
  assert.equal(body.items[0].keyNames, "password");
});

test("a cluster that does not serve the API path still gets its list through kubectl get", async (t) => {
  const { KubectlError } = require("../dist/main/backend/kubectl/errors.js");
  const commands = [];
  const runner = {
    async runJson(command) {
      const args = command.args.join(" ");
      commands.push(args);
      if (args.startsWith("get --raw")) {
        // An older cluster without autoscaling/v2.
        throw new KubectlError({ code: "NOT_FOUND", message: "the server could not find the requested resource", rawStderr: "", commandPreview: "kubectl get --raw" });
      }
      return { items: [{ apiVersion: "autoscaling/v1", kind: "HorizontalPodAutoscaler", metadata: { uid: "h1", name: "web", namespace: "shop" }, spec: {}, status: {} }] };
    },
    async run() {
      return { ok: true, stdout: "", stderr: "", commandPreview: "kubectl", returnCode: 0 };
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
      new ResourceSnapshotCache(),
      () => {},
      fakeUsageHistory(),
      () => true,
      () => {},
    );
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl}/clusters/cluster-1/resources/horizontalpodautoscalers?namespace=shop&forceRefresh=true`);
  assert.equal(response.status, 200);
  assert.deepEqual(commands, ["get --raw /apis/autoscaling/v2/namespaces/shop/horizontalpodautoscalers", "get horizontalpodautoscalers -n shop -o json"]);
  assert.equal((await response.json()).items[0].name, "web");
});

// Reported from a real cluster: Argo CD Applications in one namespace did not
// list within the table's 30 seconds. They went through `kubectl get
// applications.argoproj.io -o json`, which re-encodes every object - and an
// Application carries its whole resource tree in status. Custom resources are
// read raw now too, once their group says which version it serves.
function customResourceServer(t, runJson) {
  const { clearCustomListEndpoints } = require("../dist/main/backend/resources/customListPaths.js");
  clearCustomListEndpoints();
  t.after(() => clearCustomListEndpoints());
  const runner = {
    runJson,
    async run() {
      return { ok: true, stdout: "", stderr: "", commandPreview: "kubectl", returnCode: 0 };
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
      new ResourceSnapshotCache(),
      () => {},
      fakeUsageHistory(),
      () => true,
      () => {},
    );
  });
  t.after(() => close(server));
  return listen(server);
}

function argoDiscovery(args) {
  if (args === "get --raw /apis/argoproj.io") return { kind: "APIGroup", name: "argoproj.io", preferredVersion: { groupVersion: "argoproj.io/v1alpha1", version: "v1alpha1" } };
  if (args === "get --raw /apis/argoproj.io/v1alpha1") {
    return {
      kind: "APIResourceList",
      groupVersion: "argoproj.io/v1alpha1",
      resources: [
        { name: "applications", namespaced: true, kind: "Application", verbs: ["get", "list", "watch"] },
        { name: "applications/status", namespaced: true, kind: "Application", verbs: ["get"] },
      ],
    };
  }
  return null;
}

test("custom resource lists are read from their API path once the group is known", async (t) => {
  const commands = [];
  const baseUrl = await customResourceServer(t, async (command) => {
    const args = command.args.join(" ");
    commands.push(args);
    const discovery = argoDiscovery(args);
    if (discovery) return discovery;
    return {
      kind: "ApplicationList",
      apiVersion: "argoproj.io/v1alpha1",
      items: [{ apiVersion: "argoproj.io/v1alpha1", kind: "Application", metadata: { uid: "a1", name: "shop", namespace: "argocd" }, spec: {}, status: {} }],
    };
  });

  const first = await (await fetch(`${baseUrl}/clusters/cluster-1/resources/applications.argoproj.io?namespace=argocd&forceRefresh=true`)).json();
  assert.equal(first.items[0].name, "shop");
  assert.deepEqual(commands, ["get --raw /apis/argoproj.io", "get --raw /apis/argoproj.io/v1alpha1", "get --raw /apis/argoproj.io/v1alpha1/namespaces/argocd/applications"]);

  // The version is remembered: a refresh is one request.
  commands.length = 0;
  await (await fetch(`${baseUrl}/clusters/cluster-1/resources/applications.argoproj.io?namespace=all&forceRefresh=true`)).json();
  assert.deepEqual(commands, ["get --raw /apis/argoproj.io/v1alpha1/applications"]);
});

test("a custom resource whose group cannot be read still lists through kubectl get", async (t) => {
  const { KubectlError } = require("../dist/main/backend/kubectl/errors.js");
  const commands = [];
  const baseUrl = await customResourceServer(t, async (command) => {
    const args = command.args.join(" ");
    commands.push(args);
    if (args.startsWith("get --raw")) throw new KubectlError({ code: "FORBIDDEN", message: "forbidden", rawStderr: "", commandPreview: "kubectl get --raw" });
    return { items: [{ apiVersion: "example.com/v1", kind: "Widget", metadata: { uid: "w1", name: "w", namespace: "shop" } }] };
  });

  const response = await fetch(`${baseUrl}/clusters/cluster-1/resources/widgets.example.com?namespace=shop&forceRefresh=true`);
  assert.equal(response.status, 200);
  assert.deepEqual(commands, ["get --raw /apis/example.com", "get widgets.example.com -n shop -o json"]);
  assert.equal((await response.json()).items[0].name, "w");
});

test("a custom resource that moved off its remembered version is rediscovered", async (t) => {
  const { KubectlError } = require("../dist/main/backend/kubectl/errors.js");
  const commands = [];
  let removed = false;
  const baseUrl = await customResourceServer(t, async (command) => {
    const args = command.args.join(" ");
    commands.push(args);
    const discovery = argoDiscovery(args);
    if (discovery) return discovery;
    if (removed && args.startsWith("get --raw"))
      throw new KubectlError({ code: "NOT_FOUND", message: "the server could not find the requested resource", rawStderr: "", commandPreview: "kubectl get --raw" });
    return { items: [] };
  });

  await fetch(`${baseUrl}/clusters/cluster-1/resources/applications.argoproj.io?namespace=argocd&forceRefresh=true`);
  removed = true;
  commands.length = 0;
  assert.equal((await fetch(`${baseUrl}/clusters/cluster-1/resources/applications.argoproj.io?namespace=argocd&forceRefresh=true`)).status, 200);
  assert.deepEqual(commands, ["get --raw /apis/argoproj.io/v1alpha1/namespaces/argocd/applications", "get applications.argoproj.io -n argocd -o json"]);
  commands.length = 0;
  await fetch(`${baseUrl}/clusters/cluster-1/resources/applications.argoproj.io?namespace=argocd&forceRefresh=true`);
  assert.equal(commands[0], "get --raw /apis/argoproj.io", "the stale version was forgotten");
});

test("only <plural>.<group> names are looked up in their group", () => {
  const { splitGroupResource, customListPath } = require("../dist/main/backend/resources/customListPaths.js");
  assert.deepEqual(splitGroupResource("applications.argoproj.io"), { plural: "applications", group: "argoproj.io" });
  assert.deepEqual(splitGroupResource("ingresses.networking.k8s.io"), { plural: "ingresses", group: "networking.k8s.io" });
  assert.equal(splitGroupResource("applications"), null);
  assert.equal(splitGroupResource("../x.y"), null);
  const clusterScoped = { prefix: "/apis/cert-manager.io/v1", plural: "clusterissuers", namespaced: false };
  assert.equal(customListPath(clusterScoped, "_cluster"), "/apis/cert-manager.io/v1/clusterissuers");
  assert.equal(customListPath(clusterScoped, "shop"), "/apis/cert-manager.io/v1/clusterissuers");
  const namespaced = { prefix: "/apis/argoproj.io/v1alpha1", plural: "applications", namespaced: true };
  assert.equal(customListPath(namespaced, "_cluster"), null, "the context's default namespace is kubectl's to know");
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

test("label text keeps the order localeCompare produced, without paying for it per comparison", () => {
  const keys = [
    "app.kubernetes.io/name",
    "app.kubernetes.io/instance",
    "app.kubernetes.io/managed-by",
    "pod-template-hash",
    "tier",
    "Environment",
    "team",
    "Team",
    "a-b",
    "ab",
    "app/1",
    "app-1",
    "v1",
    "v10",
  ];
  const labels = Object.fromEntries(keys.map((key, index) => [key, `value-${index}`]));
  const row = podSummary({ metadata: { name: "api", namespace: "default", labels }, spec: {}, status: {} });

  // The collator is what this used to call per comparison; it is the contract,
  // not a frozen string, so the test still means something if a key is added.
  const expected = [...keys]
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${key}=${labels[key]}`)
    .join(", ");
  assert.equal(row.labelsText, expected);

  // The tie-break that a plain comparison would get wrong: same key in two
  // cases, lowercase first.
  assert.ok(row.labelsText.indexOf("team=") < row.labelsText.indexOf("Team="));

  // A row without labels still carries the empty text the table filters on.
  assert.equal(podSummary({ metadata: { name: "api" }, spec: {}, status: {} }).labelsText, "");
});
