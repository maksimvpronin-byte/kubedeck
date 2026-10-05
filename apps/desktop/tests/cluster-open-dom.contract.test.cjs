// Opening a cluster, run by real React against a fake API.
//
// Reported from a real cluster of ~1700 pods: after a click on a cluster the
// Pods table stayed blank for 3-4 seconds. Opening it, discovering its API and
// loading the first list ran one after another, each its own kubectl process
// with its own credential exchange. Discovery now runs alongside the open and
// the cluster becomes active without waiting for it - a built-in list such as
// pods does not need it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window: domWindow } = require("./helpers/dom.cjs");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const clusterA = { id: "a", displayName: "A", kubeconfigPath: "a.yaml" };
const clusterB = { id: "b", displayName: "B", kubeconfigPath: "b.yaml" };

function harness(t) {
  const calls = [];
  const pending = { definitions: new Map(), opens: new Map() };
  const respond = (map, id) => {
    if (!map.has(id)) map.set(id, deferred());
    return map.get(id);
  };
  class FakeApiClient {
    health = async () => ({ status: "ok" });
    config = async () => ({ clusters: [clusterA, clusterB], settings: {} });
    kubectlStatus = async () => ({ version: { gitVersion: "v1.33.0" } });
    openLastCluster = async () => ({ cluster: null });
    clearResourceCache = async () => ({ cleared: 0 });
    namespaces = async () => ({ items: [] });
    openCluster = (id) => {
      calls.push(`open ${id}`);
      return respond(pending.opens, id).promise;
    };
    resourceDefinitions = (id) => {
      calls.push(`definitions ${id}`);
      return respond(pending.definitions, id).promise;
    };
  }
  const { useClusterController } = loadComponent("hooks/useClusterController.ts", { "../api": { ApiClient: FakeApiClient, ApiError: class ApiError extends Error {} } });
  domWindow.kubedeck = { getBackendAuth: async () => ({ baseUrl: "http://127.0.0.1:1", token: "t" }) };
  t.after(() => {
    delete domWindow.kubedeck;
  });

  const state = {};
  // Stable, like the useState setters the app passes: the controller's effects
  // depend on them.
  const noop = () => {};
  const setError = (error) => {
    state.lastError = error;
  };
  const initialSelectedNamespaces = ["all"];
  function Harness() {
    Object.assign(state, useClusterController({ initialSelectedNamespaces, setRows: noop, setSelectedRow: noop, setLoading: noop, setError }));
    return null;
  }
  const view = mount(React.createElement(Harness));
  t.after(() => view.unmount());
  return { state, calls, pending, respond };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await React.act(async () => {});
}

test("discovery runs alongside the open, and the cluster is active before it answers", async (t) => {
  const { state, calls, respond, pending } = harness(t);
  await settle();
  assert.ok(state.api, "the client is ready");

  let opened;
  await React.act(async () => {
    opened = state.openCluster(clusterA);
  });
  await settle();
  assert.deepEqual(calls, ["definitions a", "open a"], "discovery is asked at the same time as the open, not after it");

  respond(pending.opens, "a").resolve({ cluster: clusterA, namespaces: [{ metadata: { name: "default" } }] });
  await React.act(async () => {
    await opened;
  });
  assert.equal(state.activeCluster?.id, "a", "the cluster is active while discovery is still out");
  assert.deepEqual(state.resourceDefinitions, [], "no definitions yet - and none left over from another cluster");

  respond(pending.definitions, "a").resolve({ items: [{ name: "widgets", kind: "Widget", namespaced: true }] });
  await settle();
  assert.deepEqual(
    state.resourceDefinitions.map((item) => item.name),
    ["widgets"],
  );
});

test("a failed discovery is shown but does not take the opened cluster away", async (t) => {
  const { state, respond, pending } = harness(t);
  await settle();
  let opened;
  await React.act(async () => {
    opened = state.openCluster(clusterA);
  });
  respond(pending.opens, "a").resolve({ cluster: clusterA, namespaces: [] });
  await React.act(async () => {
    await opened;
  });
  respond(pending.definitions, "a").reject(new Error("the server is currently unable to handle the request"));
  await settle();
  assert.equal(state.activeCluster?.id, "a");
  assert.equal(state.unavailableCluster, null);
  assert.match(state.lastError?.message ?? "", /unable to handle the request/);
});

test("definitions that arrive after another cluster was opened are dropped", async (t) => {
  const { state, respond, pending } = harness(t);
  await settle();
  let first;
  await React.act(async () => {
    first = state.openCluster(clusterA);
  });
  respond(pending.opens, "a").resolve({ cluster: clusterA, namespaces: [] });
  await React.act(async () => {
    await first;
  });
  let second;
  await React.act(async () => {
    second = state.openCluster(clusterB);
  });
  respond(pending.opens, "b").resolve({ cluster: clusterB, namespaces: [] });
  await React.act(async () => {
    await second;
  });
  respond(pending.definitions, "a").resolve({ items: [{ name: "from-a", kind: "A", namespaced: true }] });
  respond(pending.definitions, "b").resolve({ items: [{ name: "from-b", kind: "B", namespaced: true }] });
  await settle();
  assert.equal(state.activeCluster?.id, "b");
  assert.deepEqual(
    state.resourceDefinitions.map((item) => item.name),
    ["from-b"],
  );
});
