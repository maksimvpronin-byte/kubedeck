// The resource workspace tabs, driven through the hook that owns them.
//
// This replaces the behavioural half of three grep contracts that read
// useResourceWorkspaceTabs.ts for `if (!closingActiveTab) return;`,
// `if (!pinNextSelectionRef.current) return` and the absence of
// `setNamespaceSelection(tab.namespace)`. A line being present says nothing
// about what happens when a background tab is closed while a drawer is open,
// which is the case those lines exist for.
//
// The hook takes sixteen things from the application and gives back the tab
// list and five actions, so it is driven through a harness component: real
// React, real state, real effects, with the sixteen supplied as fixtures.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React } = require("./helpers/dom.cjs");

const { useResourceWorkspaceTabs } = loadComponent("hooks/useResourceWorkspaceTabs.ts", {
  "../api": { ApiClient: class {} },
});

const CLUSTER = { id: "cluster-a", displayName: "prod" };
const OTHER_CLUSTER = { id: "cluster-b", displayName: "stage" };
const podRow = (name, namespace = "default") => ({ uid: `uid-${namespace}-${name}`, name, namespace });

// A harness that calls the hook and hands its result back, plus a record of
// every callback the hook reached for. Nothing is rendered: what is under test
// is a state machine, not markup.
function workspace(t, options = {}) {
  const events = [];
  const state = {
    selectedTarget: null,
    currentSelectedTarget: null,
    activeCluster: CLUSTER,
    clusters: [CLUSTER, OTHER_CLUSTER],
    confirms: true,
    ...options,
  };
  const drawerDirtyRef = { current: false };
  const pinNextSelectionRef = { current: false };
  const api = {
    resources: async (clusterId, resource, namespace) => {
      events.push({ name: "resources", args: [clusterId, resource, namespace] });
      return options.resources ? options.resources(clusterId, resource, namespace) : { items: [podRow("api-server")] };
    },
  };

  let hook;
  function Harness() {
    hook = useResourceWorkspaceTabs({
      api,
      activeCluster: state.activeCluster,
      clusters: state.clusters,
      section: "workloads",
      selectedPod: state.currentSelectedTarget?.row ?? null,
      selectedTarget: state.selectedTarget,
      currentSelectedTarget: state.currentSelectedTarget,
      setSelectedTarget: (value) => events.push({ name: "setSelectedTarget", args: [typeof value === "function" ? "updater" : value] }),
      setSection: (value) => events.push({ name: "setSection", args: [value] }),
      setResourceTab: (value) => events.push({ name: "setResourceTab", args: [value] }),
      setError: (value) => events.push({ name: "setError", args: [value] }),
      confirmDrawerNavigation: () => {
        events.push({ name: "confirmDrawerNavigation", args: [] });
        return state.confirms;
      },
      keepCurrentSelection: () => events.push({ name: "keepCurrentSelection", args: [] }),
      openCluster: async (cluster) => {
        events.push({ name: "openCluster", args: [cluster.id] });
        state.activeCluster = cluster;
      },
      drawerDirtyRef,
      pinNextSelectionRef,
    });
    return null;
  }

  const view = mount(React.createElement(Harness));
  t.after(() => view.unmount());

  return {
    events,
    state,
    drawerDirtyRef,
    pinNextSelectionRef,
    hook: () => hook,
    // Selecting a resource is what the table does; the hook watches for it.
    select: async (target) => {
      state.selectedTarget = target;
      state.currentSelectedTarget = target;
      await React.act(async () => view.update(React.createElement(Harness)));
    },
    act: async (run) => {
      await React.act(async () => {
        await run();
      });
    },
    // The hook closes over what it was last rendered with, so a fixture changed
    // between calls has to be handed to it the way the application would.
    rerender: async () => {
      await React.act(async () => view.update(React.createElement(Harness)));
    },
    named: (name) => events.filter((event) => event.name === name),
    tabIds: () => hook.resourceWorkspaceTabs.map((tab) => tab.id),
  };
}

const target = (row, resource = "pods") => ({ clusterId: CLUSTER.id, resource, row });

test("selecting a resource does not pin a tab on its own", async (t) => {
  // A single click opens the drawer and nothing else. The tab is the double
  // click, and the flag is how the table says which one happened.
  const w = workspace(t);
  await w.select(target(podRow("api-server")));

  assert.deepEqual(w.tabIds(), [], "a plain selection leaves no tab behind");
  // The drawer is still shown, as the transient one.
  assert.ok(w.hook().displayedResourceWorkspaceTab, "the drawer is shown without a saved tab");
  assert.equal(w.hook().activeResourceTabId, null);
});

test("the pin flag turns the next selection into a tab, once", async (t) => {
  const w = workspace(t);
  w.pinNextSelectionRef.current = true;
  await w.select(target(podRow("api-server")));

  assert.equal(w.tabIds().length, 1);
  assert.equal(w.pinNextSelectionRef.current, false, "the flag is spent, or every later click would pin too");

  await w.select(target(podRow("cache")));
  assert.equal(w.tabIds().length, 1, "the selection after it is transient again");
});

test("an eleventh tab is refused out loud rather than quietly dropping one", async (t) => {
  const w = workspace(t);
  for (let index = 0; index < 11; index += 1) {
    w.pinNextSelectionRef.current = true;
    await w.select(target(podRow(`pod-${index}`)));
  }

  assert.equal(w.tabIds().length, 10);
  const refusal = w.named("setError").at(-1);
  assert.match(refusal.args[0].message, /10 maximum/);
});

test("closing a background tab leaves the drawer where it is", async (t) => {
  // The case the whole contract exists for. Closing a tab that is not the one
  // being shown must not reach for the selection: the drawer belongs to another
  // tab, or to no tab at all.
  const w = workspace(t);
  w.pinNextSelectionRef.current = true;
  await w.select(target(podRow("api-server")));
  w.pinNextSelectionRef.current = true;
  await w.select(target(podRow("cache")));

  const [background, active] = w.tabIds();
  assert.equal(w.hook().activeResourceTabId, active);

  const before = w.events.length;
  await w.act(() => w.hook().closeResourceTab(background));

  assert.deepEqual(w.tabIds(), [active], "the background tab is gone");
  assert.equal(w.hook().activeResourceTabId, active, "and the shown one is untouched");
  assert.deepEqual(
    w.events.slice(before).map((event) => event.name),
    [],
    "closing a background tab must not touch the selection, the section or the drawer",
  );
});

test("closing the tab being shown moves to the next one and loads it", async (t) => {
  const w = workspace(t);
  w.pinNextSelectionRef.current = true;
  await w.select(target(podRow("api-server")));
  w.pinNextSelectionRef.current = true;
  await w.select(target(podRow("cache")));

  const [first, second] = w.tabIds();
  await w.act(() => w.hook().closeResourceTab(second));

  assert.deepEqual(w.tabIds(), [first]);
  assert.equal(w.hook().activeResourceTabId, first, "the neighbour takes over");
  assert.ok(w.named("resources").length > 0, "and it is loaded rather than assumed still fresh");
});

test("closing the last tab lets go of the selection", async (t) => {
  const w = workspace(t);
  w.pinNextSelectionRef.current = true;
  await w.select(target(podRow("api-server")));

  await w.act(() => w.hook().closeResourceTab(w.tabIds()[0]));

  assert.deepEqual(w.tabIds(), []);
  assert.ok(
    w.named("setSelectedTarget").some((event) => event.args[0] === null),
    "with no tab left there is nothing for the drawer to show",
  );
});

test("an unsaved drawer can refuse to be closed", async (t) => {
  const w = workspace(t, { confirms: false });
  w.pinNextSelectionRef.current = true;
  await w.select(target(podRow("api-server")));

  const id = w.tabIds()[0];
  await w.act(() => w.hook().closeResourceTab(id));

  assert.deepEqual(w.tabIds(), [id], "the tab stays open when the drawer says no");
});

test("activating a tab fetches its own namespace, not whatever is selected now", async (t) => {
  // The tab remembers the namespace it was opened from. Reading the current
  // namespace selector instead would show the wrong list - and changing the
  // selector to match would move the user's view out from under them.
  const w = workspace(t, {
    resources: async () => ({ items: [podRow("worker", "tools")] }),
  });
  w.pinNextSelectionRef.current = true;
  await w.select(target(podRow("worker", "tools")));

  const tab = w.hook().resourceWorkspaceTabs[0];
  w.events.length = 0;
  await w.act(() => w.hook().activateResourceTab(tab));

  assert.deepEqual(w.named("resources")[0].args, ["cluster-a", "pods", "tools"]);
  assert.equal(w.hook().resourceWorkspaceTabs[0].status, "ready");
});

test("a tab whose resource is gone says so instead of showing a stale row", async (t) => {
  const w = workspace(t, { resources: async () => ({ items: [] }) });
  w.pinNextSelectionRef.current = true;
  await w.select(target(podRow("api-server")));

  const tab = w.hook().resourceWorkspaceTabs[0];
  await w.act(() => w.hook().activateResourceTab(tab));

  assert.equal(w.hook().resourceWorkspaceTabs[0].status, "not-found");
  assert.ok(w.named("setSelectedTarget").some((event) => event.args[0] === null));
});

test("a tab whose cluster is gone is marked unavailable and asks for nothing", async (t) => {
  const w = workspace(t);
  w.pinNextSelectionRef.current = true;
  await w.select(target(podRow("api-server")));

  const tab = w.hook().resourceWorkspaceTabs[0];
  w.state.clusters = [];
  await w.rerender();
  w.events.length = 0;
  await w.act(() => w.hook().activateResourceTab(tab));

  assert.equal(w.hook().resourceWorkspaceTabs[0].status, "unavailable");
  assert.deepEqual(w.named("resources"), [], "there is nothing to ask and nobody to ask it");
});

test("removing a cluster takes its tabs and leaves everyone else's", async (t) => {
  const w = workspace(t);
  w.pinNextSelectionRef.current = true;
  await w.select(target(podRow("api-server")));

  await w.act(() => w.hook().removeClusterResourceTabs(OTHER_CLUSTER.id));
  assert.equal(w.tabIds().length, 1, "another cluster's removal is not this cluster's problem");

  await w.act(() => w.hook().removeClusterResourceTabs(CLUSTER.id));
  assert.deepEqual(w.tabIds(), []);
  assert.equal(w.hook().activeResourceTabId, null);
});
