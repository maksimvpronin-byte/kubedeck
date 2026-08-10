const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { ConfigStore, KubeconfigEditError, MAX_KUBECONFIG_BYTES } = require("../dist/main/backend/config/configStore.js");
const { AuditStore } = require("../dist/main/backend/audit/auditStore.js");
const { handleClusterKubeconfigRequest, matchClusterKubeconfigRoute, validateKubeconfigDocument } = require("../dist/main/backend/routes/clusterKubeconfig.js");

const VALID_KUBECONFIG = [
  "apiVersion: v1",
  "kind: Config",
  "clusters:",
  "  - name: demo",
  "    cluster:",
  "      server: https://127.0.0.1:6443",
  "contexts:",
  "  - name: demo",
  "    context:",
  "      cluster: demo",
  "      user: demo",
  "current-context: demo",
  "users:",
  "  - name: demo",
  "    user:",
  "      token: super-secret-token",
  "",
].join("\n");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function createHarness(t) {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-kubeconfig-"));
  const source = path.join(appDataRoot, "source.yaml");
  fs.writeFileSync(source, VALID_KUBECONFIG, "utf8");

  const configStore = new ConfigStore(appDataRoot);
  const auditStore = new AuditStore(appDataRoot, () => undefined);
  const cluster = configStore.importCluster(source, "demo cluster");
  const released = [];

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handleClusterKubeconfigRequest(
      request,
      response,
      pathname,
      configStore,
      auditStore,
      async (clusterId) => {
        released.push(clusterId);
      },
      () => undefined,
    );
    if (!handled) {
      response.statusCode = 404;
      response.end("{}");
    }
  });

  t.after(() => {
    server.close();
    fs.rmSync(appDataRoot, { recursive: true, force: true });
  });

  return { appDataRoot, configStore, auditStore, cluster, released, server };
}

function auditLines(appDataRoot) {
  const auditPath = path.join(appDataRoot, "logs", "audit.jsonl");
  if (!fs.existsSync(auditPath)) return [];
  return fs
    .readFileSync(auditPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function put(baseUrl, clusterId, body) {
  const response = await fetch(`${baseUrl}/clusters/${clusterId}/kubeconfig`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

test("kubeconfig route matching and document validation", () => {
  assert.deepEqual(matchClusterKubeconfigRoute("GET", "/clusters/demo/kubeconfig"), { clusterId: "demo", operation: "read" });
  assert.deepEqual(matchClusterKubeconfigRoute("PUT", "/clusters/demo/kubeconfig"), { clusterId: "demo", operation: "write" });
  assert.equal(matchClusterKubeconfigRoute("DELETE", "/clusters/demo/kubeconfig"), null);
  assert.equal(matchClusterKubeconfigRoute("GET", "/clusters/demo/namespaces"), null);

  assert.deepEqual(validateKubeconfigDocument(VALID_KUBECONFIG), { clusters: 1, contexts: 1 });

  for (const invalid of ["", "   ", "apiVersion: v1\nkind: Secret\nclusters: []\n", "clusters:\n  - name: demo\n", "kind: Config\ncontexts:\n  - name: demo\n", ":\n  - broken"]) {
    assert.throws(() => validateKubeconfigDocument(invalid), KubeconfigEditError, `expected rejection for ${JSON.stringify(invalid)}`);
  }
});

test("cluster kubeconfig is readable and writable through the gateway", async (t) => {
  const harness = createHarness(t);
  const baseUrl = await listen(harness.server);

  const read = await fetch(`${baseUrl}/clusters/${harness.cluster.id}/kubeconfig`);
  assert.equal(read.status, 200);
  const payload = await read.json();
  assert.equal(payload.content, VALID_KUBECONFIG);
  assert.equal(payload.editable, true);
  assert.equal(payload.maxBytes, MAX_KUBECONFIG_BYTES);

  const updated = VALID_KUBECONFIG.replace("https://127.0.0.1:6443", "https://10.0.0.1:6443");
  const saved = await put(baseUrl, harness.cluster.id, { content: updated, confirmation: { typedName: "demo cluster" } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ok, true);

  assert.equal(fs.readFileSync(harness.cluster.kubeconfigPath, "utf8"), updated);
  // The previous content stays recoverable next to the file.
  assert.equal(fs.readFileSync(`${harness.cluster.kubeconfigPath}.bak`, "utf8"), VALID_KUBECONFIG);
  // Sessions and caches of the cluster are released because the endpoint may have moved.
  assert.deepEqual(harness.released, [harness.cluster.id]);
});

test("kubeconfig writes are rejected without confirmation, when invalid and when too large", async (t) => {
  const harness = createHarness(t);
  const baseUrl = await listen(harness.server);

  const unconfirmed = await put(baseUrl, harness.cluster.id, { content: VALID_KUBECONFIG, confirmation: { typedName: "wrong name" } });
  assert.equal(unconfirmed.status, 422);
  assert.equal(unconfirmed.body.detail.code, "CONFIRMATION_REQUIRED");

  const invalid = await put(baseUrl, harness.cluster.id, { content: "clusters: []\n", confirmation: { typedName: "demo cluster" } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.detail.code, "INVALID_KUBECONFIG");

  const oversized = await put(baseUrl, harness.cluster.id, {
    content: `${VALID_KUBECONFIG}# ${"x".repeat(MAX_KUBECONFIG_BYTES)}\n`,
    confirmation: { typedName: "demo cluster" },
  });
  assert.equal(oversized.status, 413);

  const missing = await fetch(`${baseUrl}/clusters/not-a-cluster/kubeconfig`);
  assert.equal(missing.status, 404);

  // No rejected write may touch the file or release the cluster runtime.
  assert.equal(fs.readFileSync(harness.cluster.kubeconfigPath, "utf8"), VALID_KUBECONFIG);
  assert.deepEqual(harness.released, []);
});

test("kubeconfig audit records metadata only, never credentials", async (t) => {
  const harness = createHarness(t);
  const baseUrl = await listen(harness.server);

  await fetch(`${baseUrl}/clusters/${harness.cluster.id}/kubeconfig`);
  await put(baseUrl, harness.cluster.id, { content: VALID_KUBECONFIG, confirmation: { typedName: "demo cluster" } });

  const entries = auditLines(harness.appDataRoot);
  const actions = entries.map((entry) => entry.action);
  assert.ok(actions.includes("cluster.kubeconfig.read"));
  assert.ok(actions.includes("cluster.kubeconfig.update"));

  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(serialized, /super-secret-token/);
  assert.doesNotMatch(serialized, /BEGIN [A-Z ]*PRIVATE KEY/);
  assert.doesNotMatch(serialized, /server: https/);
});

test("a kubeconfig outside the KubeDeck directory stays read-only", async (t) => {
  const harness = createHarness(t);
  const external = path.join(harness.appDataRoot, "external.yaml");
  fs.writeFileSync(external, VALID_KUBECONFIG, "utf8");

  const config = harness.configStore.load();
  config.clusters[0].kubeconfigPath = external;
  harness.configStore.save(config);

  const baseUrl = await listen(harness.server);
  const read = await fetch(`${baseUrl}/clusters/${harness.cluster.id}/kubeconfig`);
  assert.equal(read.status, 200);
  assert.equal((await read.json()).editable, false);

  const rejected = await put(baseUrl, harness.cluster.id, { content: VALID_KUBECONFIG, confirmation: { typedName: "demo cluster" } });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.detail.code, "KUBECONFIG_NOT_EDITABLE");
  assert.equal(fs.existsSync(`${external}.bak`), false);
});
