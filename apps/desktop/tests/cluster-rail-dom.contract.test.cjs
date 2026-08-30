// The cluster rail, clicked and right-clicked.
//
// This replaces the behavioural half of a grep contract that read ClusterRail.tsx
// for `aria-current={active ? "true" : undefined}` and two `event.key ===` lines.
// Those say the source mentions the attribute and the keys; they do not say that
// exactly one button carries the attribute, or that Up and Down actually move
// the focus and wrap at the ends.
//
// The rail replaced a dropdown, so what has to hold is that switching a cluster
// takes one click, that the keyboard reaches every cluster, and that the context
// menu it grew - the only way to disconnect one - cannot be left stranded on
// screen.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window } = require("./helpers/dom.cjs");

const { ClusterRail } = loadComponent("components/ClusterRail.tsx");

const CLUSTERS = [
  { id: "c-prod", displayName: "k8s-production" },
  { id: "c-stage", displayName: "k8s-staging" },
  { id: "c-office", displayName: "k8s-office" },
];

function rail(t, extra = {}) {
  const selected = [];
  const disconnected = [];
  const imported = [];
  const props = {
    clusters: CLUSTERS,
    activeClusterId: "c-prod",
    openingClusterId: null,
    connectedClusterIds: ["c-prod"],
    railLabel: "Clusters",
    importLabel: "Import kubeconfig",
    emptyLabel: "No clusters yet",
    openingLabel: "opening",
    onSelect: (cluster) => selected.push(cluster.id),
    onImport: () => imported.push(true),
    onDisconnect: (cluster) => disconnected.push(cluster.id),
    ...extra,
  };
  const view = mount(React.createElement(ClusterRail, props));
  t.after(() => view.unmount());

  return {
    view,
    selected,
    disconnected,
    imported,
    items: () => view.all(".cluster-rail-item"),
    itemFor: (id) => view.all(".cluster-rail-item")[CLUSTERS.findIndex((cluster) => cluster.id === id)],
    menu: () => view.first('[role="menu"]'),
    menuItem: (label) => [...view.first('[role="menu"]').querySelectorAll("button")].find((button) => button.textContent.trim() === label),
    rightClick: (target) => React.act(() => target.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true }))),
    key: (target, key) => React.act(() => target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }))),
  };
}

const press = (key) => React.act(() => window.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true })));
const pointerDownOn = (target) => React.act(() => target.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true })));

test("every cluster is one button, and only the active one is marked current", (t) => {
  const r = rail(t);

  assert.equal(r.items().length, 3);
  const current = r.items().filter((item) => item.getAttribute("aria-current") === "true");
  assert.equal(current.length, 1, "exactly one cluster may be the current one");
  assert.ok(current[0] === r.itemFor("c-prod"));

  // The names share a prefix, so the rail labels what differs rather than
  // stamping "K8" on all three.
  assert.deepEqual(
    r.items().map((item) => item.querySelector("span[aria-hidden]").textContent),
    ["PR", "ST", "OF"],
  );
});

test("switching a cluster takes one click", (t) => {
  const r = rail(t);
  r.view.click(r.itemFor("c-stage"));
  assert.deepEqual(r.selected, ["c-stage"]);
});

test("the button says whether the cluster is connected, and which one is opening", (t) => {
  const r = rail(t, { openingClusterId: "c-office", unavailableClusterId: "c-stage" });

  assert.match(r.itemFor("c-prod").getAttribute("title"), /connected$/);
  assert.match(r.itemFor("c-office").getAttribute("title"), /opening$/);
  assert.ok(r.itemFor("c-prod").className.includes("is-connected"));
  assert.ok(r.itemFor("c-stage").className.includes("is-failed"), "a cluster that would not open is not merely disconnected");
  assert.ok(r.itemFor("c-office").className.includes("is-disconnected"));
});

test("Up and Down walk the rail and wrap at both ends", (t) => {
  const r = rail(t);
  // The wrap is over the clusters only: the import button sits outside the nav
  // the hook walks, so Up from the first cluster reaches the last cluster.
  r.itemFor("c-prod").focus();

  r.key(r.itemFor("c-prod"), "ArrowDown");
  assert.ok(document.activeElement === r.itemFor("c-stage"), "Down moves to the next cluster");

  r.key(r.itemFor("c-stage"), "ArrowUp");
  assert.ok(document.activeElement === r.itemFor("c-prod"), "Up moves back");

  r.key(r.itemFor("c-prod"), "ArrowUp");
  assert.ok(document.activeElement === r.itemFor("c-office"), "Up from the first wraps to the last");
});

test("the import button says what it does, and says something else when there is nothing yet", (t) => {
  const r = rail(t);
  const importButton = r.view.first(".cluster-rail-import");
  assert.equal(importButton.getAttribute("aria-label"), "Import kubeconfig");
  r.view.click(importButton);
  assert.deepEqual(r.imported, [true]);

  const empty = rail(t, { clusters: [], connectedClusterIds: [] });
  assert.equal(empty.view.first(".cluster-rail-import").getAttribute("aria-label"), "No clusters yet");
  assert.equal(empty.items().length, 0);
});

test("a right-click offers connect and disconnect, and offers only the one that applies", (t) => {
  const r = rail(t);
  assert.ok(!r.menu(), "no menu until it is asked for");

  r.rightClick(r.itemFor("c-prod"));
  assert.ok(r.menu(), "a right-click opens the menu");
  // c-prod is the connected one.
  assert.equal(r.menuItem("Connect").disabled, true);
  assert.equal(r.menuItem("Disconnect").disabled, false);

  const other = rail(t, { activeClusterId: "c-stage" });
  other.rightClick(other.itemFor("c-stage"));
  assert.equal(other.menuItem("Connect").disabled, false, "an unconnected cluster can be connected");
  assert.equal(other.menuItem("Disconnect").disabled, true);
});

test("disconnecting from the menu reports the cluster and closes the menu", (t) => {
  const r = rail(t);
  r.rightClick(r.itemFor("c-prod"));
  r.view.click(r.menuItem("Disconnect"));

  assert.deepEqual(r.disconnected, ["c-prod"]);
  assert.deepEqual(r.selected, [], "disconnecting is not also a switch");
  assert.ok(!r.menu(), "the menu closes behind the choice");
});

test("connecting from the menu is the same as clicking the cluster", (t) => {
  const r = rail(t, { activeClusterId: "c-stage" });
  r.rightClick(r.itemFor("c-stage"));
  r.view.click(r.menuItem("Connect"));

  assert.deepEqual(r.selected, ["c-stage"]);
  assert.ok(!r.menu());
});

test("the menu cannot be left stranded on screen", (t) => {
  // A context menu that outlives the click that opened it is a trap: it floats
  // over the rail and the next click goes to it instead of where it was aimed.
  const r = rail(t);

  r.rightClick(r.itemFor("c-prod"));
  press("Escape");
  assert.ok(!r.menu(), "Escape dismisses it");

  r.rightClick(r.itemFor("c-prod"));
  pointerDownOn(document.body);
  assert.ok(!r.menu(), "a press anywhere else dismisses it");

  r.rightClick(r.itemFor("c-prod"));
  React.act(() => window.dispatchEvent(new window.Event("resize")));
  assert.ok(!r.menu(), "so does the window changing size under it");
});

test("a press on the menu itself does not dismiss it before the click lands", (t) => {
  const r = rail(t);
  r.rightClick(r.itemFor("c-prod"));

  pointerDownOn(r.menuItem("Disconnect"));

  assert.ok(r.menu(), "the window-level dismiss must not swallow the menu's own press");
  assert.deepEqual(r.disconnected, [], "and the press alone is not the choice");
});
