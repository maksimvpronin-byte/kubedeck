// The Problems panel, mounted with a fake API.
//
// One refresh here is five cluster-wide kubectl calls, so what the panel does
// with a tick that arrives while the previous walk is still running is worth
// more than a regular expression over the source. Until 2.22.1 every tick
// aborted the walk in progress and started another, and a cluster slower than
// the interval never finished one.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window: domWindow } = require("./helpers/dom.cjs");

const { ProblemsPanel } = loadComponent("components/ProblemsPanel.tsx");

function problem(name) {
  return {
    uid: `problem-${name}`,
    severity: "Warning",
    kind: "Pod",
    resource: "pods",
    namespace: "default",
    name,
    reason: "CrashLoopBackOff",
    message: `${name} keeps restarting`,
    category: "crashLoop",
    createdAt: "2026-08-01T10:00:00Z",
  };
}

// An API whose answer is held open, so a second call can be made while the
// first is still in flight.
function fakeApi() {
  const calls = [];
  let pending = null;
  return {
    calls,
    settle(items) {
      const resolve = pending;
      pending = null;
      resolve?.({
        items,
        summary: { total: items.length, critical: 0, warning: items.length, info: 0, errors: 0, sources: {}, categories: {}, kinds: {}, generatedAt: "2026-08-01T10:00:00Z" },
        errors: [],
      });
    },
    client: {
      problems(clusterId, signal) {
        calls.push({ clusterId, signal });
        return new Promise((resolve, reject) => {
          pending = resolve;
          signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
        });
      },
    },
  };
}

// The panel drives its own refresh from `window.setInterval`; taking the
// callback lets the tick happen on demand instead of after ten seconds.
function captureTick(run) {
  const original = domWindow.setInterval;
  const ticks = [];
  domWindow.setInterval = (callback, delay) => {
    ticks.push({ callback, delay });
    return original.call(domWindow, () => {}, 1_000_000);
  };
  try {
    return run(ticks);
  } finally {
    domWindow.setInterval = original;
  }
}

function panel(api, props = {}) {
  return React.createElement(ProblemsPanel, {
    api: api.client,
    cluster: { id: "cluster-1", displayName: "test", kubeconfigPath: "", lastOpened: true, createdAt: "", updatedAt: "" },
    settings: { refreshIntervalSeconds: 10 },
    copyLabel: "Copy",
    t: (key) => key,
    onError: () => {},
    onOpenResource: () => {},
    ...props,
  });
}

test("the panel loads its problems once and shows them", async () => {
  const api = fakeApi();
  const view = mount(panel(api));
  try {
    assert.equal(api.calls.length, 1, "mounting asks for problems exactly once");
    await React.act(async () => api.settle([problem("checkout"), problem("payments")]));
    const rows = view.rows().map((row) => row.textContent);
    assert.equal(rows.length, 2);
    assert.ok(rows.some((text) => text.includes("checkout")));
    assert.ok(rows.some((text) => text.includes("payments")));
  } finally {
    view.unmount();
  }
});

test("a tick steps aside for the walk already running, and resumes once it finishes", async () => {
  const api = fakeApi();
  let view;
  const ticks = captureTick((collected) => {
    view = mount(panel(api));
    return collected;
  });

  try {
    assert.equal(api.calls.length, 1, "the panel is already walking the cluster");
    assert.equal(ticks.length, 1, "and has a refresh timer");
    assert.equal(ticks[0].delay, 10_000);

    // The interval fires while the first walk is still in flight.
    // The tick returns a promise; act must not adopt it as its own scope.
    await React.act(async () => {
      ticks[0].callback();
    });
    assert.equal(api.calls.length, 1, "the tick does not start a second walk");
    assert.equal(api.calls[0].signal.aborted, false, "and does not abort the first");

    await React.act(async () => api.settle([problem("checkout")]));
    assert.match(view.container.textContent, /checkout/, "the walk that was allowed to finish is what the panel shows");

    // With nothing in flight, the next tick refreshes as it always did.
    // The tick returns a promise; act must not adopt it as its own scope.
    await React.act(async () => {
      ticks[0].callback();
    });
    assert.equal(api.calls.length, 2, "once the walk is done, the timer refreshes again");
  } finally {
    view.unmount();
  }
});

test("leaving the panel aborts the walk it left behind", () => {
  const api = fakeApi();
  const view = mount(panel(api));
  assert.equal(api.calls[0].signal.aborted, false);
  view.unmount();
  assert.equal(api.calls[0].signal.aborted, true, "nobody is left to read that answer");
});
