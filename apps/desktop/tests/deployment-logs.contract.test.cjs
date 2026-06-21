const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  buildDeploymentPodLogInvocation,
  handleDeploymentLogsRequest,
  matchDeploymentLogsPath,
  matchingDeploymentPods,
  parseDeploymentLogOptions,
  selectorMatches,
} = require("../dist/main/backend/routes/deploymentLogs.js");
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function demoDeployment() {
  return {
    metadata: { name: "web" },
    spec: {
      selector: {
        matchLabels: { app: "web" },
        matchExpressions: [
          { key: "track", operator: "In", values: ["stable", "canary"] },
          { key: "retired", operator: "DoesNotExist" },
        ],
      },
    },
  };
}

function demoPod(name, createdAt, labels = { app: "web", track: "stable" }) {
  return {
    metadata: {
      name,
      creationTimestamp: createdAt,
      labels,
    },
    spec: {
      containers: [
        { name: "app" },
        { name: "sidecar" },
      ],
    },
    status: { phase: "Running" },
  };
}

test("deployment log path, selector and command contract", () => {
  assert.deepEqual(
    matchDeploymentLogsPath(
      "/clusters/demo/deployments/default/web/log-targets",
    ),
    {
      clusterId: "demo",
      namespace: "default",
      name: "web",
      operation: "log-targets",
    },
  );

  assert.equal(
    selectorMatches(
      { app: "web", track: "stable" },
      demoDeployment().spec.selector,
    ),
    true,
  );
  assert.equal(
    selectorMatches(
      { app: "web", track: "old" },
      demoDeployment().spec.selector,
    ),
    false,
  );

  const pods = matchingDeploymentPods(demoDeployment(), {
    items: [
      demoPod("web-b", "2026-06-21T10:00:02Z"),
      demoPod("ignored", "2026-06-21T10:00:00Z", { app: "other", track: "stable" }),
      demoPod("web-a", "2026-06-21T10:00:01Z"),
    ],
  });

  assert.deepEqual(pods.map((pod) => pod.name), ["web-a", "web-b"]);
  assert.deepEqual(pods[0].containers, ["app", "sidecar"]);

  const options = parseDeploymentLogOptions(
    "/logs?all=true&previous=true&timestamps=true&container=app&pod=web-a",
  );
  const invocation = buildDeploymentPodLogInvocation(
    "default",
    pods[0],
    options,
  );

  assert.deepEqual(invocation.args, [
    "--request-timeout=20s",
    "logs",
    "web-a",
    "-n",
    "default",
    "--prefix=true",
    "--tail=-1",
    "-c",
    "app",
    "--previous",
    "--timestamps",
  ]);
  assert.equal(invocation.timeoutSeconds, 60);
  assert.equal(invocation.maxOutputBytes, 32 * 1024 * 1024);
  assert.equal(invocation.header, "===== pod/web-a · app =====");

  assert.throws(
    () => matchingDeploymentPods({ spec: {} }, { items: [] }),
    (error) => error.code === "DEPLOYMENT_SELECTOR_MISSING",
  );
});

test("deployment log targets and combined logs HTTP contract", async (t) => {
  const commands = [];
  let activeLogs = 0;
  let maxActiveLogs = 0;

  const pods = Array.from({ length: 6 }, (_, index) =>
    demoPod(
      `web-${String(index + 1).padStart(2, "0")}`,
      `2026-06-21T10:00:0${index + 1}Z`,
    ));
  pods.push(demoPod("ignored", "2026-06-21T10:00:00Z", {
    app: "other",
    track: "stable",
  }));

  const configStore = {
    load() {
      return { settings: { kubectlPath: "kubectl" } };
    },
    getCluster(clusterId) {
      assert.equal(clusterId, "demo");
      return { kubeconfigPath: "C:\\demo.yaml" };
    },
  };

  const runner = {
    async runJson(command) {
      commands.push(command);
      const args = command.args;

      if (args[0] === "get" && args[1] === "deployment") {
        return demoDeployment();
      }
      if (args[0] === "get" && args[1] === "pods") {
        return { items: pods };
      }

      throw new Error(`Unexpected JSON command: ${args.join(" ")}`);
    },

    async run(command) {
      commands.push(command);
      const args = command.args;
      const podName = args[2];

      activeLogs += 1;
      maxActiveLogs = Math.max(maxActiveLogs, activeLogs);

      try {
        await sleep(12);
        if (podName === "web-03") {
          throw new KubectlError({
            code: "NOT_FOUND",
            message: "previous container logs not found",
            rawStderr: "",
            commandPreview: "kubectl logs web-03",
          });
        }

        return {
          ok: true,
          stdout: podName === "web-05" ? "" : `line from ${podName}\n`,
          stderr: "",
          commandPreview: `kubectl logs ${podName}`,
          returnCode: 0,
        };
      } finally {
        activeLogs -= 1;
      }
    },
  };

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handleDeploymentLogsRequest(
      request,
      response,
      pathname,
      configStore,
      runner,
      () => {},
    );
    if (!handled) {
      response.statusCode = 404;
      response.end();
    }
  });

  const baseUrl = await listen(server);
  t.after(async () => close(server));

  const targetsResponse = await fetch(
    `${baseUrl}/clusters/demo/deployments/default/web/log-targets`,
  );
  assert.equal(targetsResponse.status, 200);
  assert.deepEqual(await targetsResponse.json(), {
    namespace: "default",
    name: "web",
    pods: Array.from({ length: 6 }, (_, index) => ({
      name: `web-${String(index + 1).padStart(2, "0")}`,
      phase: "Running",
      containers: ["app", "sidecar"],
    })),
    containers: ["app", "sidecar"],
  });

  const logsResponse = await fetch(
    `${baseUrl}/clusters/demo/deployments/default/web/logs?tail=250&previous=true&timestamps=true&prefix=false`,
  );
  assert.equal(logsResponse.status, 200);
  assert.match(logsResponse.headers.get("content-type"), /^text\/plain/);

  const body = await logsResponse.text();
  assert.ok(body.indexOf("pod/web-01") < body.indexOf("pod/web-02"));
  assert.ok(body.indexOf("pod/web-02") < body.indexOf("pod/web-03"));
  assert.match(body, /line from web-01/);
  assert.match(body, /<failed to load logs: previous container logs not found>/);
  assert.match(body, /===== pod\/web-05 · all containers =====\n<no log lines>/);
  assert.equal(maxActiveLogs, 4);

  const logCommands = commands.filter((command) => command.args.includes("logs"));
  assert.equal(logCommands.length, 6);
  assert.deepEqual(logCommands[0].args, [
    "--request-timeout=20s",
    "logs",
    "web-01",
    "-n",
    "default",
    "--tail=250",
    "--all-containers=true",
    "--previous",
    "--timestamps",
  ]);
  assert.equal(logCommands[0].timeoutSeconds, 35);
  assert.equal(logCommands[0].maxOutputBytes, 8 * 1024 * 1024);

  const missingPodResponse = await fetch(
    `${baseUrl}/clusters/demo/deployments/default/web/logs?pod=missing`,
  );
  assert.equal(missingPodResponse.status, 200);
  assert.equal(
    await missingPodResponse.text(),
    "No pods matched deployment/web in namespace default.",
  );
});
