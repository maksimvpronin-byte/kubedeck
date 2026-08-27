#!/usr/bin/env node
// Runs the built gateway against a real cluster and reports what it costs.
//
// Everything the contract suites measure is a fixture: a fake kubectl that
// answers instantly, or a benchmark over invented rows. This is the same code
// against a real API server, which is the only place the numbers behind a
// release actually live.
//
// READ-ONLY. It issues GETs, opens the cluster (which is a `cluster-info` and a
// namespace list), and starts one watch that it stops again. It never applies,
// deletes, scales, restarts or execs anything, and it never writes to the
// application's own app-data: the kubeconfig is copied into a temporary root
// that is removed at the end.
//
//   KUBEDECK_SMOKE_KUBECONFIG   path to a kubeconfig (required; without it this
//                               script explains itself and exits 0)
//   KUBEDECK_SMOKE_KUBECTL      kubectl binary (default: kubectl)
//   KUBEDECK_SMOKE_NAMESPACE    namespace for the scoped calls (default: all)
//   KUBEDECK_SMOKE_REPORT       write the timing table to this file as Markdown
//
// Exit code is 1 if any check failed, 0 otherwise - including when it skipped.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const distGateway = path.join(root, "apps/desktop/dist/main/backend/gateway.js");

function skip(reason, detail) {
  process.stdout.write(`cluster smoke: skipped - ${reason}\n`);
  if (detail) process.stdout.write(`${detail}\n`);
  process.exit(0);
}

const kubeconfig = process.env.KUBEDECK_SMOKE_KUBECONFIG ?? "";
if (!kubeconfig) {
  skip(
    "no cluster to talk to",
    [
      "",
      "Set KUBEDECK_SMOKE_KUBECONFIG to a kubeconfig and run it again:",
      "",
      "  KUBEDECK_SMOKE_KUBECONFIG=~/.kube/config npm run smoke:cluster",
      "",
      "Optional: KUBEDECK_SMOKE_KUBECTL (kubectl binary), KUBEDECK_SMOKE_NAMESPACE,",
      "KUBEDECK_SMOKE_REPORT (write the timing table to a file).",
    ].join("\n"),
  );
}
if (!fs.existsSync(kubeconfig)) skip(`kubeconfig not found: ${kubeconfig}`);
if (!fs.existsSync(distGateway)) skip("the gateway is not built", "Run `npm run build` first.");

const { startGateway } = require(distGateway);
const { ConfigStore } = require(path.join(root, "apps/desktop/dist/main/backend/config/configStore.js"));

const namespace = process.env.KUBEDECK_SMOKE_NAMESPACE || "all";
const kubectlPath = process.env.KUBEDECK_SMOKE_KUBECTL || "kubectl";
const token = crypto.randomBytes(24).toString("hex");
const headers = { "Content-Type": "application/json", "X-KubeDeck-Token": token };

const steps = [];
const failures = [];
const logLines = [];

function record(name, ms, detail) {
  steps.push({ name, ms, detail: detail ?? "" });
  process.stdout.write(`  ${String(Math.round(ms)).padStart(6)} ms  ${name}${detail ? `  (${detail})` : ""}\n`);
}

function check(name, run) {
  try {
    run();
    process.stdout.write(`     ok      ${name}\n`);
  } catch (error) {
    failures.push({ name, message: error instanceof Error ? error.message : String(error) });
    process.stdout.write(`     FAIL    ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

async function timed(name, run, detail) {
  const started = process.hrtime.bigint();
  const value = await run();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  record(name, ms, typeof detail === "function" ? detail(value) : detail);
  return { value, ms };
}

async function main() {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-smoke-"));
  let gateway = null;

  try {
    const store = new ConfigStore(appDataRoot);
    const cluster = store.importCluster(kubeconfig, "smoke");
    const config = store.load();
    config.settings.kubectlPath = kubectlPath;
    store.save(config, false);

    process.stdout.write(`cluster smoke: read-only, temporary app data in ${appDataRoot}\n\n`);

    gateway = await startGateway({
      sessionToken: token,
      appDataRoot,
      appVersion: require(path.join(root, "package.json")).version,
      log: (message) => logLines.push(message),
    });

    const get = async (route, init) => {
      const response = await fetch(`${gateway.baseUrl}${route}`, { headers, ...init });
      const body = await response.json();
      if (!response.ok) throw new Error(`${route} -> ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
      return body;
    };
    const items = (body) => (Array.isArray(body?.items) ? body.items : []);
    const count = (body) => `${items(body).length} items`;

    // --- opening the cluster ---------------------------------------------
    const opened = await timed(
      "open cluster",
      () => get(`/clusters/${cluster.id}/open`, { method: "POST" }),
      (body) => `${body?.namespaces?.length ?? 0} namespaces`,
    );
    check("the cluster reports namespaces", () => assert.ok(Array.isArray(opened.value.namespaces)));

    // --- the lists a table loads ------------------------------------------
    const pods = await timed("GET resources/pods (namespace=" + namespace + ")", () => get(`/clusters/${cluster.id}/resources/pods?namespace=${namespace}&forceRefresh=true`), count);
    check("pod rows carry the fields the table reads", () => {
      const row = items(pods.value)[0];
      if (!row) return;
      for (const field of ["uid", "name", "namespace", "phase", "ready", "restarts", "labelsText"]) {
        assert.ok(field in row, `pod row is missing ${field}`);
      }
    });
    check("pod usage is either a reading or empty, never the literal N/A", () => {
      for (const row of items(pods.value)) assert.notEqual(row.cpuUsage, "N/A");
    });

    const nodes = await timed("GET resources/nodes", () => get(`/clusters/${cluster.id}/resources/nodes?namespace=_cluster&forceRefresh=true`), count);
    check("node rows carry allocatable and usage columns", () => {
      const row = items(nodes.value)[0];
      if (!row) return;
      for (const field of ["name", "status", "cpuAllocatableRaw", "memoryAllocatableRaw"]) {
        assert.ok(field in row, `node row is missing ${field}`);
      }
    });

    await timed("GET resources/deployments", () => get(`/clusters/${cluster.id}/resources/deployments?namespace=${namespace}&forceRefresh=true`), count);
    await timed("GET resources/events", () => get(`/clusters/${cluster.id}/resources/events?namespace=${namespace}&forceRefresh=true`), count);
    await timed("GET namespaces", () => get(`/clusters/${cluster.id}/namespaces`), count);
    await timed("GET pod-usage", () => get(`/clusters/${cluster.id}/pod-usage?namespace=${namespace}`), count);

    // --- the panels that walk the whole cluster (2.22.1) -------------------
    // Problems goes first, and after the shared window from any earlier call
    // has expired: it is the only way to see what one of these panels costs
    // when it has to read the cluster itself.
    await new Promise((resolve) => setTimeout(resolve, 5500));
    const problemsCold = await timed("GET problems (cold)", () => get(`/clusters/${cluster.id}/problems`), count);
    check("problems are shaped for the table", () => {
      const row = items(problemsCold.value)[0];
      if (!row) return;
      for (const field of ["uid", "severity", "kind", "resource", "reason"]) assert.ok(field in row, `problem row is missing ${field}`);
    });

    const overview = await timed(
      "GET overview (four of its nine lists are shared with Problems)",
      () => get(`/clusters/${cluster.id}/overview?namespace=${namespace}`),
      (body) => `verdict ${body?.verdict?.tone ?? "?"}`,
    );
    check("overview reports nodes and workloads", () => {
      assert.ok(typeof overview.value?.summary?.nodesTotal === "number");
      assert.ok(Array.isArray(overview.value?.workloads));
    });

    // Observed, not asserted: within the five-second window the source lists
    // are reused, so this call should be markedly cheaper than the cold one.
    // Timing against a real API server is too noisy to fail a build on.
    const problemsWarm = await timed("GET problems (inside the shared window)", () => get(`/clusters/${cluster.id}/problems`), count);
    record("shared-source reuse", problemsCold.ms - problemsWarm.ms, `${Math.round(problemsCold.ms)} ms cold vs ${Math.round(problemsWarm.ms)} ms warm`);

    // --- search (2.22.4) ---------------------------------------------------
    const firstPod = items(pods.value)[0];
    const query = firstPod ? String(firstPod.name).slice(0, 12) : "kube";
    const search = await timed(`GET search q=${query}`, () => get(`/clusters/${cluster.id}/search?q=${encodeURIComponent(query)}&namespace=${namespace}&limit=40`), count);
    check("search finds the pod it was given the name of", () => {
      if (!firstPod) return;
      assert.ok(
        items(search.value).some((row) => row.name === firstPod.name),
        `search for ${query} did not return ${firstPod.name}`,
      );
    });
    await timed("GET search q=no-such-resource-anywhere", () => get(`/clusters/${cluster.id}/search?q=no-such-resource-anywhere&namespace=${namespace}&limit=40`), count);

    // --- the drawer fan-out ------------------------------------------------
    if (firstPod) {
      await timed(
        "GET related resources of a pod",
        () => get(`/clusters/${cluster.id}/resources/pods/${encodeURIComponent(String(firstPod.namespace))}/${encodeURIComponent(String(firstPod.name))}/related`),
        count,
      );
      await timed(
        "GET pod YAML",
        async () => {
          const response = await fetch(`${gateway.baseUrl}/clusters/${cluster.id}/resources/pods/${encodeURIComponent(String(firstPod.namespace))}/${encodeURIComponent(String(firstPod.name))}/yaml`, {
            headers,
          });
          const text = await response.text();
          if (!response.ok) throw new Error(`yaml -> ${response.status}`);
          return text;
        },
        (text) => `${Math.round(String(text).length / 1024)} KiB`,
      );
    }

    // --- an abandoned request stops its work (2.22.0) ----------------------
    const before = logLines.length;
    const controller = new AbortController();
    const abandoned = fetch(`${gateway.baseUrl}/clusters/${cluster.id}/resources/pods?namespace=${namespace}&forceRefresh=true`, { headers, signal: controller.signal });
    setTimeout(() => controller.abort(), 40);
    await abandoned.then(
      () => undefined,
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    check("an abandoned request is not logged as a failure", () => {
      const failed = logLines.slice(before).filter((line) => line.includes("failed"));
      assert.deepEqual(failed, []);
    });
    const afterAbort = await timed("GET resources/pods after an abandoned one", () => get(`/clusters/${cluster.id}/resources/pods?namespace=${namespace}&forceRefresh=true`), count);
    check("the gateway still answers normally after an abort", () => assert.ok(Array.isArray(items(afterAbort.value))));

    // --- watch -------------------------------------------------------------
    const watch = await timed(
      "POST watch on pods",
      () =>
        get(`/clusters/${cluster.id}/watches`, {
          method: "POST",
          body: JSON.stringify({ resource: "pods", namespace }),
        }),
      (body) => `status ${body?.status ?? "?"}`,
    );
    check("the watch is running", () => assert.equal(watch.value.status, "running"));
    const status = await get("/watches/status");
    check("the watch appears in status", () => assert.ok((status.watches ?? []).some((session) => session.id === watch.value.id)));
    await timed("DELETE watch", async () => {
      const response = await fetch(`${gateway.baseUrl}/watches/${watch.value.id}`, { method: "DELETE", headers });
      if (!response.ok) throw new Error(`stop watch -> ${response.status}`);
      return response.json();
    });
    const afterStop = await get("/watches/status");
    check("a stopped watch leaves the status list", () => assert.ok(!(afterStop.watches ?? []).some((session) => session.id === watch.value.id)));

    // --- the runtime is still node-only ------------------------------------
    const migration = await get("/migration/status");
    check("migration status stays node-only", () => {
      assert.equal(migration.mode, "node-only");
      assert.equal(migration.routes.pythonOwned, 0);
    });
  } finally {
    if (gateway) await gateway.close();
    fs.rmSync(appDataRoot, { recursive: true, force: true });
  }

  const report = [
    `# KubeDeck cluster smoke - ${new Date().toISOString()}`,
    "",
    `kubectl: \`${kubectlPath}\`, namespace scope: \`${namespace}\``,
    "",
    "| step | ms | detail |",
    "|---|---:|---|",
    ...steps.map((step) => `| ${step.name} | ${Math.round(step.ms)} | ${step.detail} |`),
    "",
    failures.length ? `**${failures.length} check(s) failed:**` : "All checks passed.",
    ...failures.map((failure) => `- ${failure.name}: ${failure.message}`),
    "",
  ].join("\n");

  if (process.env.KUBEDECK_SMOKE_REPORT) {
    fs.writeFileSync(process.env.KUBEDECK_SMOKE_REPORT, report, "utf8");
    process.stdout.write(`\nreport written to ${process.env.KUBEDECK_SMOKE_REPORT}\n`);
  }

  process.stdout.write(failures.length ? `\ncluster smoke: ${failures.length} check(s) FAILED\n` : "\ncluster smoke: all checks passed\n");
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`cluster smoke: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
