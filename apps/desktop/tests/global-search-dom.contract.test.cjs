const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window: domWindow } = require("./helpers/dom.cjs");
const { createTestScheduler, loadTypeScript } = require("./helpers/renderer.cjs");

const { useGlobalSearch } = loadComponent("hooks/useGlobalSearch.ts");
const { CommandPalette } = loadComponent("components/CommandPalette.tsx");

function response(items = [], { errors = [], limited = false } = {}) {
  return { items, errors, summary: { errors: errors.length, limited } };
}

function searchHarness() {
  const clock = createTestScheduler();
  const originalSetTimeout = domWindow.setTimeout;
  const originalClearTimeout = domWindow.clearTimeout;
  domWindow.setTimeout = clock.scheduler.setTimeout;
  domWindow.clearTimeout = clock.scheduler.clearTimeout;
  const calls = [];
  const errors = [];
  const api = { search: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })) };
  const onError = (error) => errors.push(error);
  let state;
  function Probe({ clusterId = "cluster-a", namespace = "all" }) {
    state = useGlobalSearch({ api, activeClusterId: clusterId, namespace, onError });
    return null;
  }
  const view = mount(React.createElement(Probe));
  return {
    calls,
    errors,
    get state() {
      return state;
    },
    start(query = "checkout") {
      React.act(() => {
        state.setOpen(true);
        state.setQuery(query);
      });
      React.act(() => clock.advance(250));
    },
    update(props) {
      view.update(React.createElement(Probe, props));
    },
    advance(ms) {
      React.act(() => clock.advance(ms));
    },
    close() {
      view.unmount();
      domWindow.setTimeout = originalSetTimeout;
      domWindow.clearTimeout = originalClearTimeout;
    },
  };
}

test("typing coalesces searches and changing scope removes old matches immediately", async () => {
  const h = searchHarness();
  try {
    h.start();
    await React.act(async () => h.calls[0].resolve(response([{ name: "old-cluster" }])));
    assert.equal(h.state.results.length, 1);
    h.update({ clusterId: "cluster-b" });
    assert.deepEqual(h.state.results, []);
    assert.equal(h.state.loading, true);
    React.act(() => h.state.setQuery("checkout api"));
    h.advance(249);
    assert.equal(h.calls.length, 1);
    h.advance(1);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].args[0], "cluster-b");
    assert.equal(h.calls[1].args[1], "checkout api");
    await React.act(async () => h.calls[1].resolve(response([{ name: "new-cluster" }])));
    assert.equal(h.state.results[0].name, "new-cluster");
    assert.equal(h.state.loading, false);
  } finally {
    h.close();
  }
});

for (const action of ["clear", "close", "disconnect", "unmount"]) {
  test(`a late search response is ignored after ${action}`, async () => {
    const h = searchHarness();
    let closed = false;
    try {
      h.start();
      if (action === "clear") React.act(() => h.state.setQuery(""));
      if (action === "close") React.act(() => h.state.setOpen(false));
      if (action === "disconnect") h.update({ clusterId: "" });
      if (action === "unmount") {
        h.close();
        closed = true;
      }
      assert.equal(h.calls[0].args[5].aborted, true);
      await React.act(async () => h.calls[0].resolve(response([{ name: "stale" }])));
      assert.deepEqual(h.state.results, []);
      assert.deepEqual(h.errors, []);
      if (!closed) assert.equal(h.state.loading, false);
    } finally {
      if (!closed) h.close();
    }
  });
}

test("an abandoned search cannot publish an error", async () => {
  const h = searchHarness();
  try {
    h.start();
    React.act(() => h.state.setOpen(false));
    await React.act(async () => h.calls[0].reject(new Error("late failure")));
    assert.deepEqual(h.errors, []);
    assert.equal(h.state.notice, null);
  } finally {
    h.close();
  }
});

test("partial, limited and failed searches have a visible state that clears on retry", async () => {
  const h = searchHarness();
  try {
    h.start();
    await React.act(async () => h.calls[0].resolve(response([{ name: "checkout" }], { errors: [{ code: "FORBIDDEN" }] })));
    assert.equal(h.state.notice, "partial");
    assert.equal(h.state.results.length, 1);
    h.start("payments");
    assert.equal(h.state.notice, null);
    await React.act(async () => h.calls[1].resolve(response([], { limited: true })));
    assert.equal(h.state.notice, "limited");
    h.start("orders");
    await React.act(async () => h.calls[2].reject(new Error("network unavailable")));
    assert.equal(h.state.notice, "failed");
    assert.equal(h.state.loading, false);
    assert.equal(h.errors.length, 1);
  } finally {
    h.close();
  }
});

function palette(props = {}) {
  return React.createElement(CommandPalette, { query: "checkout", items: [], placeholder: "Search", t: (key) => key, onQueryChange() {}, onClose() {}, onRun() {}, ...props });
}

test("searching and incomplete results never claim that nothing was found", () => {
  const view = mount(palette({ loading: true }));
  try {
    assert.match(view.container.textContent, /command.searchingCluster/);
    assert.doesNotMatch(view.container.textContent, /command.noMatches/);
    for (const notice of ["partial", "limited", "failed"]) {
      view.update(palette({ notice }));
      assert.equal(view.text('[role="status"]'), `command.search.${notice}`);
      assert.doesNotMatch(view.container.textContent, /command.noMatches/);
    }
    view.update(palette());
    assert.match(view.container.textContent, /command.noMatches/);
  } finally {
    view.unmount();
  }
});

test("server matches on metadata remain actionable even when the displayed name does not match", () => {
  const opened = [];
  const remote = { id: "global:pods:api", title: "api-7f8", subtitle: "pods · production", category: "Cluster search", keywords: "pods api-7f8 production labels", searchMatched: true, run() {} };
  const local = { ...remote, id: "local", searchMatched: false };
  const view = mount(palette({ query: "team=payments", items: [local, remote], onRun: (item) => opened.push(item.id) }));
  try {
    assert.equal(view.all("button").length, 1);
    view.click(view.first("button"));
    assert.deepEqual(opened, [remote.id]);
    view.update(palette({ query: "api production", items: [remote] }));
    assert.equal(view.all("button").length, 1);
  } finally {
    view.unmount();
  }
});

test("a display limit is disclosed instead of silently hiding the remaining matches", () => {
  const items = Array.from({ length: 65 }, (_, index) => ({ id: String(index), title: `checkout-${index}`, subtitle: "", category: "", keywords: "", run() {} }));
  const view = mount(palette({ items }));
  try {
    assert.equal(view.all("button").length, 60);
    assert.equal(view.text('[role="status"]'), "command.search.limited");
  } finally {
    view.unmount();
  }
});

test("a closed palette does not prepare rows on background updates", () => {
  const { useCommandPaletteItems: buildItems } = loadTypeScript("hooks/useCommandPaletteItems.ts");
  const activeRows = new Proxy([], {
    get() {
      throw new Error("closed palette read rows");
    },
  });
  assert.deepEqual(buildItems({ open: false, activeRows }), []);
});
