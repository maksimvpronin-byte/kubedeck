const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const { PassThrough } = require("node:stream");
const {
  ensureYamlSize,
  handleYamlRequest,
  MAX_APPLY_YAML_BYTES,
  matchYamlRoute,
  parseYamlApplyTarget,
  requireYamlApplyConfirmation,
} = require("../dist/main/backend/routes/yaml.js");
const {
  buildKubectlCommand,
  createKubectlCommand,
} = require("../dist/main/backend/kubectl/command.js");
const { KubectlError } = require("../dist/main/backend/kubectl/errors.js");
const { KubectlRunner } = require("../dist/main/backend/kubectl/runner.js");

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

function createFakeChild() {
  const child = new EventEmitter();
  child.pid = Math.floor(Math.random() * 100000) + 1000;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.kill = () => {
    child.killed = true;
    process.nextTick(() => child.emit("close", null, "SIGTERM"));
    return true;
  };
  return child;
}

test("YAML parsing and confirmation contract", () => {
  assert.deepEqual(
    matchYamlRoute("POST", "/clusters/demo/yaml/dry-run"),
    { clusterId: "demo", operation: "dry-run" },
  );
  assert.deepEqual(
    matchYamlRoute("PUT", "/clusters/demo/yaml/apply"),
    { clusterId: "demo", operation: "apply" },
  );
  assert.equal(matchYamlRoute("GET", "/clusters/demo/yaml/apply"), null);

  const target = parseYamlApplyTarget([
    "apiVersion: apps/v1",
    "kind: Deployment",
    "metadata:",
    "  name: demo-app",
    "  namespace: default",
    "spec:",
    "  replicas: 1",
    "",
  ].join("\n"));

  assert.deepEqual(target, {
    kind: "Deployment",
    namespace: "default",
    name: "demo-app",
    documentCount: 1,
  });

  assert.doesNotThrow(() => requireYamlApplyConfirmation({
    clusterId: "demo",
    action: "apply",
    resource: "yaml",
    namespace: "default",
    name: "demo-app",
    typedName: "demo-app",
  }, "demo", target));

  assert.throws(
    () => requireYamlApplyConfirmation({
      clusterId: "demo",
      action: "apply",
      resource: "yaml",
      namespace: "default",
      name: "demo-app",
      typedName: "wrong",
    }, "demo", target),
    (error) => error.code === "CONFIRMATION_TYPED_NAME_MISMATCH",
  );

  assert.throws(
    () => parseYamlApplyTarget("---\nkind: ConfigMap\nmetadata:\n  name: one\n---\nkind: ConfigMap\nmetadata:\n  name: two\n"),
    (error) => error.code === "MULTI_DOCUMENT_APPLY_BLOCKED",
  );

  assert.throws(
    () => parseYamlApplyTarget("kind: ConfigMap\nmetadata: []\n"),
    (error) => error.code === "INVALID_YAML_METADATA",
  );

  assert.equal(ensureYamlSize("kind: ConfigMap\n"), 16);
  assert.throws(
    () => ensureYamlSize("x".repeat(MAX_APPLY_YAML_BYTES + 1)),
    (error) => error.code === "PAYLOAD_TOO_LARGE" && error.statusCode === 413,
  );
});

test("kubectl runner sends YAML only through stdin", async () => {
  const state = { stdin: "" };
  const logs = [];

  const spawn = () => {
    const child = createFakeChild();
    const chunks = [];

    child.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stdin.on("end", () => {
      state.stdin = Buffer.concat(chunks).toString("utf8");
      process.nextTick(() => {
        child.stdout.end("configured\n");
        child.stderr.end();
        child.exitCode = 0;
        child.emit("close", 0, null);
      });
    });

    return child;
  };

  const secretYaml = "kind: Secret\nmetadata:\n  name: demo\nstringData:\n  password: never-log-this\n";
  const command = createKubectlCommand({
    clusterId: "demo",
    kubeconfigPath: "C:\\demo.yaml",
    kubectlPath: "kubectl",
    args: ["apply", "-f", "-"],
    timeoutSeconds: 5,
    maxOutputBytes: 1024,
    stdinText: secretYaml,
  });

  const preview = buildKubectlCommand(command).preview;
  assert.match(preview, /apply -f -/);
  assert.equal(preview.includes("never-log-this"), false);

  const runner = new KubectlRunner((message) => logs.push(message), spawn);
  const result = await runner.run(command);
  await runner.close();

  assert.equal(result.stdout, "configured\n");
  assert.equal(state.stdin, secretYaml);
  assert.equal(logs.some((line) => line.includes("stdinBytes=")), true);
  assert.equal(logs.join("\n").includes("never-log-this"), false);
});

test("YAML dry-run and apply HTTP contract", async (t) => {
  const commands = [];
  const auditEvents = [];
  const invalidated = [];

  const configStore = {
    load() {
      return { settings: { kubectlPath: "kubectl" } };
    },
    getCluster(clusterId) {
      assert.equal(clusterId, "demo");
      return { kubeconfigPath: "C:\\demo.yaml" };
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
      if (command.stdinText.includes("force-kubectl-error")) {
        throw new KubectlError({
          code: "KUBECTL_COMMAND_FAILED",
          message: "kubectl command failed",
          rawStderr: "invalid object",
          commandPreview: "kubectl apply --dry-run=server -f - -o yaml",
        });
      }

      const dryRun = command.args.includes("--dry-run=server");
      return {
        ok: true,
        stdout: dryRun ? "kind: ConfigMap\nmetadata:\n  name: demo\n" : "configmap/demo configured\n",
        stderr: "",
        commandPreview: dryRun
          ? "kubectl apply --dry-run=server -f - -o yaml"
          : "kubectl apply -f -",
        returnCode: 0,
      };
    },
  };

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handleYamlRequest(
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

  const secretYaml = [
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    "  name: demo-secret",
    "  namespace: default",
    "stringData:",
    "  password: never-write-this-to-audit",
    "",
  ].join("\n");

  const dryRunResponse = await fetch(`${baseUrl}/clusters/demo/yaml/dry-run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yaml: secretYaml }),
  });
  assert.equal(dryRunResponse.status, 200);
  assert.match(await dryRunResponse.text(), /kind: ConfigMap/);
  assert.deepEqual(commands[0].args, [
    "apply",
    "--dry-run=server",
    "-f",
    "-",
    "-o",
    "yaml",
  ]);
  assert.equal(commands[0].stdinText, secretYaml);
  assert.equal(JSON.stringify(auditEvents).includes("never-write-this-to-audit"), false);
  assert.equal(auditEvents[0].action, "yaml.dry-run");

  const applyYaml = [
    "apiVersion: v1",
    "kind: ConfigMap",
    "metadata:",
    "  name: demo-config",
    "  namespace: default",
    "data:",
    "  key: value",
    "",
  ].join("\n");

  const applyResponse = await fetch(`${baseUrl}/clusters/demo/yaml/apply`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      yaml: applyYaml,
      confirmation: {
        clusterId: "demo",
        action: "apply",
        resource: "yaml",
        namespace: "default",
        name: "demo-config",
        typedName: "demo-config",
      },
    }),
  });
  assert.equal(applyResponse.status, 200);
  assert.equal(await applyResponse.text(), "configmap/demo configured\n");
  assert.deepEqual(commands[1].args, ["apply", "-f", "-"]);
  assert.equal(commands[1].stdinText, applyYaml);
  assert.deepEqual(invalidated, ["demo"]);
  assert.equal(auditEvents[1].action, "yaml.apply");
  assert.equal(auditEvents[1].extra.kind, "ConfigMap");

  const missingConfirmation = await fetch(`${baseUrl}/clusters/demo/yaml/apply`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yaml: applyYaml }),
  });
  assert.equal(missingConfirmation.status, 400);
  assert.equal((await missingConfirmation.json()).detail.code, "CONFIRMATION_REQUIRED");

  const multiDocument = await fetch(`${baseUrl}/clusters/demo/yaml/apply`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      yaml: "---\nkind: ConfigMap\nmetadata:\n  name: one\n---\nkind: ConfigMap\nmetadata:\n  name: two\n",
      confirmation: {},
    }),
  });
  assert.equal(multiDocument.status, 400);
  assert.equal((await multiDocument.json()).detail.code, "MULTI_DOCUMENT_APPLY_BLOCKED");

  const failedDryRun = await fetch(`${baseUrl}/clusters/demo/yaml/dry-run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yaml: "force-kubectl-error" }),
  });
  assert.equal(failedDryRun.status, 502);
  assert.equal((await failedDryRun.json()).detail.code, "KUBECTL_COMMAND_FAILED");
  assert.equal(auditEvents.at(-1).action, "yaml.dry-run");
  assert.equal(auditEvents.at(-1).status, "failed");
});
