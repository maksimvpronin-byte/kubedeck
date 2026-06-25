const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  buildPodExecPlan,
  handlePodExecRequest,
  matchPodExecRoute,
  requirePodExecConfirmation,
} = require("../dist/main/backend/routes/podExec.js");
const { RequestValidationError } = require("../dist/main/backend/validation.js");
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

function confirmation(target) {
  return {
    clusterId: target.clusterId,
    action: "exec",
    resource: "pods",
    namespace: target.namespace,
    name: target.name,
    typedName: target.name,
  };
}

test("pod exec route, plan, and confirmation contract", () => {
  const target = matchPodExecRoute(
    "POST",
    "/clusters/cluster-1/pods/default/demo/exec",
  );

  assert.deepEqual(target, {
    clusterId: "cluster-1",
    namespace: "default",
    name: "demo",
  });

  const plan = buildPodExecPlan(target, {
    command: "printf hello",
    container: "main",
    shell: "bash",
  });

  assert.deepEqual(plan.args, [
    "exec",
    "demo",
    "-n",
    "default",
    "-c",
    "main",
    "--",
    "bash",
    "-lc",
    "printf hello",
  ]);
  assert.equal(plan.timeoutSeconds, 60);
  assert.equal(plan.maxOutputBytes, 16 * 1024 * 1024);

  assert.doesNotThrow(() =>
    requirePodExecConfirmation(confirmation(target), target),
  );

  assert.throws(
    () =>
      requirePodExecConfirmation(
        { ...confirmation(target), typedName: "wrong" },
        target,
      ),
    (error) =>
      error instanceof RequestValidationError &&
      error.code === "CONFIRMATION_TYPED_NAME_MISMATCH",
  );
});

test("pod exec HTTP handler authorizes, executes, and audits metadata", async (t) => {
  const calls = [];
  const auditEvents = [];

  const runner = {
    async run(command) {
      calls.push(command);
      if (calls.length === 1) {
        return {
          ok: true,
          stdout: "yes\n",
          stderr: "",
          commandPreview: "kubectl auth can-i create pods/exec -n default",
          returnCode: 0,
        };
      }

      return {
        ok: true,
        stdout: "hello\n",
        stderr: "",
        commandPreview:
          'kubectl exec demo -n default -c main -- sh -lc "printf hello"',
        returnCode: 0,
      };
    },
  };

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handlePodExecRequest(
      request,
      response,
      pathname,
      fakeConfigStore(),
      { append: (event) => auditEvents.push(event) },
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

  const response = await fetch(
    `${baseUrl}/clusters/cluster-1/pods/default/demo/exec`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "printf hello",
        container: "main",
        shell: "sh",
        confirmation: confirmation({
          clusterId: "cluster-1",
          namespace: "default",
          name: "demo",
        }),
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    stdout: "hello\n",
    stderr: "",
    commandPreview:
      'kubectl exec demo -n default -c main -- sh -lc "printf hello"',
    returnCode: 0,
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, [
    "auth",
    "can-i",
    "create",
    "pods/exec",
    "-n",
    "default",
  ]);
  assert.deepEqual(calls[1].args, [
    "exec",
    "demo",
    "-n",
    "default",
    "-c",
    "main",
    "--",
    "sh",
    "-lc",
    "printf hello",
  ]);

  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "pod.exec");
  assert.equal(auditEvents[0].status, "success");
  assert.equal(auditEvents[0].extra.container, "main");
  assert.equal(auditEvents[0].extra.shell, "sh");
  assert.equal("stdout" in auditEvents[0], false);
  assert.equal("stderr" in auditEvents[0], false);
});

test("pod exec rejects denied authorization and invalid requests", async (t) => {
  const runner = {
    async run() {
      return {
        ok: true,
        stdout: "no\n",
        stderr: "",
        commandPreview: "kubectl auth can-i create pods/exec -n default",
        returnCode: 0,
      };
    },
  };

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    handlePodExecRequest(
      request,
      response,
      pathname,
      fakeConfigStore(),
      { append: () => {} },
      runner,
      () => {},
    );
  });

  const baseUrl = await listen(server);
  t.after(() => close(server));

  const denied = await fetch(
    `${baseUrl}/clusters/cluster-1/pods/default/demo/exec`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "id",
        shell: "sh",
        confirmation: confirmation({
          clusterId: "cluster-1",
          namespace: "default",
          name: "demo",
        }),
      }),
    },
  );

  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).detail.code, "KUBECTL_AUTH_DENIED");

  const invalidShell = await fetch(
    `${baseUrl}/clusters/cluster-1/pods/default/demo/exec`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "id",
        shell: "powershell",
        confirmation: confirmation({
          clusterId: "cluster-1",
          namespace: "default",
          name: "demo",
        }),
      }),
    },
  );

  assert.equal(invalidShell.status, 400);
  assert.equal((await invalidShell.json()).detail.code, "INVALID_SHELL");

  const emptyCommand = await fetch(
    `${baseUrl}/clusters/cluster-1/pods/default/demo/exec`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "   ",
        shell: "sh",
        confirmation: confirmation({
          clusterId: "cluster-1",
          namespace: "default",
          name: "demo",
        }),
      }),
    },
  );

  assert.equal(emptyCommand.status, 400);
  assert.equal((await emptyCommand.json()).detail.code, "EMPTY_COMMAND");
});

test("pod exec maps kubectl failures and records failed audit metadata", async (t) => {
  const auditEvents = [];
  let calls = 0;

  const runner = {
    async run() {
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          stdout: "yes\n",
          stderr: "",
          commandPreview: "kubectl auth can-i create pods/exec -n default",
          returnCode: 0,
        };
      }

      throw new KubectlError({
        code: "NOT_FOUND",
        message: "kubectl command failed",
        rawStderr: 'container "missing" not found',
        commandPreview: "kubectl exec demo -n default -c missing -- sh -lc id",
      });
    },
  };

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    handlePodExecRequest(
      request,
      response,
      pathname,
      fakeConfigStore(),
      { append: (event) => auditEvents.push(event) },
      runner,
      () => {},
    );
  });

  const baseUrl = await listen(server);
  t.after(() => close(server));

  const response = await fetch(
    `${baseUrl}/clusters/cluster-1/pods/default/demo/exec`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "id",
        container: "missing",
        shell: "sh",
        confirmation: confirmation({
          clusterId: "cluster-1",
          namespace: "default",
          name: "demo",
        }),
      }),
    },
  );

  assert.notEqual(response.status, 200);
  assert.equal((await response.json()).detail.code, "NOT_FOUND");
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].status, "failed");
  assert.equal(auditEvents[0].extra.container, "missing");
});
