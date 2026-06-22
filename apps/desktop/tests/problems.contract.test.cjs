const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  buildProblemRows,
  classifyProblem,
  summarizeProblems,
} = require("../dist/main/backend/problems/problemEngine.js");
const {
  buildProblemsResponse,
  handleProblemsRequest,
  matchProblemsRoute,
} = require("../dist/main/backend/routes/problems.js");
const {
  ClusterNotFoundError,
} = require("../dist/main/backend/config/configStore.js");
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

function fakeConfigStore(restartProblemThreshold = 3) {
  return {
    load() {
      return {
        settings: {
          kubectlPath: "kubectl",
          restartProblemThreshold,
        },
        clusters: [
          {
            id: "cluster-1",
            kubeconfigPath: "C:\\temp\\cluster-1.yaml",
          },
        ],
      };
    },
    getCluster(clusterId, config = this.load()) {
      const cluster = config.clusters.find((item) => item.id === clusterId);
      if (!cluster) throw new ClusterNotFoundError(clusterId);
      return cluster;
    },
  };
}

function rawResources() {
  return {
    pods: {
      items: [
        {
          metadata: {
            uid: "pod-1",
            name: "api-0",
            namespace: "default",
            creationTimestamp: "2026-06-22T10:00:00Z",
          },
          spec: { containers: [{ name: "api" }] },
          status: {
            phase: "Pending",
            containerStatuses: [
              {
                name: "api",
                ready: false,
                restartCount: 6,
                state: {
                  waiting: {
                    reason: "CrashLoopBackOff",
                    message: "back-off restarting failed container",
                  },
                },
                lastState: {},
              },
            ],
            conditions: [
              {
                type: "PodScheduled",
                status: "False",
                reason: "Unschedulable",
                message: "0/3 nodes are available: insufficient memory",
              },
            ],
          },
        },
      ],
    },
    deployments: {
      items: [
        {
          metadata: {
            uid: "dep-1",
            name: "api",
            namespace: "default",
            creationTimestamp: "2026-06-22T09:00:00Z",
          },
          spec: { replicas: 3 },
          status: { readyReplicas: 1, availableReplicas: 1, updatedReplicas: 3 },
        },
      ],
    },
    events: {
      items: [
        {
          metadata: {
            uid: "event-1",
            name: "api-0.123",
            namespace: "default",
            creationTimestamp: "2026-06-22T11:00:00Z",
          },
          type: "Warning",
          reason: "FailedMount",
          message: "MountVolume failed for volume data",
          involvedObject: {
            kind: "Pod",
            name: "api-0",
            namespace: "default",
          },
          lastTimestamp: "2026-06-22T11:01:00Z",
        },
      ],
    },
    nodes: {
      items: [
        {
          metadata: {
            uid: "node-1",
            name: "worker-1",
            creationTimestamp: "2026-06-22T08:00:00Z",
          },
          spec: {},
          status: {
            conditions: [
              { type: "Ready", status: "False", reason: "KubeletNotReady" },
              {
                type: "MemoryPressure",
                status: "True",
                reason: "KubeletHasInsufficientMemory",
                message: "node memory pressure",
              },
            ],
          },
        },
      ],
    },
    persistentvolumeclaims: {
      items: [
        {
          apiVersion: "v1",
          kind: "PersistentVolumeClaim",
          metadata: {
            uid: "pvc-1",
            name: "data",
            namespace: "default",
            creationTimestamp: "2026-06-22T07:00:00Z",
          },
          status: { phase: "Pending" },
        },
      ],
    },
  };
}

test("problems engine preserves categories, severity, targets, and summary", () => {
  const rows = buildProblemRows(
    [
      {
        uid: "pod-1",
        name: "api-0",
        namespace: "default",
        phase: "Pending",
        restarts: 6,
        containerProblems: "api: CrashLoopBackOff back-off restarting failed container",
        conditions: "PodScheduled=False Unschedulable 0/3 nodes are available",
        createdAt: "2026-06-22T10:00:00Z",
      },
    ],
    [
      {
        uid: "dep-1",
        name: "api",
        namespace: "default",
        ready: "1/3",
        createdAt: "2026-06-22T09:00:00Z",
      },
    ],
    [
      {
        uid: "event-1",
        name: "api-0.123",
        namespace: "default",
        type: "Warning",
        reason: "FailedMount",
        message: "MountVolume failed",
        involvedKind: "Pod",
        involvedName: "api-0",
        involvedNamespace: "default",
        lastTimestamp: "2026-06-22T11:00:00Z",
      },
    ],
    [
      {
        uid: "node-1",
        name: "worker-1",
        status: "NotReady",
        pressure: "MemoryPressure: KubeletHasInsufficientMemory",
        createdAt: "2026-06-22T08:00:00Z",
      },
    ],
    [
      {
        uid: "pvc-1",
        name: "data",
        namespace: "default",
        status: "Pending",
        createdAt: "2026-06-22T07:00:00Z",
      },
    ],
    2,
  );

  assert.equal(classifyProblem("Pod", "Container problem", "CrashLoopBackOff"), "crashLoop");
  assert.equal(rows[0].severity, "Critical");
  assert.ok(rows.some((item) => item.category === "crashLoop"));
  assert.ok(rows.some((item) => item.category === "scheduling"));
  assert.ok(rows.some((item) => item.category === "deployment"));
  assert.ok(rows.some((item) => item.category === "storage"));
  assert.ok(rows.some((item) => item.reason === "Node pressure"));
  const event = rows.find((item) => item.uid === "event-event-1");
  assert.equal(event.targetResource, "pods");
  assert.equal(event.targetName, "api-0");

  const summary = summarizeProblems(
    rows,
    {
      pods: [{}],
      deployments: [{}],
      events: [{}],
      nodes: [{}],
      persistentvolumeclaims: [{}],
    },
    [],
    () => new Date("2026-06-22T12:00:00Z"),
  );
  assert.equal(summary.total, rows.length);
  assert.equal(summary.errors, 0);
  assert.equal(summary.generatedAt, "2026-06-22T12:00:00.000Z");
  assert.deepEqual(summary.sources, {
    pods: 1,
    deployments: 1,
    events: 1,
    nodes: 1,
    persistentvolumeclaims: 1,
  });
});

test("Problems route loads five sources concurrently and returns partial errors", async (t) => {
  const resources = rawResources();
  const commands = [];
  let active = 0;
  let maximumActive = 0;
  const runner = {
    async runJson(command) {
      commands.push(command.args);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const resource = command.args[1];
      if (resource === "events") {
        throw new KubectlError({
          code: "FORBIDDEN",
          message: "kubectl command failed",
          rawStderr: "forbidden",
          commandPreview: "kubectl get events -A -o json",
        });
      }
      return resources[resource];
    },
  };

  const body = await buildProblemsResponse(
    fakeConfigStore(2),
    runner,
    "cluster-1",
  );
  assert.equal(commands.length, 5);
  assert.ok(maximumActive > 1);
  assert.equal(body.errors.length, 1);
  assert.equal(body.errors[0].resource, "events");
  assert.equal(body.errors[0].namespace, "all");
  assert.equal(body.summary.errors, 1);
  assert.equal(body.summary.sources.events, 0);
  assert.ok(body.items.some((item) => item.resource === "pods"));
  assert.ok(body.items.some((item) => item.resource === "nodes"));

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handleProblemsRequest(
      request,
      response,
      pathname,
      fakeConfigStore(2),
      runner,
      () => {},
    );
    if (!handled) {
      response.statusCode = 404;
      response.end();
    }
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl}/clusters/cluster-1/problems`);
  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.equal(responseBody.errors.length, 1);
  assert.equal(responseBody.summary.errors, 1);
});

test("Problems route reports missing cluster before starting kubectl", async (t) => {
  let calls = 0;
  const runner = {
    async runJson() {
      calls += 1;
      return { items: [] };
    },
  };
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    handleProblemsRequest(
      request,
      response,
      pathname,
      fakeConfigStore(),
      runner,
      () => {},
    );
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`${baseUrl}/clusters/missing/problems`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).detail.code, "CLUSTER_NOT_FOUND");
  assert.equal(calls, 0);
});

test("Problems route matcher validates method and cluster id", () => {
  assert.deepEqual(
    matchProblemsRoute("GET", "/clusters/cluster-1/problems"),
    { clusterId: "cluster-1" },
  );
  assert.equal(matchProblemsRoute("POST", "/clusters/cluster-1/problems"), null);
  assert.throws(
    () => matchProblemsRoute("GET", "/clusters/%2Fetc/problems"),
    (error) => error.code === "INVALID_IDENTIFIER",
  );
});
