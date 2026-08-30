// The namespace refresh, driven through the hook that owns the selection.
//
// This replaces the behavioural half of a grep contract whose central assertion
// compared two string offsets:
//
//   pollBody.indexOf('if (current.includes("_cluster")) return;') <
//   pollBody.indexOf("rememberClusterSelection(clusterId, reconciled)")
//
// Two lines appearing in that order in a file is not the same as one running
// before the other, and it says nothing at all about the thing being protected:
// a background poll quietly rewriting the namespaces a person chose. That is a
// silent loss of the reader's own state, which is why it is worth driving rather
// than reading.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React } = require("./helpers/dom.cjs");

// `utils/errors.ts` narrows with `error instanceof ApiError`, so the stub has to
// carry a real class for it: a missing one throws before any assertion is
// reached, and the failure looks like the hook rather than the fixture.
const { useNamespaceRefresh } = loadComponent("hooks/useNamespaceRefresh.ts", {
  "../api": { ApiClient: class {}, ApiError: class ApiError extends Error {} },
});

const namespaceList = (...names) => ({ items: names.map((name) => ({ metadata: { name } })) });

async function refresher(t, options = {}) {
  const errors = [];
  // Each cluster answers with its own namespaces, so a list that was published
  // can be traced back to whose it was. A fixture that answered the same for
  // every cluster would make the guard against publishing another cluster's
  // list invisible.
  const state = {
    activeClusterId: "cluster-a",
    answer: async (clusterId) => (clusterId === "cluster-a" ? namespaceList("default", "kube-system", "tools") : namespaceList("b-only")),
    ...options,
  };
  const api = { namespaces: async (clusterId, signal) => state.answer(clusterId, signal) };
  // Stable, the way the application passes them. A fresh arrow per render would
  // change the identity of `loadNamespaces`, and the hook's own effect would
  // re-run - and re-poll - on every render.
  const onError = (error) => errors.push(error);
  const settings = {};

  let hook;
  function Harness() {
    hook = useNamespaceRefresh({
      api,
      activeClusterId: state.activeClusterId,
      settings,
      initialSelectedNamespaces: options.initialSelectedNamespaces ?? ["tools"],
      initialSelectedNamespacesByClusterId: options.initialSelectedNamespacesByClusterId,
      onError,
    });
    return null;
  }

  let view;
  // The hook polls once on mount. Awaiting that here is what the application
  // does too - a person cannot click before the first list has landed - and a
  // synchronous mount leaves the poll in flight, to resolve in the middle of
  // whatever the test does next and overwrite it.
  await React.act(async () => {
    view = mount(React.createElement(Harness));
  });
  t.after(() => view.unmount());

  return {
    state,
    errors,
    hook: () => hook,
    rerender: async () => {
      await React.act(async () => view.update(React.createElement(Harness)));
    },
    act: async (run) => {
      await React.act(async () => {
        await run();
      });
    },
  };
}

test("a poll that finds the namespaces still there leaves the selection alone", async (t) => {
  const r = await refresher(t);
  await r.act(() => r.hook().loadNamespaces("cluster-a"));

  assert.deepEqual(r.hook().namespaces, ["default", "kube-system", "tools"]);
  assert.deepEqual(r.hook().selectedNamespaces, ["tools"], "the scope the reader chose survives");
});

test("a poll for a cluster that is not the one on screen publishes nothing", async (t) => {
  // An answer can arrive for a cluster the reader has already left. It describes
  // namespaces that are not the ones being looked at, and neither its list nor
  // its reconciliation may land on the cluster that is.
  //
  // Asked directly rather than by switching clusters: switching would start a
  // legitimate poll for the new cluster and reconcile the scope against it,
  // which is correct behaviour and would hide the guard being tested.
  const r = await refresher(t, { initialSelectedNamespaces: ["tools"] });
  assert.deepEqual(r.hook().namespaces, ["default", "kube-system", "tools"], "cluster-a's list is what is on screen");

  await r.act(() => r.hook().loadNamespaces("cluster-b"));

  assert.deepEqual(r.hook().namespaces, ["default", "kube-system", "tools"], "cluster-b's list must not replace it");
  assert.deepEqual(r.hook().selectedNamespaces, ["tools"], "nor may it touch the selection");
});

test("while a cluster-scoped resource is open the poll may not rewrite what it hides", async (t) => {
  // `_cluster` is the temporary scope of Nodes and the like. The namespaced
  // selection underneath it is exactly what has to survive the detour - and the
  // remembered copy is what a later cluster switch restores from, so writing it
  // here would lose the scope for good.
  const r = await refresher(t, { initialSelectedNamespaces: ["tools"], initialSelectedNamespacesByClusterId: { "cluster-a": ["tools"] } });
  await r.act(() => r.hook().setSelectedNamespaces(["_cluster"]));

  await r.act(() => r.hook().loadNamespaces("cluster-a"));

  assert.deepEqual(r.hook().selectedNamespaces, ["_cluster"], "the visible scope is untouched");
  assert.deepEqual(r.hook().selectedNamespacesByClusterId["cluster-a"], ["tools"], "and so is the namespaced selection it hides");
});

test("an empty answer never widens a chosen scope to everything", async (t) => {
  // The list can come back empty for a moment while a cluster reconnects.
  // Falling back to all namespaces would make the table show every pod in the
  // cluster without anyone asking.
  const r = await refresher(t, { initialSelectedNamespaces: ["tools"], answer: async () => namespaceList() });

  await r.act(() => r.hook().loadNamespaces("cluster-a"));

  assert.deepEqual(r.hook().selectedNamespaces, ["tools"]);
});

test("a namespace that has really gone is dropped, and an empty scope becomes all", async (t) => {
  const r = await refresher(t, { initialSelectedNamespaces: ["tools", "default"] });
  await r.act(() => r.hook().loadNamespaces("cluster-a"));
  assert.deepEqual(r.hook().selectedNamespaces, ["tools", "default"], "both still exist, in the order they were chosen");

  r.state.answer = async () => namespaceList("default", "kube-system");
  await r.act(() => r.hook().loadNamespaces("cluster-a"));
  assert.deepEqual(r.hook().selectedNamespaces, ["default"], "the one that went is dropped");

  r.state.answer = async () => namespaceList("kube-system");
  await r.act(() => r.hook().loadNamespaces("cluster-a"));
  assert.deepEqual(r.hook().selectedNamespaces, ["all"], "with nothing left of the choice, all is the only honest scope");
});

test("each cluster keeps its own scope, and opening one restores it", async (t) => {
  const r = await refresher(t, {
    initialSelectedNamespaces: ["tools"],
    initialSelectedNamespacesByClusterId: { "cluster-a": ["tools"], "cluster-b": ["kube-system"] },
  });

  await r.act(() => r.hook().activateClusterNamespaces("cluster-b", ["default", "kube-system"]));
  assert.deepEqual(r.hook().selectedNamespaces, ["kube-system"], "cluster-b remembers its own scope");

  await r.act(() => r.hook().activateClusterNamespaces("cluster-a", ["default", "tools"]));
  assert.deepEqual(r.hook().selectedNamespaces, ["tools"], "and cluster-a still has its own");
});

test("a cluster that is removed takes its remembered scope with it", async (t) => {
  const r = await refresher(t, { initialSelectedNamespacesByClusterId: { "cluster-a": ["tools"], "cluster-b": ["kube-system"] } });

  await r.act(() => r.hook().forgetClusterNamespaces("cluster-b"));

  assert.deepEqual(Object.keys(r.hook().selectedNamespacesByClusterId), ["cluster-a"]);
});

test("a failed poll is silent by default and speaks when asked", async (t) => {
  const r = await refresher(t, {
    answer: async () => {
      throw new Error("connection refused");
    },
  });

  await r.act(() => r.hook().loadNamespaces("cluster-a"));
  assert.deepEqual(r.errors, [], "a background poll that fails is not the reader's problem");

  await r.act(() => r.hook().loadNamespaces("cluster-a", false));
  assert.equal(r.errors.length, 1, "one the reader asked for is");
});
