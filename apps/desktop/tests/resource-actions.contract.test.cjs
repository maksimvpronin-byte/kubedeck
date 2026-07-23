const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  buildResourceActionPlan,
  handleResourceActionRequest,
  matchResourceActionRoute,
  requireResourceActionConfirmation,
} = require("../dist/main/backend/routes/resourceActions.js");
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

function target(resource = "deployments", namespace = "default", name = "demo") {
  return { clusterId: "cluster-1", resource, namespace, name };
}

function confirmation(routeTarget, action, typedName = "") {
  return {
    clusterId: routeTarget.clusterId,
    action,
    resource: routeTarget.resource,
    namespace: routeTarget.namespace,
    name: routeTarget.name,
    typedName,
  };
}

test("resource action route, plans and confirmation contract", () => {
  assert.deepEqual(
    matchResourceActionRoute(
      "POST",
      "/clusters/cluster-1/resources/deployments/default/demo/action",
    ),
    target(),
  );
  assert.equal(
    matchResourceActionRoute(
      "GET",
      "/clusters/cluster-1/resources/deployments/default/demo/action",
    ),
    null,
  );

  const deletePlan = buildResourceActionPlan(target("pods"), "delete");
  assert.deepEqual(deletePlan.args, [
    "delete",
    "pods",
    "demo",
    "--force",
    "--grace-period=0",
    "--wait=false",
    "-n",
    "default",
  ]);
  assert.deepEqual(deletePlan.authorizationChecks, [{
    verb: "delete",
    resource: "pods",
    namespace: "default",
  }]);
  const deploymentDeletePlan = buildResourceActionPlan(target(), "delete");
  assert.doesNotMatch(deploymentDeletePlan.args.join(" "), /--force|--grace-period/);

  const restartPlan = buildResourceActionPlan(target(), "restart");
  assert.deepEqual(restartPlan.args, [
    "rollout",
    "restart",
    "deployments/demo",
    "-n",
    "default",
  ]);
  assert.deepEqual(restartPlan.authorizationChecks, [{
    verb: "patch",
    resource: "deployments",
    namespace: "default",
  }]);

  const scalePlan = buildResourceActionPlan(target(), "scale", 3);
  assert.deepEqual(scalePlan.args, [
    "scale",
    "deployments/demo",
    "--replicas=3",
    "-n",
    "default",
  ]);
  assert.equal(scalePlan.replicas, 3);

  const nodeTarget = target("nodes", "_cluster", "worker-1");
  const drainPlan = buildResourceActionPlan(nodeTarget, "drain");
  assert.deepEqual(drainPlan.args, [
    "drain",
    "worker-1",
    "--ignore-daemonsets",
    "--delete-emptydir-data",
    "--timeout=300s",
  ]);
  assert.equal(drainPlan.timeoutSeconds, 330);
  assert.deepEqual(drainPlan.authorizationChecks, [
    { verb: "patch", resource: "nodes", namespace: "_cluster" },
    {
      verb: "create",
      resource: "pods/eviction",
      namespace: "_cluster",
      allNamespaces: true,
    },
  ]);

  assert.doesNotThrow(() => requireResourceActionConfirmation(
    confirmation(target("pods"), "delete"),
    target("pods"),
    deletePlan,
  ));
  assert.doesNotThrow(() => requireResourceActionConfirmation(
    confirmation(target(), "restart", "demo"),
    target(),
    restartPlan,
  ));
  assert.throws(
    () => requireResourceActionConfirmation(
      confirmation(target(), "restart", "wrong"),
      target(),
      restartPlan,
    ),
    (error) => error.code === "CONFIRMATION_TYPED_NAME_MISMATCH",
  );
  assert.throws(
    () => buildResourceActionPlan(target("services"), "scale", 2),
    (error) => error.code === "UNSUPPORTED_ACTION",
  );
  assert.throws(
    () => buildResourceActionPlan(target(), "scale", -1),
    (error) => error.code === "INVALID_REPLICAS",
  );
});

test("resource action HTTP handler contract", async (t) => {
  const commands = [];
  const auditEvents = [];
  const invalidated = [];
  let denyNextAuthorization = false;
  let failNextAction = false;

  const configStore = {
    load() {
      return { settings: { kubectlPath: "kubectl" } };
    },
    getCluster(clusterId) {
      assert.equal(clusterId, "cluster-1");
      return { kubeconfigPath: "C:\\KubeDeck\\cluster-1.yaml" };
    },
  };

  const auditStore = {
    append(event) {
      auditEvents.push(event);
    },
  };

  const runner = {
    async run(command) {
      commands.push(command);
      if (command.args[0] === "auth") {
        return {
          ok: true,
          stdout: denyNextAuthorization ? "no\n" : "yes\n",
          stderr: "",
          commandPreview: `kubectl ${command.args.join(" ")}`,
          returnCode: 0,
        };
      }
      if (failNextAction) {
        failNextAction = false;
        throw new KubectlError({
          code: "FORBIDDEN",
          message: "kubectl command failed",
          rawStderr: "forbidden",
          commandPreview: `kubectl ${command.args.join(" ")}`,
        });
      }
      return {
        ok: true,
        stdout: "action completed\n",
        stderr: "",
        commandPreview: `kubectl ${command.args.join(" ")}`,
        returnCode: 0,
      };
    },
  };

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handleResourceActionRequest(
      request,
      response,
      pathname,
      configStore,
      auditStore,
      runner,
      () => {},
      async (clusterId) => invalidated.push(clusterId),
    );

    if (!handled) {
      response.statusCode = 404;
      response.end();
    }
  });

  const baseUrl = await listen(server);
  t.after(async () => close(server));

  const deploymentTarget = target();
  const restartResponse = await fetch(
    `${baseUrl}/clusters/cluster-1/resources/deployments/default/demo/action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "restart",
        confirmation: confirmation(deploymentTarget, "restart", "demo"),
      }),
    },
  );
  assert.equal(restartResponse.status, 200);
  assert.equal(await restartResponse.text(), "action completed\n");
  assert.deepEqual(commands[0].args, [
    "auth",
    "can-i",
    "patch",
    "deployments",
    "-n",
    "default",
  ]);
  assert.deepEqual(commands[1].args, [
    "rollout",
    "restart",
    "deployments/demo",
    "-n",
    "default",
  ]);
  assert.equal(auditEvents.at(-1).action, "resource.restart");
  assert.equal(auditEvents.at(-1).status, "success");
  assert.deepEqual(invalidated, ["cluster-1"]);

  const podsTarget = target("pods");
  const deleteResponse = await fetch(
    `${baseUrl}/clusters/cluster-1/resources/pods/default/demo/action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete",
        confirmation: confirmation(podsTarget, "delete"),
      }),
    },
  );
  assert.equal(deleteResponse.status, 200);
  assert.equal(auditEvents.at(-1).action, "resource.delete");

  const badScaleResponse = await fetch(
    `${baseUrl}/clusters/cluster-1/resources/deployments/default/demo/action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "scale",
        replicas: 2,
        confirmation: confirmation(deploymentTarget, "scale", "wrong"),
      }),
    },
  );
  assert.equal(badScaleResponse.status, 400);
  assert.equal(
    (await badScaleResponse.json()).detail.code,
    "CONFIRMATION_TYPED_NAME_MISMATCH",
  );

  denyNextAuthorization = true;
  const deniedResponse = await fetch(
    `${baseUrl}/clusters/cluster-1/resources/deployments/default/demo/action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "restart",
        confirmation: confirmation(deploymentTarget, "restart", "demo"),
      }),
    },
  );
  denyNextAuthorization = false;
  assert.equal(deniedResponse.status, 403);
  assert.equal((await deniedResponse.json()).detail.code, "KUBECTL_AUTH_DENIED");

  failNextAction = true;
  const failedResponse = await fetch(
    `${baseUrl}/clusters/cluster-1/resources/deployments/default/demo/action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "restart",
        confirmation: confirmation(deploymentTarget, "restart", "demo"),
      }),
    },
  );
  assert.equal(failedResponse.status, 502);
  assert.equal((await failedResponse.json()).detail.code, "FORBIDDEN");
  assert.equal(auditEvents.at(-1).status, "failed");

  const nodeTarget = target("nodes", "_cluster", "worker-1");
  const commandCountBeforeDrain = commands.length;
  const drainResponse = await fetch(
    `${baseUrl}/clusters/cluster-1/resources/nodes/_cluster/worker-1/action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "drain",
        confirmation: confirmation(nodeTarget, "drain"),
      }),
    },
  );
  assert.equal(drainResponse.status, 200);
  const drainCommands = commands.slice(commandCountBeforeDrain);
  assert.deepEqual(drainCommands.map((command) => command.args), [
    ["auth", "can-i", "patch", "nodes"],
    ["auth", "can-i", "create", "pods/eviction", "--all-namespaces"],
    [
      "drain",
      "worker-1",
      "--ignore-daemonsets",
      "--delete-emptydir-data",
      "--timeout=300s",
    ],
  ]);
  assert.equal(drainCommands.at(-1).timeoutSeconds, 330);
});
