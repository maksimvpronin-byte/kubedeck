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
// Stays one, and here is why. The half that mattered - that two panels on the
// same interval fire on the same instants, so the table and the drawer never
// disagree about one pod - is now measured on a fake clock in the three tests
// at the end of this file. What is left is the wiring inside a drawer hook with
// a dozen dependencies: that the fetch lists the tick among them, or it would
// run once and show its first read for ever, and that a response from a
// previous pod cannot land on the current one. Both are shapes an effect has,
// and reaching them by rendering would mean standing up the whole drawer.
test("the usage history fetch depends on the tick and guards against a stale answer", () => {
  const lifecycle = fs.readFileSync(path.join(rendererRoot, "hooks/usePodDrawerResourceLifecycle.ts"), "utf8");
  const chart = fs.readFileSync(path.join(rendererRoot, "components/UsageHistoryChart.tsx"), "utf8");

  assert.match(lifecycle, /const USAGE_HISTORY_REFRESH_MS = 15_000;/);
  assert.match(lifecycle, /setAlignedInterval\(\(\) => setUsageHistoryTick\(\(current\) => current \+ 1\), USAGE_HISTORY_REFRESH_MS\)/);
  const fetchEffect = lifecycle.slice(lifecycle.indexOf("Usage history is recorded by KubeDeck itself"), lifecycle.indexOf('tab !== "related"'));
  assert.match(fetchEffect, /usageHistoryTick\]/, "the fetch must depend on the tick or it never runs again");
  assert.match(fetchEffect, /requestGeneration === usageHistoryRequestRef\.current/, "a stale response must not land on another pod");

  // The empty state has to explain the two reasons it can be empty; that it
  // does is checked by rendering it in usage-history-dom.contract.test.cjs.
  assert.match(chart, /metrics-server itself needs two scrapes/);
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
// Stays one, and here is why. What the refresh produces - a row patched with a
// recorded sample, and the same array back when nothing moved - is checked by
// calling applyPodUsage a few tests above. What is left is an absence and a
// dependency list: that the effect does not reload the pod list, and that it
// leaves a disconnected cluster alone. A list that is never fetched leaves no
// trace to assert on, and the effect lives in a hook wired to the whole shell.
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

// A clock that only moves when a test moves it, so the alignment can be watched
// instead of waited for.
function fakeClock(startAt) {
  let now = startAt;
  let nextId = 1;
  const pending = new Map();
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const realNow = Date.now;

  globalThis.setTimeout = (callback, delay) => {
    const id = nextId++;
    pending.set(id, { at: now + delay, callback });
    return id;
  };
  globalThis.clearTimeout = (id) => pending.delete(id);
  Date.now = () => now;

  return {
    // Runs everything due up to `until`, in order, the way a real loop would.
    advanceTo(until) {
      for (;;) {
        const due = [...pending.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        pending.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = until;
    },
    restore() {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
      Date.now = realNow;
    },
  };
}

test("two panels on the same interval read the same instants, whenever each started", (t) => {
  // Replaces a regular expression over the one arithmetic line in
  // alignedInterval.ts. What the line is for is that a table mounted at :07 and
  // a drawer mounted at :11 do not drift a full interval apart and disagree
  // about the same pod - which is a property of when they fire, not of how the
  // delay is spelled.
  const { setAlignedInterval } = loadTypeScript("utils/alignedInterval.ts");
  const clock = fakeClock(1_000_000_000_000);
  t.after(() => clock.restore());

  const table = [];
  const stopTable = setAlignedInterval(() => table.push(Date.now()), 15_000);

  // The drawer opens four seconds later, as a person would open it.
  clock.advanceTo(1_000_000_004_000);
  const drawer = [];
  const stopDrawer = setAlignedInterval(() => drawer.push(Date.now()), 15_000);

  clock.advanceTo(1_000_000_075_000);
  stopTable();
  stopDrawer();

  assert.ok(table.length >= 4, "the table ticked");
  assert.deepEqual(drawer, table.slice(table.length - drawer.length), "and the drawer ticked on the same instants");
  for (const instant of table) {
    assert.equal(instant % 15_000, 0, `${instant} is not on a 15-second boundary`);
  }
});

test("a timer started exactly on a boundary waits a whole interval, not none at all", (t) => {
  const { setAlignedInterval } = loadTypeScript("utils/alignedInterval.ts");
  // 1_000_000_005_000 is a whole number of 15-second intervals; starting there
  // is the case the comment in the source is about.
  const clock = fakeClock(1_000_000_005_000);
  t.after(() => clock.restore());

  const ticks = [];
  const stop = setAlignedInterval(() => ticks.push(Date.now()), 15_000);
  clock.advanceTo(1_000_000_005_000);
  assert.deepEqual(ticks, [], "a zero delay here would spin");

  clock.advanceTo(1_000_000_020_000);
  assert.deepEqual(ticks, [1_000_000_020_000], "the next boundary is a whole interval away");
  stop();
});

test("stopping an aligned interval stops it", (t) => {
  const { setAlignedInterval } = loadTypeScript("utils/alignedInterval.ts");
  const clock = fakeClock(1_000_000_001_000);
  t.after(() => clock.restore());

  const ticks = [];
  const stop = setAlignedInterval(() => ticks.push(Date.now()), 15_000);
  clock.advanceTo(1_000_000_015_000);
  assert.equal(ticks.length, 1);

  stop();
  clock.advanceTo(1_000_000_120_000);
  assert.equal(ticks.length, 1, "a stopped interval leaves nothing behind to fire");
});
