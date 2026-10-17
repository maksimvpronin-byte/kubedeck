const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  buildResourceActionPlan,
  handleResourceActionRequest,
  matchResourceActionRoute,
  normalizeNodeLabelChanges,
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
  assert.deepEqual(matchResourceActionRoute("POST", "/clusters/cluster-1/resources/deployments/default/demo/action"), target());
  assert.equal(matchResourceActionRoute("GET", "/clusters/cluster-1/resources/deployments/default/demo/action"), null);
  // A name kubectl would read as a flag never becomes an argument.
  assert.throws(() => matchResourceActionRoute("POST", "/clusters/cluster-1/resources/pods/default/--all/action"), { code: "INVALID_IDENTIFIER" });
  assert.throws(() => matchResourceActionRoute("POST", "/clusters/cluster-1/resources/pods/-A/demo/action"), { code: "INVALID_IDENTIFIER" });

  const deletePlan = buildResourceActionPlan(target("pods"), "delete");
  assert.deepEqual(deletePlan.args, ["delete", "pods", "demo", "--force", "--grace-period=0", "--wait=false", "-n", "default"]);
  assert.deepEqual(deletePlan.authorizationChecks, [
    {
      verb: "delete",
      resource: "pods",
      namespace: "default",
    },
  ]);
  const deploymentDeletePlan = buildResourceActionPlan(target(), "delete");
  assert.doesNotMatch(deploymentDeletePlan.args.join(" "), /--force|--grace-period/);

  const restartPlan = buildResourceActionPlan(target(), "restart");
  assert.deepEqual(restartPlan.args, ["rollout", "restart", "deployments/demo", "-n", "default"]);
  assert.deepEqual(restartPlan.authorizationChecks, [
    {
      verb: "patch",
      resource: "deployments",
      namespace: "default",
    },
  ]);

  const scalePlan = buildResourceActionPlan(target(), "scale", 3);
  assert.deepEqual(scalePlan.args, ["scale", "deployments/demo", "--replicas=3", "-n", "default"]);
  assert.equal(scalePlan.replicas, 3);

  const nodeTarget = target("nodes", "_cluster", "worker-1");
  const drainPlan = buildResourceActionPlan(nodeTarget, "drain");
  assert.deepEqual(drainPlan.args, ["drain", "worker-1", "--ignore-daemonsets", "--delete-emptydir-data", "--timeout=300s"]);
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

  // Running a CronJob by hand is creating one Job from its template: the
  // schedule is not touched, and the name comes from the caller so the command
  // the confirmation showed is the command that runs.
  const cronjobTarget = target("cronjobs", "default", "nightly");
  const triggerPlan = buildResourceActionPlan(cronjobTarget, "trigger", undefined, "nightly-manual-1750000000");
  assert.deepEqual(triggerPlan.args, ["create", "job", "nightly-manual-1750000000", "--from=cronjob/nightly", "-n", "default"]);
  assert.equal(triggerPlan.jobName, "nightly-manual-1750000000");
  assert.deepEqual(triggerPlan.authorizationChecks, [{ verb: "create", resource: "jobs", namespace: "default" }]);
  assert.throws(
    () => buildResourceActionPlan(target("deployments"), "trigger", undefined, "demo-manual-1"),
    (error) => error.code === "UNSUPPORTED_ACTION",
  );
  assert.throws(
    () => buildResourceActionPlan(cronjobTarget, "trigger"),
    (error) => error.code === "INVALID_JOB_NAME",
  );
  for (const invalid of ["-leading", "trailing-", "Upper", "with space", "a".repeat(64)]) {
    assert.throws(
      () => buildResourceActionPlan(cronjobTarget, "trigger", undefined, invalid),
      (error) => error.code === "INVALID_JOB_NAME",
      `${invalid} must be rejected as a job name`,
    );
  }
  // A CronJob that is not namespaced cannot produce a Job.
  assert.throws(
    () => buildResourceActionPlan(target("cronjobs", "_cluster", "nightly"), "trigger", undefined, "nightly-manual-1"),
    (error) => error.code === "INVALID_NAMESPACE",
  );
  // Mutating actions carry a typed confirmation; running a CronJob is one.
  assert.doesNotThrow(() => requireResourceActionConfirmation(confirmation(cronjobTarget, "trigger", "nightly"), cronjobTarget, triggerPlan));
  assert.throws(
    () => requireResourceActionConfirmation(confirmation(cronjobTarget, "trigger", ""), cronjobTarget, triggerPlan),
    (error) => error.code === "CONFIRMATION_TYPED_NAME_MISMATCH",
  );

  assert.doesNotThrow(() => requireResourceActionConfirmation(confirmation(target("pods"), "delete"), target("pods"), deletePlan));
  assert.doesNotThrow(() => requireResourceActionConfirmation(confirmation(target(), "restart", "demo"), target(), restartPlan));
  assert.throws(
    () => requireResourceActionConfirmation(confirmation(target(), "restart", "wrong"), target(), restartPlan),
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
  const restartResponse = await fetch(`${baseUrl}/clusters/cluster-1/resources/deployments/default/demo/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "restart",
      confirmation: confirmation(deploymentTarget, "restart", "demo"),
    }),
  });
  assert.equal(restartResponse.status, 200);
  assert.equal(await restartResponse.text(), "action completed\n");
  assert.deepEqual(commands[0].args, ["auth", "can-i", "patch", "deployments", "-n", "default"]);
  assert.deepEqual(commands[1].args, ["rollout", "restart", "deployments/demo", "-n", "default"]);
  assert.equal(auditEvents.at(-1).action, "resource.restart");
  assert.equal(auditEvents.at(-1).status, "success");
  assert.deepEqual(invalidated, ["cluster-1"]);

  const podsTarget = target("pods");
  const deleteResponse = await fetch(`${baseUrl}/clusters/cluster-1/resources/pods/default/demo/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "delete",
      confirmation: confirmation(podsTarget, "delete"),
    }),
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal(auditEvents.at(-1).action, "resource.delete");

  const badScaleResponse = await fetch(`${baseUrl}/clusters/cluster-1/resources/deployments/default/demo/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "scale",
      replicas: 2,
      confirmation: confirmation(deploymentTarget, "scale", "wrong"),
    }),
  });
  assert.equal(badScaleResponse.status, 400);
  assert.equal((await badScaleResponse.json()).detail.code, "CONFIRMATION_TYPED_NAME_MISMATCH");

  denyNextAuthorization = true;
  const deniedResponse = await fetch(`${baseUrl}/clusters/cluster-1/resources/deployments/default/demo/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "restart",
      confirmation: confirmation(deploymentTarget, "restart", "demo"),
    }),
  });
  denyNextAuthorization = false;
  assert.equal(deniedResponse.status, 403);
  assert.equal((await deniedResponse.json()).detail.code, "KUBECTL_AUTH_DENIED");

  failNextAction = true;
  const failedResponse = await fetch(`${baseUrl}/clusters/cluster-1/resources/deployments/default/demo/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "restart",
      confirmation: confirmation(deploymentTarget, "restart", "demo"),
    }),
  });
  assert.equal(failedResponse.status, 502);
  assert.equal((await failedResponse.json()).detail.code, "FORBIDDEN");
  assert.equal(auditEvents.at(-1).status, "failed");

  const nodeTarget = target("nodes", "_cluster", "worker-1");
  const commandCountBeforeDrain = commands.length;
  const drainResponse = await fetch(`${baseUrl}/clusters/cluster-1/resources/nodes/_cluster/worker-1/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "drain",
      confirmation: confirmation(nodeTarget, "drain"),
    }),
  });
  assert.equal(drainResponse.status, 200);
  const drainCommands = commands.slice(commandCountBeforeDrain);
  assert.deepEqual(
    drainCommands.map((command) => command.args),
    [
      ["auth", "can-i", "patch", "nodes"],
      ["auth", "can-i", "create", "pods/eviction", "--all-namespaces"],
      ["drain", "worker-1", "--ignore-daemonsets", "--delete-emptydir-data", "--timeout=300s"],
    ],
  );
  assert.equal(drainCommands.at(-1).timeoutSeconds, 330);

  const commandCountBeforeLabel = commands.length;
  const labelResponse = await fetch(`${baseUrl}/clusters/cluster-1/resources/nodes/_cluster/worker-1/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "label",
      labels: { set: { disktype: "ssd" }, remove: ["gpu"] },
      confirmation: confirmation(nodeTarget, "label"),
    }),
  });
  assert.equal(labelResponse.status, 200);
  assert.deepEqual(
    commands.slice(commandCountBeforeLabel).map((command) => command.args),
    [
      ["auth", "can-i", "patch", "nodes"],
      ["label", "nodes", "worker-1", "disktype=ssd", "gpu-", "--overwrite"],
    ],
  );
  assert.equal(auditEvents.at(-1).action, "resource.label");
  assert.deepEqual(auditEvents.at(-1).extra, { labels: { set: { disktype: "ssd" }, remove: ["gpu"] } });

  // A label kubelet owns is refused before anything runs, whatever sent it.
  const commandCountBeforeProtected = commands.length;
  const protectedResponse = await fetch(`${baseUrl}/clusters/cluster-1/resources/nodes/_cluster/worker-1/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "label",
      labels: { set: { "kubernetes.io/hostname": "elsewhere" } },
      confirmation: confirmation(nodeTarget, "label"),
    }),
  });
  assert.equal(protectedResponse.status, 400);
  assert.equal((await protectedResponse.json()).detail.code, "PROTECTED_LABEL");
  assert.equal(commands.length, commandCountBeforeProtected);
});

test("node label changes are validated before they become kubectl arguments", () => {
  const nodeTarget = target("nodes", "_cluster", "worker-1");
  const plan = buildResourceActionPlan(nodeTarget, "label", undefined, undefined, { set: { "example.com/rack": "r12", team: "" }, remove: ["gpu"] });
  assert.deepEqual(plan.args, ["label", "nodes", "worker-1", "example.com/rack=r12", "team=", "gpu-", "--overwrite"]);
  assert.deepEqual(plan.authorizationChecks, [{ verb: "patch", resource: "nodes", namespace: "_cluster" }]);
  assert.equal(plan.namespace, "_cluster");

  // A removal alone does not need --overwrite.
  assert.deepEqual(buildResourceActionPlan(nodeTarget, "label", undefined, undefined, { set: {}, remove: ["gpu"] }).args, ["label", "nodes", "worker-1", "gpu-"]);
  assert.throws(() => buildResourceActionPlan(target(), "label", undefined, undefined, { set: { a: "b" }, remove: [] }), { code: "UNSUPPORTED_ACTION" });

  const code = (labels) => {
    try {
      normalizeNodeLabelChanges(labels);
      return "ok";
    } catch (error) {
      return error.code;
    }
  };
  assert.equal(code(undefined), "INVALID_LABELS");
  assert.equal(code({ set: {}, remove: [] }), "INVALID_LABELS");
  assert.equal(code({ set: { gpu: "a100" }, remove: ["gpu"] }), "INVALID_LABELS");
  assert.equal(code({ set: { "--kubeconfig": "x" } }), "INVALID_LABEL_KEY");
  assert.equal(code({ remove: ["-n"] }), "INVALID_LABEL_KEY");
  assert.equal(code({ set: { "Example.com/rack": "r1" } }), "INVALID_LABEL_KEY");
  assert.equal(code({ set: { "a/b/c": "r1" } }), "INVALID_LABEL_KEY");
  assert.equal(code({ set: { team: "two words" } }), "INVALID_LABEL_VALUE");
  assert.equal(code({ set: { team: "-x" } }), "INVALID_LABEL_VALUE");
  assert.equal(code({ set: { team: "x".repeat(64) } }), "INVALID_LABEL_VALUE");
  assert.equal(code({ set: { team: 7 } }), "INVALID_LABEL_VALUE");
  assert.equal(code({ remove: ["kubernetes.io/arch"] }), "PROTECTED_LABEL");
  assert.equal(code({ set: { "node-role.kubernetes.io/worker": "", "topology.kubernetes.io/zone": "msk-a" } }), "ok");
});

const {
  chunkNames,
  changedNames,
  executeBulkResourceAction,
  handleBulkResourceActionRequest,
  matchBulkResourceActionRoute,
  parseBulkPayload,
} = require("../dist/main/backend/routes/bulkResourceActions.js");

function bulkHarness({ deny = () => false, fail = () => null } = {}) {
  const commands = [];
  const auditEvents = [];
  const configStore = {
    load: () => ({ settings: { kubectlPath: "kubectl" } }),
    getCluster: () => ({ kubeconfigPath: "/tmp/cluster-1.yaml" }),
  };
  const auditStore = { append: (event) => auditEvents.push(event) };
  const runner = {
    async run(command) {
      commands.push(command);
      const commandPreview = `kubectl ${command.args.join(" ")}`;
      if (command.args[0] === "auth") return { ok: true, stdout: deny(command.args) ? "no\n" : "yes\n", stderr: "", commandPreview, returnCode: 0 };
      // Let other workers start before this one finishes, as a real process would.
      await new Promise((resolve) => setImmediate(resolve));
      const failure = fail(command.args);
      if (failure) throw new KubectlError({ code: "KUBECTL_COMMAND_FAILED", message: "kubectl command failed", rawStderr: failure.stderr, commandPreview }, failure.stdout ?? "");
      return { ok: true, stdout: "", stderr: "", commandPreview, returnCode: 0 };
    },
  };
  return { commands, auditEvents, configStore, auditStore, runner };
}

function bulkBody(resource, action, targets) {
  return {
    action,
    targets,
    confirmation: { clusterId: "cluster-1", action, resource, targets: targets.map(({ namespace, name }) => ({ namespace, name })) },
  };
}

async function runBulk(harness, resource, action, targets) {
  const route = { clusterId: "cluster-1", resource };
  return executeBulkResourceAction(route, parseBulkPayload(bulkBody(resource, action, targets), route), harness.configStore, harness.auditStore, harness.runner);
}

test("bulk delete asks once per namespace and names every object of a namespace in one command", async () => {
  const harness = bulkHarness();
  const results = await runBulk(harness, "pods", "delete", [
    { namespace: "default", name: "a" },
    { namespace: "tools", name: "c" },
    { namespace: "default", name: "b" },
  ]);
  assert.deepEqual(
    harness.commands.map((command) => command.args),
    [
      ["auth", "can-i", "delete", "pods", "-n", "default"],
      ["auth", "can-i", "delete", "pods", "-n", "tools"],
      ["delete", "pods", "a", "b", "--force", "--grace-period=0", "--wait=false", "-n", "default", "-o", "name"],
      ["delete", "pods", "c", "--force", "--grace-period=0", "--wait=false", "-n", "tools", "-o", "name"],
    ],
  );
  assert.deepEqual(
    results.map((result) => [result.namespace, result.name, result.ok]),
    [
      ["default", "a", true],
      ["tools", "c", true],
      ["default", "b", true],
    ],
  );
  assert.deepEqual(
    harness.auditEvents.map((event) => [event.action, event.status, event.namespace, event.name]),
    [
      ["resource.delete", "success", "default", "a"],
      ["resource.delete", "success", "default", "b"],
      ["resource.delete", "success", "tools", "c"],
    ],
  );

  // A cluster-scoped kind has no namespace flag at all.
  const scoped = bulkHarness();
  await runBulk(scoped, "namespaces", "delete", [
    { namespace: "_cluster", name: "one" },
    { namespace: "_cluster", name: "two" },
  ]);
  assert.deepEqual(scoped.commands.at(-1).args, ["delete", "namespaces", "one", "two", "--wait=false", "-o", "name"]);
});

test("a bulk delete that fails for some objects reports each one by what kubectl printed", async () => {
  const harness = bulkHarness({
    fail: (args) => (args[0] === "delete" ? { stdout: "pod/a\npod/c\n", stderr: 'Error from server (NotFound): pods "b" not found' } : null),
  });
  const results = await runBulk(harness, "pods", "delete", [
    { namespace: "default", name: "a" },
    { namespace: "default", name: "b" },
    { namespace: "default", name: "c" },
  ]);
  assert.deepEqual(
    results.map((result) => result.ok),
    [true, false, true],
  );
  assert.equal(results[1].error.code, "NOT_FOUND");
  assert.equal(results[1].error.message, 'Error from server (NotFound): pods "b" not found');
  assert.deepEqual(
    harness.auditEvents.map((event) => [event.name, event.status]),
    [
      ["a", "success"],
      ["b", "failed"],
      ["c", "success"],
    ],
  );

  // A command that failed before it reached any object fails all of them.
  const down = bulkHarness({ fail: (args) => (args[0] === "delete" ? { stderr: "connection refused" } : null) });
  const downResults = await runBulk(down, "pods", "delete", [
    { namespace: "default", name: "a" },
    { namespace: "default", name: "b" },
  ]);
  assert.deepEqual(
    downResults.map((result) => [result.ok, result.error.message]),
    [
      [false, "kubectl command failed"],
      [false, "kubectl command failed"],
    ],
  );
});

test("a refused permission fails only the objects that needed it", async () => {
  const harness = bulkHarness({ deny: (args) => args.includes("tools") });
  const results = await runBulk(harness, "pods", "delete", [
    { namespace: "default", name: "a" },
    { namespace: "tools", name: "c" },
  ]);
  assert.deepEqual(
    results.map((result) => [result.name, result.ok, result.error?.code]),
    [
      ["a", true, undefined],
      ["c", false, "KUBECTL_AUTH_DENIED"],
    ],
  );
  assert.equal(harness.commands.filter((command) => command.args[0] === "delete").length, 1);
});

function trackConcurrency(harness) {
  const state = { running: 0, peak: 0 };
  const run = harness.runner.run;
  harness.runner.run = async (command) => {
    state.running += 1;
    state.peak = Math.max(state.peak, state.running);
    try {
      return await run(command);
    } finally {
      state.running -= 1;
    }
  };
  return state;
}

// What kubectl does with a name it cannot find: it looks every node up before
// it changes any, so the whole command stops and nothing is printed.
const missingNode = (name) => (args) => (args[0] === "cordon" && args.includes(name) ? { stderr: `Error from server (NotFound): nodes "${name}" not found` } : null);

test("bulk drain cordons every node in one command, then drains five at a time", async () => {
  const harness = bulkHarness({ fail: missingNode("node-2") });
  const concurrency = trackConcurrency(harness);
  const names = Array.from({ length: 8 }, (_, index) => `node-${index}`);
  const results = await runBulk(
    harness,
    "nodes",
    "drain",
    names.map((name) => ({ namespace: "_cluster", name })),
  );
  const args = harness.commands.map((command) => command.args);
  assert.deepEqual(args.slice(0, 4), [
    ["auth", "can-i", "patch", "nodes"],
    ["auth", "can-i", "create", "pods/eviction", "--all-namespaces"],
    ["cordon", ...names],
    // node-2 stopped the first cordon; the rest are cordoned without it.
    ["cordon", ...names.filter((name) => name !== "node-2")],
  ]);
  // node-2 could not be cordoned, so it is not drained either.
  assert.deepEqual(
    args
      .slice(4)
      .map((entry) => entry[1])
      .sort(),
    names.filter((name) => name !== "node-2"),
  );
  assert.ok(args.slice(4).every((entry) => entry[0] === "drain"));
  assert.equal(concurrency.peak, 5);
  assert.deepEqual(
    results.filter((result) => !result.ok).map((result) => [result.name, result.error.code]),
    [["node-2", "NOT_FOUND"]],
  );
  assert.equal(harness.auditEvents.filter((event) => event.action === "resource.cordon").length, 8);
  assert.equal(harness.auditEvents.filter((event) => event.action === "resource.drain").length, 7);
});

test("bulk cordon names every node in one command and reads back each one", async () => {
  const harness = bulkHarness();
  const nodes = ["node-1", "node-2", "node-3"].map((name) => ({ namespace: "_cluster", name }));
  const results = await runBulk(harness, "nodes", "uncordon", nodes);
  assert.deepEqual(
    harness.commands.map((command) => command.args),
    [
      ["auth", "can-i", "patch", "nodes"],
      ["uncordon", "node-1", "node-2", "node-3"],
    ],
  );
  assert.ok(results.every((result) => result.ok));

  // A command that got through some nodes is not repeated for the rest.
  const partial = bulkHarness({
    fail: (args) => (args[0] === "cordon" ? { stdout: "node/node-1 cordoned\nnode/node-2 already cordoned\n", stderr: 'Error from server (Forbidden): nodes "node-3" is forbidden' } : null),
  });
  const partialResults = await runBulk(partial, "nodes", "cordon", nodes);
  assert.equal(partial.commands.filter((command) => command.args[0] === "cordon").length, 1);
  assert.deepEqual(
    partialResults.map((result) => [result.name, result.ok, result.error?.code]),
    [
      ["node-1", true, undefined],
      ["node-2", true, undefined],
      ["node-3", false, "FORBIDDEN"],
    ],
  );

  // A failure that names no node fails them all, with no second attempt.
  const down = bulkHarness({ fail: (args) => (args[0] === "cordon" ? { stderr: "connection refused" } : null) });
  const downResults = await runBulk(down, "nodes", "cordon", nodes);
  assert.equal(down.commands.filter((command) => command.args[0] === "cordon").length, 1);
  assert.ok(downResults.every((result) => !result.ok));
});

test("bulk labels ask once and run every node's own command side by side", async () => {
  const labels = bulkHarness();
  await runBulk(labels, "nodes", "label", [
    { namespace: "_cluster", name: "node-1", labels: { set: { disktype: "ssd" }, remove: [] } },
    { namespace: "_cluster", name: "node-2", labels: { set: {}, remove: ["gpu"] } },
  ]);
  assert.deepEqual(
    labels.commands.map((command) => command.args),
    [
      ["auth", "can-i", "patch", "nodes"],
      ["label", "nodes", "node-1", "disktype=ssd", "--overwrite"],
      ["label", "nodes", "node-2", "gpu-"],
    ],
  );
  assert.deepEqual(labels.auditEvents.at(-1).extra, { labels: { set: {}, remove: ["gpu"] } });
});

test("a bulk request runs only what its confirmation lists", () => {
  const route = { clusterId: "cluster-1", resource: "pods" };
  const targets = [
    { namespace: "default", name: "a" },
    { namespace: "default", name: "b" },
  ];
  const code = (body) => {
    try {
      parseBulkPayload(body, route);
      return "ok";
    } catch (error) {
      return error.code;
    }
  };
  assert.equal(code(bulkBody("pods", "delete", targets)), "ok");
  assert.equal(code({ ...bulkBody("pods", "delete", targets), confirmation: bulkBody("pods", "delete", targets.slice(0, 1)).confirmation }), "CONFIRMATION_TARGETS_MISMATCH");
  assert.equal(code({ ...bulkBody("pods", "delete", targets), confirmation: bulkBody("pods", "delete", [...targets].reverse()).confirmation }), "CONFIRMATION_TARGETS_MISMATCH");
  assert.equal(code({ ...bulkBody("pods", "delete", targets), confirmation: undefined }), "CONFIRMATION_CLUSTER_MISMATCH");
  assert.equal(code({ ...bulkBody("pods", "delete", targets), confirmation: { ...bulkBody("pods", "delete", targets).confirmation, action: "drain" } }), "CONFIRMATION_ACTION_MISMATCH");
  assert.equal(code(bulkBody("pods", "delete", [targets[0], targets[0]])), "DUPLICATE_TARGET");
  assert.equal(code(bulkBody("pods", "restart", targets)), "UNSUPPORTED_ACTION");
  assert.equal(code(bulkBody("pods", "delete", [])), "INVALID_TARGETS");
  assert.equal(code(bulkBody("pods", "delete", [{ namespace: "default", name: "--all" }])), "INVALID_IDENTIFIER");
  assert.equal(code(bulkBody("pods", "delete", [{ namespace: "--all-namespaces", name: "a" }])), "INVALID_IDENTIFIER");
  assert.equal(code(bulkBody("nodes", "label", [{ namespace: "_cluster", name: "n", labels: { set: { "kubernetes.io/os": "x" } } }])), "PROTECTED_LABEL");

  assert.deepEqual(matchBulkResourceActionRoute("POST", "/clusters/cluster-1/resources/Pods/bulk-action"), route);
  assert.equal(matchBulkResourceActionRoute("GET", "/clusters/cluster-1/resources/pods/bulk-action"), null);
  assert.equal(matchBulkResourceActionRoute("POST", "/clusters/cluster-1/resources/pods/default/a/action"), null);

  assert.deepEqual(
    chunkNames(Array.from({ length: 120 }, (_, index) => `p${index}`)).map((chunk) => chunk.length),
    [50, 50, 20],
  );
  assert.deepEqual(
    chunkNames(Array.from({ length: 40 }, (_, index) => `${"x".repeat(250)}${index}`)).map((chunk) => chunk.length),
    [31, 9],
  );
  assert.deepEqual([...changedNames("pod/a\ndeployment.apps/web\r\n\n")], ["a", "web"]);
  assert.deepEqual([...changedNames("node/n1 cordoned\nnode/n2 already uncordoned (server dry run)\nWarning: something\n")], ["n1", "n2"]);
});

test("bulk action HTTP handler answers with a result per object", async (t) => {
  const harness = bulkHarness({ fail: missingNode("node-2") });
  const invalidated = [];
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (
      !handleBulkResourceActionRequest(
        request,
        response,
        pathname,
        harness.configStore,
        harness.auditStore,
        harness.runner,
        () => {},
        async (id) => invalidated.push(id),
      )
    ) {
      response.statusCode = 404;
      response.end();
    }
  });
  const baseUrl = await listen(server);
  t.after(async () => close(server));

  const nodes = ["node-1", "node-2"].map((name) => ({ namespace: "_cluster", name }));
  const response = await fetch(`${baseUrl}/clusters/cluster-1/resources/nodes/bulk-action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bulkBody("nodes", "cordon", nodes)),
  });
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert.deepEqual(
    results.map((result) => [result.name, result.ok]),
    [
      ["node-1", true],
      ["node-2", false],
    ],
  );
  assert.deepEqual(invalidated, ["cluster-1"]);

  const before = harness.commands.length;
  const refused = await fetch(`${baseUrl}/clusters/cluster-1/resources/pods/bulk-action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bulkBody("pods", "cordon", [{ namespace: "default", name: "a" }])),
  });
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).detail.code, "UNSUPPORTED_ACTION");
  assert.equal(harness.commands.length, before);
});
