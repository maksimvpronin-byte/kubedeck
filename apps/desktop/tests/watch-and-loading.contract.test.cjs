// Watch reconnection, event coalescing and the resource loader.
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
const { createTestScheduler, loadTypeScript, rendererRoot } = require("./helpers/renderer.cjs");

function normalizeNamespaceSelectionForTest(value) {
  const raw = Array.isArray(value) ? value : value.split(",");
  const normalized = [...new Set(raw.map((item) => item.trim()).filter(Boolean))];
  if (normalized.includes("_cluster")) return ["_cluster"];
  if (normalized.includes("all") || normalized.length === 0) return ["all"];
  return normalized;
}

function createResourceLoaderHarness() {
  const batches = [];
  const state = { rows: {}, loading: false, error: null, clearedPendingActions: 0 };
  const setRows = (next) => {
    state.rows = typeof next === "function" ? next(state.rows) : next;
  };
  const model = loadTypeScript("hooks/useResourceLoader.ts", {
    "../utils/errors": {
      asErrorInfo: (error) => ({ code: "FAILED", message: String(error?.message ?? error), rawStderr: "", commandPreview: "" }),
      isAbortError: (error) => error?.name === "AbortError",
    },
    "../utils/kubeResources": {
      normalizeNamespaceSelection: normalizeNamespaceSelectionForTest,
      resourceScopeKey: (clusterId, resource, namespaces) => `${clusterId} ${resource} ${normalizeNamespaceSelectionForTest(namespaces).join(",")}`,
      loadNamespaceResourceBatches: (api, clusterId, resource, namespaces, signal) =>
        new Promise((resolve, reject) => {
          batches.push({ clusterId, resource, namespaces: [...namespaces], signal, resolve, reject });
        }),
    },
  });
  // The hook runs against the stubbed React of this harness, so it is called
  // through a plain alias and not as a React hook.
  const buildLoader = model.useResourceLoader;
  const load = buildLoader({
    api: {},
    activeCluster: { id: "cluster-a" },
    resource: "pods",
    namespaces: ["all"],
    setRows,
    setNamespaces: () => undefined,
    setActiveCluster: () => undefined,
    setUnavailableCluster: () => undefined,
    setSelectedRow: () => undefined,
    clearPendingActions: () => {
      state.clearedPendingActions += 1;
    },
    setLoading: (value) => {
      state.loading = value;
    },
    setError: (value) => {
      state.error = value;
    },
  });
  return { load, batches, state };
}

test("watch reconnect controller keeps one pending reconnect and stops cleanly", () => {
  const model = loadTypeScript("hooks/useResourceWatch.ts");
  const scheduled = [];
  const cancelled = [];
  const controller = model.createWatchReconnectController(
    (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    (timer) => cancelled.push(timer),
    25,
  );
  const first = controller.connectionStarted();
  controller.connectionClosed(first, () => undefined);
  controller.connectionClosed(first, () => undefined);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 25);
  const second = controller.connectionStarted();
  controller.connectionClosed(first, () => undefined);
  assert.equal(scheduled.length, 1);
  controller.stop();
  assert.deepEqual(cancelled, [1]);
  controller.connectionClosed(second, () => undefined);
  assert.equal(scheduled.length, 1);
});

test("watch events are coalesced with a floor and a ceiling, so a busy cluster neither storms nor freezes", () => {
  const model = loadTypeScript("hooks/useResourceWatch.ts");
  const single = createTestScheduler();
  const quietRuns = [];
  const quiet = model.createWatchRefreshCoalescer(() => quietRuns.push(single.scheduler.now()), single.scheduler.setTimeout, single.scheduler.clearTimeout, single.scheduler.now);

  // A lone event still settles for the debounce and nothing longer.
  quiet.requestRefresh();
  single.advance(model.WATCH_REFRESH_DEBOUNCE_MS - 1);
  assert.deepEqual(quietRuns, []);
  single.advance(1);
  assert.equal(quietRuns.length, 1);

  // An event every 100ms used to reset the settle timer forever: the refresh
  // never ran, and the polling fallback stays off while the socket is healthy.
  const busy = createTestScheduler();
  const busyRuns = [];
  const coalescer = model.createWatchRefreshCoalescer(() => busyRuns.push(busy.scheduler.now()), busy.scheduler.setTimeout, busy.scheduler.clearTimeout, busy.scheduler.now);
  const step = 100;
  for (let tick = 0; tick < 80; tick += 1) {
    coalescer.requestRefresh();
    busy.advance(step);
  }
  assert.ok(busyRuns.length >= 2, `a stream of events must still refresh the table, got ${busyRuns.length} refreshes`);

  for (let index = 1; index < busyRuns.length; index += 1) {
    const gap = busyRuns[index] - busyRuns[index - 1];
    // The floor: a full list load per event burst, not per event.
    assert.ok(gap >= model.WATCH_REFRESH_MIN_INTERVAL_MS, `refreshes ${gap}ms apart are closer than the minimum interval`);
    // The ceiling: the table is never left behind for longer than this.
    assert.ok(gap <= model.WATCH_REFRESH_MAX_WAIT_MS + step, `refreshes ${gap}ms apart leave the table stale past the maximum wait`);
  }

  // Stopping cancels the pending load rather than firing it after teardown.
  coalescer.requestRefresh();
  coalescer.stop();
  const stoppedAt = busyRuns.length;
  busy.advance(model.WATCH_REFRESH_MAX_WAIT_MS * 2);
  assert.equal(busyRuns.length, stoppedAt);
  assert.equal(busy.pending(), 0);
});

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. What it guards is that unmounting one viewer does
// not stop a watch another viewer is still using - a negative about a process
// in the main process, observed from a renderer that has already gone. There is
// no rendered state at either end to assert on.
test("resource watch lifecycle does not stop a shared backend watch", () => {
  const source = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceWatch.ts"), "utf8");
  assert.match(source, /\.startWatch\(clusterId, resource, watchNamespace\)/);
  assert.doesNotMatch(source, /\.stopWatch\(/);
  assert.doesNotMatch(source, /autoStartedWatchId/);
});

test("resource scope key identifies cluster, resource and namespace selection", () => {
  const model = loadTypeScript("utils/kubeResources.ts");
  const scope = (clusterId, resource, namespaces) => [clusterId, resource, namespaces].join("\u0000");
  assert.equal(model.resourceScopeKey("cluster-a", "pods", ["all"]), scope("cluster-a", "pods", "all"));
  assert.equal(model.resourceScopeKey("cluster-a", "pods", "kube-system"), scope("cluster-a", "pods", "kube-system"));
  assert.equal(model.resourceScopeKey("cluster-a", "pods", ["kube-system", "all"]), scope("cluster-a", "pods", "all"));
  assert.equal(model.resourceScopeKey("cluster-a", "pods", [" tools ", "tools", "apps"]), scope("cluster-a", "pods", "tools,apps"));
  assert.equal(model.resourceScopeKey("cluster-a", "nodes", ["_cluster"]), scope("cluster-a", "nodes", "_cluster"));
  assert.notEqual(model.resourceScopeKey("cluster-a", "pods", ["kube-system"]), model.resourceScopeKey("cluster-b", "pods", ["kube-system"]));
});

test("a namespace switch drops the rows of the previous scope before awaiting", async () => {
  const previousWindow = global.window;
  global.window = { setTimeout: () => 0, clearTimeout: () => undefined };
  try {
    const { load, batches, state } = createResourceLoaderHarness();

    const scoped = load("cluster-a", "pods", ["kube-system"]);
    batches[0].resolve([{ items: [{ uid: "pod-kube-system" }] }]);
    assert.equal(await scoped, true);
    assert.deepEqual(state.rows.pods, [{ uid: "pod-kube-system" }]);

    const clearedBefore = state.clearedPendingActions;
    const widened = load("cluster-a", "pods", ["all"]);
    // The table must not keep another namespace on screen while the wide load runs.
    assert.deepEqual(state.rows.pods, []);
    assert.equal(state.clearedPendingActions, clearedBefore + 1, "pending bulk actions of the previous scope must be dropped");
    assert.equal(batches[1].namespaces.length, 1);
    assert.equal(batches[1].namespaces[0], "all");

    batches[1].resolve([{ items: [{ uid: "pod-a" }, { uid: "pod-b" }] }]);
    assert.equal(await widened, true);
    assert.deepEqual(state.rows.pods, [{ uid: "pod-a" }, { uid: "pod-b" }]);
  } finally {
    global.window = previousWindow;
  }
});

test("a silent watch refresh never aborts a running load of the same scope", async () => {
  const previousWindow = global.window;
  global.window = { setTimeout: () => 0, clearTimeout: () => undefined };
  try {
    const { load, batches, state } = createResourceLoaderHarness();

    const widened = load("cluster-a", "pods", ["all"]);
    assert.equal(batches.length, 1);

    assert.equal(await load("cluster-a", "pods", ["all"], true), false);
    assert.equal(await load("cluster-a", "pods", ["all"], true), false);
    assert.equal(batches.length, 1, "silent refreshes must be coalesced instead of restarting the load");
    assert.equal(batches[0].signal.aborted, false, "the running load must survive watch events");

    batches[0].resolve([{ items: [{ uid: "pod-a" }] }]);
    assert.equal(await widened, true);
    assert.deepEqual(state.rows.pods, [{ uid: "pod-a" }]);

    // Coalesced watch events still produce exactly one trailing refresh.
    assert.equal(batches.length, 2);
    assert.deepEqual(batches[1].namespaces, ["all"]);
    batches[1].resolve([{ items: [{ uid: "pod-a" }, { uid: "pod-b" }] }]);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(state.rows.pods, [{ uid: "pod-a" }, { uid: "pod-b" }]);
    assert.equal(batches.length, 2);
  } finally {
    global.window = previousWindow;
  }
});

test("manual refresh and scope changes still supersede a running load", async () => {
  const previousWindow = global.window;
  global.window = { setTimeout: () => 0, clearTimeout: () => undefined };
  try {
    const { load, batches, state } = createResourceLoaderHarness();

    const stale = load("cluster-a", "pods", ["all"]);
    const manual = load("cluster-a", "pods", ["all"]);
    assert.equal(batches.length, 2);
    assert.equal(batches[0].signal.aborted, true);

    batches[1].resolve([{ items: [{ uid: "pod-a" }] }]);
    assert.equal(await manual, true);
    batches[0].resolve([{ items: [{ uid: "stale" }] }]);
    assert.equal(await stale, false);
    assert.deepEqual(state.rows.pods, [{ uid: "pod-a" }], "a superseded response must never reach the table");

    const switched = load("cluster-a", "pods", ["kube-system"]);
    assert.equal(batches[1].signal.aborted, false);
    assert.equal(batches[2].namespaces[0], "kube-system");
    assert.deepEqual(state.rows.pods, []);
    batches[2].resolve([{ items: [{ uid: "pod-kube-system" }] }]);
    assert.equal(await switched, true);
  } finally {
    global.window = previousWindow;
  }
});

test("resource polling is only a fallback while live watch is unavailable", () => {
  const refresh = loadTypeScript("utils/refresh.ts");
  assert.equal(refresh.shouldPollResources(10, false), true);
  assert.equal(refresh.shouldPollResources(10, true), false);
  assert.equal(refresh.shouldPollResources(0, false), false);

  const watch = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceWatch.ts"), "utf8");
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  assert.match(watch, /backendReady && socketReady/);
  assert.match(watch, /nextSocket\.onopen/);
  assert.match(watch, /return watchHealthy/);
  assert.match(app, /const watchHealthy = useResourceWatch\(/);
  assert.match(app, /shouldPollResources\(intervalSeconds, watchHealthy\)/);
});

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. It is an absence spread over three effects: a
// disconnected cluster must not be listed, polled, or fallen back to. Work that
// never happens leaves nothing behind, and the effects belong to the shell.
test("a disconnected cluster is left alone, including by the polling fallback", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const rail = fs.readFileSync(path.join(rendererRoot, "components/ClusterRail.tsx"), "utf8");

  // Polling exists for when watches are down. Disconnecting takes them down on
  // purpose, so without this guard a disconnect would be answered with a full
  // `kubectl get` on a timer - louder than what the user asked to stop.
  const pollEffect = app.slice(app.indexOf("const intervalSeconds = getAutoRefreshIntervalSeconds(settings);") - 400, app.indexOf("shouldPollResources(intervalSeconds, watchHealthy)"));
  assert.match(pollEffect, /connectedClusterIds\.includes\(activeCluster\.id\)/);

  // A watch is a long-lived kubectl process, so a disconnected cluster must not
  // have one opened for it. This was the hole that made disconnect look like it
  // had not worked: watches came straight back and kept talking to the cluster.
  assert.match(app, /const activeClusterConnected = Boolean\(activeCluster && connectedClusterIds\.includes\(activeCluster\.id\)\)/);
  assert.match(app, /enabled: isResourceTableView && activeClusterConnected/);

  // The table used to keep showing rows loaded before the disconnect, with
  // every action still on offer against a cluster the gateway now refuses.
  const router = fs.readFileSync(path.join(rendererRoot, "components/AppSectionRouter.tsx"), "utf8");
  assert.match(router, /\{activeCluster && props\.activeClusterConnected \? \(/);
  assert.match(router, /<DisconnectedClusterPanel/);
  // Saving settings replaces the whole config from the PUT response. An absent
  // connection list means "not reported", not "nothing connected" - conflating
  // them turned the entire rail grey while the backend kept talking.
  assert.match(app, /connectedClusterIds: updated\.connectedClusterIds \?\? current\?\.connectedClusterIds \?\? \[\]/);

  // Left click connects, right click offers the menu.
  assert.match(rail, /onContextMenu=\{\(event\) => \{/);
  assert.match(rail, /connected\.has\(cluster\.id\) \? "connected" : "disconnected"/);

  // The state is a badge rather than a ring on the button. A ring lost to
  // `.cluster-rail-item.is-active`, which sets its own box-shadow later in the
  // stylesheet, so the one cluster being looked at showed no state at all.
  assert.match(rail, /<span className="cluster-rail-state"/);
  const layout = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");
  assert.doesNotMatch(layout, /\.cluster-rail-item\.is-connected \{\s*box-shadow/, "a ring here would be overridden by is-active");
  assert.match(layout, /\.cluster-rail-item\.is-connected \.cluster-rail-state/);
  assert.match(layout, /\.cluster-rail-item\.is-disconnected \{[^}]*grayscale/, "colour alone is too weak on a column of small buttons");
  assert.match(rail, /disabled=\{connected\.has\(menu\.cluster\.id\)\}/, "Connect is unavailable for an already connected cluster");
  assert.match(rail, /disabled=\{!connected\.has\(menu\.cluster\.id\)\}/, "Disconnect is unavailable for a disconnected one");

  // A cluster can be active and disconnected at the same time; clicking it then
  // has to reconnect rather than being treated as already open.
  assert.match(app, /cluster\.id === activeCluster\?\.id && connectedClusterIds\.includes\(cluster\.id\)/);

  // Disconnect is never forced on the first attempt.
  const controller = fs.readFileSync(path.join(rendererRoot, "hooks/useClusterController.ts"), "utf8");
  assert.match(controller, /api\.disconnectCluster\(cluster\.id, force\)/);
  assert.match(controller, /setDisconnectTarget\(\{ cluster, sessions: result\.sessions \}\)/);

  // Rows loaded before the disconnect are stale by definition, and an open
  // drawer would keep offering actions the gateway now refuses.
  assert.match(controller, /if \(cluster\.id === activeCluster\?\.id\) \{\s*setRows\(\{\}\);\s*setSelectedRow\(null\);/);
});

test("a silent refresh steps aside for the walk already running", () => {
  const refresh = loadTypeScript("utils/refresh.ts");
  assert.equal(refresh.shouldSkipSilentRefresh(true, true), true);
  assert.equal(refresh.shouldSkipSilentRefresh(true, false), false);
  // A refresh somebody asked for still replaces whatever is running.
  assert.equal(refresh.shouldSkipSilentRefresh(false, true), false);
  assert.equal(refresh.shouldSkipSilentRefresh(false, false), false);

  // grep contract, and it stays one: both panels walk the whole cluster per
  // refresh - nine lists
  // for Overview, five for Problems - so a tick that aborted the running walk
  // meant a cluster slower than the interval never finished one.
  for (const file of ["components/OverviewPanel.tsx", "components/ProblemsPanel.tsx"]) {
    const source = fs.readFileSync(path.join(rendererRoot, file), "utf8");
    assert.match(source, /shouldSkipSilentRefresh\(silent, requestRef\.current !== null\)/, file);
  }
});
