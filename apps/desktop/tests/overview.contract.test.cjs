const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOverviewSnapshot } = require("../dist/main/backend/overview/overviewEngine.js");
const { buildOverviewResponse } = require("../dist/main/backend/routes/overview.js");
const { KubectlError } = require("../dist/main/backend/kubectl/errors.js");

test("overview snapshot keeps health conservative and summaries actionable", () => {
  const snapshot = buildOverviewSnapshot(
    "cluster-1",
    ["all"],
    {
      nodes: [
        {
          uid: "node-1",
          name: "worker-a",
          status: "Ready",
          labels: { "node-role.kubernetes.io/worker": "", "topology.kubernetes.io/zone": "a" },
          cpuUsageRaw: "500m",
          cpuAllocatableRaw: "2",
          memoryUsageRaw: "1Gi",
          memoryAllocatableRaw: "4Gi",
          diskUsageRaw: 10 * 1024 ** 3,
          diskObservedCapacityRaw: 100 * 1024 ** 3,
          kubeletVersion: "v1.31.0",
          architecture: "arm64",
        },
        {
          uid: "node-2",
          name: "worker-b",
          status: "Ready",
          labels: { "node-role.kubernetes.io/worker": "", "topology.kubernetes.io/zone": "b" },
          cpuUsageRaw: "1",
          cpuAllocatableRaw: "4",
          memoryUsageRaw: "2Gi",
          memoryAllocatableRaw: "8Gi",
          diskUsageRaw: 20 * 1024 ** 3,
          diskObservedCapacityRaw: 200 * 1024 ** 3,
          kubeletVersion: "v1.31.0",
          architecture: "arm64",
        },
        {
          uid: "node-3",
          name: "master",
          status: "Ready",
          labels: { "node-role.kubernetes.io/control-plane": "" },
          cpuUsageRaw: "8",
          cpuAllocatableRaw: "10",
          memoryUsageRaw: "8Gi",
          memoryAllocatableRaw: "10Gi",
        },
        {
          uid: "node-4",
          name: "ingress",
          status: "Ready",
          labels: { "node-role.kubernetes.io/ingress": "true" },
          cpuUsageRaw: "4",
          cpuAllocatableRaw: "8",
          memoryUsageRaw: "4Gi",
          memoryAllocatableRaw: "8Gi",
        },
      ],
      pods: [
        { uid: "pod-1", name: "api", namespace: "default", phase: "Running", ready: "1/1" },
        { uid: "pod-2", name: "worker", namespace: "tools", phase: "Pending", ready: "0/1" },
      ],
      deployments: [{ uid: "dep-1", name: "api", namespace: "default", ready: "1/1" }],
      events: [],
      persistentvolumeclaims: [],
    },
    [],
  );
  assert.equal(snapshot.verdict.tone, "pending");
  assert.equal(snapshot.summary.nodesReady, 4);
  assert.equal(snapshot.summary.podsReady, 1);
  assert.equal(snapshot.capacity.workerNodes, 2);
  assert.deepEqual(snapshot.capacity.excluded, { controlPlane: 1, etcd: 0, ingress: 1 });
  const roleGroups = snapshot.capacity.views.find((view) => view.key === "role").groups;
  const workers = roleGroups.find((group) => group.name === "workers");
  assert.equal(workers.cpu.used, 1500);
  assert.equal(workers.cpu.allocatable, 6000);
  assert.equal(workers.memory.available, 9 * 1024 ** 3);
  assert.equal(workers.storage.used, 30 * 1024 ** 3);
  assert.equal(workers.storage.available, 270 * 1024 ** 3);
  assert.deepEqual(roleGroups.map((group) => group.name), ["workers", "control-plane", "ingress"]);
  assert.deepEqual(
    snapshot.capacity.views.find((view) => view.key === "label:topology.kubernetes.io/zone").groups.map((group) => group.name),
    ["a", "b", "control-plane", "ingress"],
  );
  assert.deepEqual(snapshot.clusterProfile.kubernetesVersions, ["v1.31.0"]);
  assert.equal(snapshot.workloads.find((item) => item.resource === "pods").pending, 1);
});

test("overview sources load concurrently and preserve partial failures", async () => {
  let active = 0;
  let maximum = 0;
  const runner = {
    async run() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    async runJson(command) {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const resource = command.args[1];
      if (resource === "resourcequotas") {
        throw new KubectlError({ code: "KUBECTL_FAILED", message: "metrics unavailable", rawStderr: "", commandPreview: "kubectl get resourcequotas" });
      }
      return { items: [] };
    },
  };
  const configStore = {
    load: () => ({ settings: { restartProblemThreshold: 3 }, clusters: [{ id: "cluster-1" }] }),
    getCluster: () => ({ id: "cluster-1" }),
  };
  const response = await buildOverviewResponse(configStore, runner, "cluster-1", ["all"]);
  assert.ok(maximum > 1);
  assert.equal(response.verdict.tone, "neutral");
  assert.equal(response.errors.length, 1);
});
