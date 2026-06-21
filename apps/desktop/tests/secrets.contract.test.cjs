const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  decodeBase64Strict,
  handleSecretRequest,
  isBinaryPayload,
  matchSecretRoute,
  SECRET_VALUE_MAX_BYTES,
  secretKeysPayload,
} = require("../dist/main/backend/routes/secrets.js");
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

test("Secret parsing and metadata contract", () => {
  assert.deepEqual(
    matchSecretRoute("GET", "/clusters/demo/secrets/default/app/keys"),
    {
      clusterId: "demo",
      namespace: "default",
      name: "app",
      operation: "keys",
    },
  );
  assert.deepEqual(
    matchSecretRoute("POST", "/clusters/demo/secrets/default/app/reveal"),
    {
      clusterId: "demo",
      namespace: "default",
      name: "app",
      operation: "reveal",
    },
  );
  assert.equal(
    matchSecretRoute("GET", "/clusters/demo/secrets/default/app/reveal"),
    null,
  );

  assert.equal(decodeBase64Strict("aGVsbG8=").toString("utf8"), "hello");
  assert.equal(decodeBase64Strict("").length, 0);
  assert.throws(() => decodeBase64Strict("aGVsbG8"), /invalid base64/);
  assert.throws(() => decodeBase64Strict("%%%="), /invalid base64/);

  assert.equal(isBinaryPayload(Buffer.from("plain text\n", "utf8")), false);
  assert.equal(isBinaryPayload(Buffer.from([0, 1, 2])), true);
  assert.equal(isBinaryPayload(Buffer.alloc(0)), false);

  const target = {
    clusterId: "demo",
    namespace: "default",
    name: "app",
    operation: "keys",
  };
  const payload = secretKeysPayload({
    type: "kubernetes.io/tls",
    immutable: true,
    metadata: { namespace: "actual-ns", name: "actual-name" },
    data: {
      text: "aGVsbG8=",
      binary: "AAEC",
      invalid: "%%%",
      empty: "",
    },
  }, target, 45);

  assert.equal(payload.type, "kubernetes.io/tls");
  assert.equal(payload.immutable, true);
  assert.equal(payload.namespace, "actual-ns");
  assert.equal(payload.name, "actual-name");
  assert.equal(payload.revealTimeoutSeconds, 45);
  assert.deepEqual(payload.keys.map((item) => item.key), [
    "binary",
    "empty",
    "invalid",
    "text",
  ]);
  assert.deepEqual(payload.keys.find((item) => item.key === "text"), {
    key: "text",
    encodedBytes: 8,
    decodedBytes: 5,
    validBase64: true,
    binary: false,
  });
  assert.equal(payload.keys.find((item) => item.key === "binary").binary, true);
  assert.equal(payload.keys.find((item) => item.key === "invalid").validBase64, false);
});

test("Secret HTTP handler does not log or audit decoded values", async (t) => {
  const commands = [];
  const auditEvents = [];
  const logs = [];
  const secretValue = "never-log-this-secret-value";
  const largeEncoded = Buffer.alloc(SECRET_VALUE_MAX_BYTES + 1, 65).toString("base64");

  const configStore = {
    load() {
      return {
        settings: {
          kubectlPath: "kubectl",
          secretRevealTimeoutSeconds: 45,
        },
      };
    },
    getCluster(clusterId) {
      assert.equal(clusterId, "demo");
      return { kubeconfigPath: "C:\\KubeDeck\\demo.yaml" };
    },
  };

  const auditStore = {
    append(event) {
      auditEvents.push(event);
    },
  };

  const runner = {
    async runJson(command) {
      commands.push(command);
      const name = command.args[2];

      if (name === "missing-secret") {
        throw new KubectlError({
          code: "NOT_FOUND",
          message: "secret not found",
          rawStderr: "[redacted sensitive line]",
          commandPreview: "[redacted sensitive line]",
        });
      }

      if (name === "large-secret") {
        return {
          type: "Opaque",
          metadata: { namespace: "default", name },
          data: { huge: largeEncoded },
        };
      }

      return {
        type: "Opaque",
        immutable: false,
        metadata: { namespace: "default", name },
        data: {
          text: Buffer.from(secretValue, "utf8").toString("base64"),
          binary: Buffer.from([0, 1, 2]).toString("base64"),
          empty: "",
          invalid: "%%%",
        },
      };
    },
  };

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handleSecretRequest(
      request,
      response,
      pathname,
      configStore,
      auditStore,
      runner,
      (message) => logs.push(message),
    );

    if (!handled) {
      response.statusCode = 404;
      response.end();
    }
  });

  const baseUrl = await listen(server);
  t.after(async () => close(server));

  const keysResponse = await fetch(
    `${baseUrl}/clusters/demo/secrets/default/app-secret/keys`,
  );
  assert.equal(keysResponse.status, 200);
  const keys = await keysResponse.json();
  assert.equal(keys.name, "app-secret");
  assert.equal(keys.revealTimeoutSeconds, 45);
  assert.deepEqual(keys.keys.map((item) => item.key), [
    "binary",
    "empty",
    "invalid",
    "text",
  ]);
  assert.deepEqual(commands.at(-1).args, [
    "get",
    "secret",
    "app-secret",
    "-n",
    "default",
    "-o",
    "json",
  ]);
  assert.equal(commands.at(-1).timeoutSeconds, 30);
  assert.equal(commands.at(-1).maxOutputBytes, 8 * 1024 * 1024);

  const revealResponse = await fetch(
    `${baseUrl}/clusters/demo/secrets/default/app-secret/reveal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "text" }),
    },
  );
  assert.equal(revealResponse.status, 200);
  assert.deepEqual(await revealResponse.json(), {
    key: "text",
    value: secretValue,
    decodedBytes: Buffer.byteLength(secretValue),
    binary: false,
    revealTimeoutSeconds: 45,
  });
  assert.equal(auditEvents.at(-1).action, "secret.reveal");
  assert.equal(auditEvents.at(-1).status, "success");
  assert.equal(auditEvents.at(-1).extra.decodedBytes, Buffer.byteLength(secretValue));

  const commandCountBeforeCopy = commands.length;
  const copyResponse = await fetch(
    `${baseUrl}/clusters/demo/secrets/default/app-secret/copy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "text" }),
    },
  );
  assert.equal(copyResponse.status, 200);
  assert.deepEqual(await copyResponse.json(), { ok: true });
  assert.equal(commands.length, commandCountBeforeCopy);
  assert.equal(auditEvents.at(-1).action, "secret.copy");

  const invalidBase64Response = await fetch(
    `${baseUrl}/clusters/demo/secrets/default/app-secret/reveal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "invalid" }),
    },
  );
  assert.equal(invalidBase64Response.status, 400);
  assert.equal(
    (await invalidBase64Response.json()).detail.code,
    "SECRET_VALUE_INVALID_BASE64",
  );
  assert.equal(auditEvents.at(-1).status, "failed");

  const missingKeyResponse = await fetch(
    `${baseUrl}/clusters/demo/secrets/default/app-secret/reveal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "missing" }),
    },
  );
  assert.equal(missingKeyResponse.status, 404);
  assert.equal(
    (await missingKeyResponse.json()).detail.code,
    "SECRET_KEY_NOT_FOUND",
  );

  const tooLargeResponse = await fetch(
    `${baseUrl}/clusters/demo/secrets/default/large-secret/reveal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "huge" }),
    },
  );
  assert.equal(tooLargeResponse.status, 413);
  assert.equal(
    (await tooLargeResponse.json()).detail.code,
    "SECRET_VALUE_TOO_LARGE",
  );
  assert.equal(auditEvents.at(-1).status, "failed");

  const invalidKeyResponse = await fetch(
    `${baseUrl}/clusters/demo/secrets/default/app-secret/reveal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "bad/key" }),
    },
  );
  assert.equal(invalidKeyResponse.status, 400);
  assert.equal((await invalidKeyResponse.json()).detail.code, "INVALID_IDENTIFIER");

  const missingBodyResponse = await fetch(
    `${baseUrl}/clusters/demo/secrets/default/app-secret/reveal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  assert.equal(missingBodyResponse.status, 422);
  assert.equal((await missingBodyResponse.json()).detail.code, "INVALID_REQUEST");

  const invalidNamespaceResponse = await fetch(
    `${baseUrl}/clusters/demo/secrets/default%2Fevil/app-secret/keys`,
  );
  assert.equal(invalidNamespaceResponse.status, 400);
  assert.equal(
    (await invalidNamespaceResponse.json()).detail.code,
    "INVALID_IDENTIFIER",
  );

  const missingSecretResponse = await fetch(
    `${baseUrl}/clusters/demo/secrets/default/missing-secret/keys`,
  );
  assert.equal(missingSecretResponse.status, 502);
  assert.equal((await missingSecretResponse.json()).detail.code, "NOT_FOUND");

  const serializedAudit = JSON.stringify(auditEvents);
  assert.equal(serializedAudit.includes(secretValue), false);
  assert.equal(serializedAudit.includes(largeEncoded), false);
  assert.equal(logs.join("\n").includes(secretValue), false);
  assert.equal(logs.join("\n").includes(largeEncoded), false);
});
