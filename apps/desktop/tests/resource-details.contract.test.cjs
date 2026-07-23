const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  buildResourceDetailsInvocation,
  handleResourceDetailsRequest,
  matchResourceDetailsPath,
} = require("../dist/main/backend/routes/resourceDetails.js");
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

test("resource details command contract", () => {
  const nodeYaml = matchResourceDetailsPath(
    "/clusters/demo/resources/nodes/_cluster/node-a/yaml",
  );
  assert.ok(nodeYaml);
  assert.deepEqual(
    buildResourceDetailsInvocation(nodeYaml, "/ignored"),
    {
      args: ["get", "nodes", "node-a", "-o", "yaml"],
      timeoutSeconds: 30,
      maxOutputBytes: 16 * 1024 * 1024,
    },
  );

  const nodeMetrics = matchResourceDetailsPath(
    "/clusters/demo/resources/nodes/_cluster/node-a/metrics",
  );
  assert.ok(nodeMetrics);
  assert.deepEqual(
    buildResourceDetailsInvocation(nodeMetrics, "/ignored"),
    {
      args: ["get", "--raw=/api/v1/nodes/node-a/proxy/stats/summary"],
      timeoutSeconds: 12,
      maxOutputBytes: 8 * 1024 * 1024,
    },
  );

  const deploymentDescribe = matchResourceDetailsPath(
    "/clusters/demo/resources/deployments/default/web/describe",
  );
  assert.ok(deploymentDescribe);
  assert.deepEqual(
    buildResourceDetailsInvocation(deploymentDescribe, "/ignored"),
    {
      args: ["describe", "deployments", "web", "-n", "default"],
      timeoutSeconds: 30,
      maxOutputBytes: 16 * 1024 * 1024,
    },
  );

  const podLogs = matchResourceDetailsPath(
    "/clusters/demo/pods/default/web-123/logs",
  );
  assert.ok(podLogs);
  assert.deepEqual(
    buildResourceDetailsInvocation(
      podLogs,
      "/ignored?tail=9000&container=app&previous=true&timestamps=true",
    ),
    {
      args: [
        "--request-timeout=20s",
        "logs",
        "web-123",
        "-n",
        "default",
        "--tail=5000",
        "-c",
        "app",
        "--previous",
        "--timestamps",
      ],
      timeoutSeconds: 35,
      maxOutputBytes: 8 * 1024 * 1024,
    },
  );

  assert.deepEqual(
    buildResourceDetailsInvocation(podLogs, "/ignored?all=true"),
    {
      args: [
        "--request-timeout=20s",
        "logs",
        "web-123",
        "-n",
        "default",
        "--tail=-1",
      ],
      timeoutSeconds: 60,
      maxOutputBytes: 32 * 1024 * 1024,
    },
  );

  assert.throws(
    () => buildResourceDetailsInvocation(podLogs, "/ignored?follow=true"),
    /bounded polling/,
  );
  assert.throws(
    () => buildResourceDetailsInvocation(podLogs, "/ignored?tail=invalid"),
    /tail must be an integer/,
  );
  assert.equal(
    matchResourceDetailsPath(
      "/clusters/demo/resources/pods/default/web-123/events",
    ),
    null,
  );
});

test("resource details HTTP handler", async (t) => {
  const commands = [];
  const configStore = {
    load: () => ({ settings: { kubectlPath: "kubectl" } }),
    getCluster: (clusterId) => {
      assert.equal(clusterId, "demo");
      return { kubeconfigPath: "C:\\KubeDeck\\demo.yaml" };
    },
  };
  const runner = {
    run: async (command) => {
      commands.push(command);
      if (command.args.includes("missing-pod")) {
        throw new KubectlError({
          code: "NOT_FOUND",
          message: "pods missing-pod not found",
          rawStderr: "Error from server (NotFound)",
          commandPreview: "kubectl get pod missing-pod",
        });
      }
      return { stdout: "MOCK OUTPUT", stderr: "", exitCode: 0 };
    },
    runJson: async (command) => {
      commands.push(command);
      return {
        node: {
          fs: {
            usedBytes: 1024 ** 3,
            availableBytes: 3 * 1024 ** 3,
            capacityBytes: 4 * 1024 ** 3,
          },
        },
      };
    },
  };

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const handled = handleResourceDetailsRequest(
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

  const yamlResponse = await fetch(
    `${baseUrl}/clusters/demo/resources/nodes/_cluster/node-a/yaml`,
  );
  assert.equal(yamlResponse.status, 200);
  assert.match(yamlResponse.headers.get("content-type"), /^text\/plain/);
  assert.equal(await yamlResponse.text(), "MOCK OUTPUT");
  assert.deepEqual(commands.at(-1).args, ["get", "nodes", "node-a", "-o", "yaml"]);
  assert.equal(commands.at(-1).timeoutSeconds, 30);

  const metricsResponse = await fetch(
    `${baseUrl}/clusters/demo/resources/nodes/_cluster/node-a/metrics`,
  );
  assert.equal(metricsResponse.status, 200);
  assert.match(metricsResponse.headers.get("content-type"), /^application\/json/);
  assert.deepEqual(await metricsResponse.json(), {
    uid: "",
    name: "node-a",
    diskUsage: "1 GiB",
    diskAvailable: "3 GiB",
    diskObservedCapacity: "4 GiB",
    diskUsagePercent: 25,
  });
  assert.deepEqual(commands.at(-1).args, ["get", "--raw=/api/v1/nodes/node-a/proxy/stats/summary"]);

  const logsResponse = await fetch(
    `${baseUrl}/clusters/demo/pods/default/web-123/logs?tail=125&previous=true&timestamps=true&container=app`,
  );
  assert.equal(logsResponse.status, 200);
  assert.deepEqual(commands.at(-1).args, [
    "--request-timeout=20s",
    "logs",
    "web-123",
    "-n",
    "default",
    "--tail=125",
    "-c",
    "app",
    "--previous",
    "--timestamps",
  ]);

  const followResponse = await fetch(
    `${baseUrl}/clusters/demo/pods/default/web-123/logs?follow=true`,
  );
  assert.equal(followResponse.status, 400);
  assert.equal(
    (await followResponse.json()).detail.code,
    "FOLLOW_LOGS_REQUIRES_STREAM",
  );

  const invalidTailResponse = await fetch(
    `${baseUrl}/clusters/demo/pods/default/web-123/logs?tail=oops`,
  );
  assert.equal(invalidTailResponse.status, 422);
  assert.equal((await invalidTailResponse.json()).detail.code, "INVALID_QUERY");

  const invalidNamespaceResponse = await fetch(
    `${baseUrl}/clusters/demo/pods/default%2Fevil/web-123/yaml`,
  );
  assert.equal(invalidNamespaceResponse.status, 400);
  assert.equal(
    (await invalidNamespaceResponse.json()).detail.code,
    "INVALID_IDENTIFIER",
  );

  const missingResponse = await fetch(
    `${baseUrl}/clusters/demo/pods/default/missing-pod/yaml`,
  );
  assert.equal(missingResponse.status, 502);
  assert.equal((await missingResponse.json()).detail.code, "NOT_FOUND");
});
