// Recorded usage: the pods column, the patch and the history chart.
// Split out of renderer-controllers.contract.test.cjs; see
// docs/file-structure-refactor-plan.md, section C.
// A test marked `grep contract` reads a source file and asserts on its text.
// It breaks on a rename and passes through a real regression, so it is a
// placeholder for a behavioural test rather than one. See section C of
// docs/file-structure-refactor-plan.md.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTypeScript, rendererRoot } = require("./helpers/renderer.cjs");

// grep contract: asserts on source text, not behaviour.
test("the usage history panel refreshes itself instead of freezing on its first read", () => {
  const lifecycle = fs.readFileSync(path.join(rendererRoot, "hooks/usePodDrawerResourceLifecycle.ts"), "utf8");
  const chart = fs.readFileSync(path.join(rendererRoot, "components/UsageHistoryChart.tsx"), "utf8");

  // History keeps growing while the drawer is open, but none of the fetch's
  // other dependencies ever change, so without a tick the panel would keep
  // showing its first read - including "no samples yet" for a pod whose
  // samples have since arrived.
  assert.match(lifecycle, /const USAGE_HISTORY_REFRESH_MS = 15_000;/);
  assert.match(lifecycle, /setAlignedInterval\(\(\) => setUsageHistoryTick\(\(current\) => current \+ 1\), USAGE_HISTORY_REFRESH_MS\)/);

  // Free-running timers leave the table and the drawer up to a full interval
  // apart, which reads as the two panels disagreeing about one pod.
  const aligned = fs.readFileSync(path.join(rendererRoot, "utils/alignedInterval.ts"), "utf8");
  assert.match(aligned, /intervalMs - \(Date\.now\(\) % intervalMs\)/);
  const podUsage = fs.readFileSync(path.join(rendererRoot, "hooks/usePodUsageRefresh.ts"), "utf8");
  assert.match(podUsage, /setAlignedInterval\(\(\) => void refresh\(\), POD_USAGE_REFRESH_MS\)/);
  const fetchEffect = lifecycle.slice(lifecycle.indexOf("Usage history is recorded by KubeDeck itself"), lifecycle.indexOf('tab !== "related"'));
  assert.match(fetchEffect, /usageHistoryTick\]/, "the fetch must depend on the tick or it never runs again");
  assert.match(fetchEffect, /requestGeneration === usageHistoryRequestRef\.current/, "a stale response must not land on another pod");

  // The empty state has to explain the two reasons it can be empty.
  assert.match(chart, /metrics-server itself needs two scrapes/);
  assert.match(chart, /refreshes on its own/);
});

test("recorded usage patches only the usage fields and keeps unchanged rows identical", () => {
  const model = loadTypeScript("utils/podUsagePatch.ts");
  const rows = [
    { uid: "1", name: "api-1", namespace: "default", phase: "Running", podCpuLimitValue: 1000, podCpuRequestValue: 200, podMemoryLimitValue: 1073741824, podMemoryRequestValue: 536870912 },
    { uid: "2", name: "other", namespace: "default", phase: "Running", cpuUsage: "9m" },
  ];

  const patched = model.applyPodUsage(rows, [{ namespace: "default", pod: "api-1", cpu: "250m", memory: "512Mi", cpuMillicores: 250, memoryBytes: 536870912 }]);
  const api = patched[0];
  assert.equal(api.cpuUsage, "250m");
  assert.equal(api.memoryUsage, "512Mi");
  assert.equal(api.podCpuUsageValue, 250);
  // Mirrors the backend: clamped against the limit, unclamped against the
  // request, because a request is a scheduling floor rather than a ceiling.
  assert.equal(api.podCpuUsagePercent, 25);
  assert.equal(api.podCpuRequestPercent, 125);
  assert.equal(api.podMemoryUsagePercent, 50);
  assert.equal(api.podMemoryRequestPercent, 100);
  // Everything that belongs to the list response survives.
  assert.equal(api.phase, "Running");
  assert.equal(api.uid, "1");
  // A row with no entry is the very same object.
  assert.equal(patched[1], rows[1]);

  // A refresh that changes nothing must not produce a new array, or the table
  // would re-render every 30 seconds for no reason.
  const unchanged = model.applyPodUsage(patched, [{ namespace: "default", pod: "api-1", cpu: "250m", memory: "512Mi", cpuMillicores: 250, memoryBytes: 536870912 }]);
  assert.equal(unchanged, patched);
  assert.equal(model.applyPodUsage(rows, []), rows);

  // A pod of the same name in another namespace must not be matched.
  const crossNamespace = model.applyPodUsage(rows, [{ namespace: "other-ns", pod: "api-1", cpu: "1m", memory: "1Mi", cpuMillicores: 1, memoryBytes: 1048576 }]);
  assert.equal(crossNamespace, rows);

  // A half-missing reading leaves the percentage null rather than zero.
  const cpuOnly = model.applyPodUsage(rows, [{ namespace: "default", pod: "api-1", cpu: "250m", memory: "", cpuMillicores: 250, memoryBytes: null }]);
  assert.equal(cpuOnly[0].podMemoryUsagePercent, null);
  assert.equal(cpuOnly[0].memoryUsage, "");
});

// grep contract: asserts on source text, not behaviour.
test("the pods table refreshes usage from recorded samples rather than reloading the list", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "hooks/usePodUsageRefresh.ts"), "utf8");
  // A table driven by watch events is not reloaded while the pods do not
  // change, so its usage column froze at whatever the last list load caught.
  assert.match(app, /const POD_USAGE_REFRESH_MS = 15_000;/);
  assert.match(app, /api\.podUsage\(activeCluster\.id/);
  assert.match(app, /applyPodUsage\(rows, response\.items\)/);
  // Reloading the list would mean another `kubectl get pods` every tick, which
  // is what moving from polling to watch was avoiding.
  const effectStart = app.indexOf("A pods table driven by watch events");
  const effectEnd = app.indexOf("}, [api, activeCluster?.id, resourceTab, selectedNamespaces, connectedClusterIds]);");
  assert.ok(effectStart >= 0 && effectEnd > effectStart, "the usage refresh effect must still be recognisable");
  const effect = app.slice(effectStart, effectEnd);
  assert.doesNotMatch(effect, /loadResources/);
  assert.match(effect, /return next === rows \? current :/, "an unchanged refresh must not replace the rows");

  // A disconnected cluster has nothing recorded to read, and polling it would
  // undo half of what disconnecting is for.
  assert.match(effect, /connectedClusterIds\.includes\(activeCluster\.id\)/);
});

// grep contract: asserts on source text, not behaviour.
test("the usage chart can be read at the rate metrics-server publishes without losing the day view", () => {
  const chart = fs.readFileSync(path.join(rendererRoot, "components/UsageHistoryChart.tsx"), "utf8");

  // The live tail is what the panel is opened for, so it is the default.
  assert.match(chart, /useState<Range>\("fine"\)/);
  assert.match(chart, /range === "fine" && fineAvailable \? finePoints : history\.points/);

  // A response without the field must not blank the drawer.
  assert.match(chart, /history\.finePoints \?\? \[\]/);

  // The toggle only appears once there is something finer to show.
  assert.match(chart, /fineAvailable \?\s*\(/);

  // The percentiles describe the whole recorded window whichever view is on
  // screen; two different p95 values for one pod would be worse than none.
  assert.match(chart, /over the whole window/);
  assert.match(chart, /points=\{points\}/);
});

// grep contract: asserts on source text, not behaviour.
test("a bar holding one scrape reports one number instead of the same number twice", () => {
  const chart = fs.readFileSync(path.join(rendererRoot, "components/UsageHistoryChart.tsx"), "utf8");

  // "avg 3 GiB · max 3 GiB" is what a 15-second bucket produces, because after
  // deduplication it holds exactly one measurement.
  assert.match(chart, /if \(point\.samples <= 1\) return `\$\{time\} · \$\{average\}`;/);
  assert.match(chart, /avg \$\{average\} · max \$\{peak\} · \$\{point\.samples\} samples/);
  assert.match(chart, /title=\{pointTitle\(point, format\(average\), format\(peak\)\)\}/);
});
