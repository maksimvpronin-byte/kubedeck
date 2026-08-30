// The one hook that opens every anchored popover, opened and dismissed.
//
// This replaces a grep contract that read useAnchoredPopover.ts for four
// `addEventListener` lines and then read two components for the absence of
// their own copies. That says the source is arranged a certain way; it does not
// say a popover opens, that Escape shuts it, or - the part that actually broke
// once - that a press on the trigger itself does not close and immediately
// reopen it.
//
// The hook is driven through a real consumer rather than a harness of its own,
// so the wiring the old contract checked by absence is checked by use instead.
// NodeLabelsCell renders its popover through a portal into the body, which is
// the whole point of it: the table clips what overflows, and a popover that must
// be seen whole has to leave.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window } = require("./helpers/dom.cjs");

const { NodeLabelsCell } = loadComponent("components/NodeLabelsCell.tsx", { "react-dom": require("react-dom") });

// Two chips fit - CHIP_LIMIT in the component - and the rest open in the popover.
const LABELS = [
  { key: "kubernetes.io/hostname", label: "hostname", value: "node-1", full: "kubernetes.io/hostname=node-1" },
  { key: "kubernetes.io/os", label: "os", value: "linux", full: "kubernetes.io/os=linux" },
  { key: "topology.kubernetes.io/zone", label: "zone", value: "eu-central-1a", full: "topology.kubernetes.io/zone=eu-central-1a" },
  { key: "node.kubernetes.io/instance-type", label: "instance", value: "m5.large", full: "node.kubernetes.io/instance-type=m5.large" },
];

// Unmounted through `t.after`, so a failing assertion still tears the view
// down: a component left mounted keeps a requestAnimationFrame alive and the
// run hangs instead of reporting what failed.
function cell(t, extra = {}) {
  const filtered = [];
  const view = mount(React.createElement(NodeLabelsCell, { row: { nodeLabelItems: LABELS }, onFilter: (query) => filtered.push(query), ...extra }));
  t.after(() => view.unmount());
  return {
    view,
    filtered,
    // The "+N" button. The popover is portalled into the body, so it is looked
    // for in the document rather than in the mounted container.
    trigger: () => view.first(".node-label-more"),
    popover: () => document.querySelector(".node-label-popover"),
  };
}

const press = (key) => React.act(() => window.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true })));
const pointerDownOn = (target) => React.act(() => target.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true })));

test("the hidden labels open from the cell and close again from the same button", (t) => {
  const c = cell(t);
  assert.ok(!c.popover(), "nothing is open before the trigger is pressed");

  c.view.click(c.trigger());
  assert.ok(c.popover(), "the trigger must open the popover");

  c.view.click(c.trigger());
  assert.ok(!c.popover(), "the same button must close it");
});

test("a press on the trigger does not close and reopen the popover", (t) => {
  // The pointerdown listener deliberately ignores the trigger. Without that, the
  // press closed the popover and the click that followed opened it again, so the
  // button appeared not to work at all.
  const c = cell(t);
  c.view.click(c.trigger());

  pointerDownOn(c.trigger());

  assert.ok(c.popover(), "pressing the trigger must not close it out from under its own click");
});

test("Escape closes an open popover", (t) => {
  const c = cell(t);
  c.view.click(c.trigger());
  assert.ok(c.popover());

  press("Escape");

  assert.ok(!c.popover());
});

test("a press outside closes it, a press inside does not", (t) => {
  const c = cell(t);
  c.view.click(c.trigger());

  pointerDownOn(c.popover());
  assert.ok(c.popover(), "pressing inside the popover must not close it");

  pointerDownOn(document.body);
  assert.ok(!c.popover(), "pressing outside must close it");
});

test("filtering by a label from the popover closes it and reports the label", (t) => {
  const c = cell(t);
  c.view.click(c.trigger());

  const entry = [...c.popover().querySelectorAll("button")][0];
  c.view.click(entry);

  assert.equal(c.filtered.length, 1);
  assert.match(c.filtered[0], /=/, "the full label is what a filter needs, not the short chip text");
  assert.ok(!c.popover(), "choosing a label closes the popover");
});

test("a cell with nothing hidden renders no trigger at all", (t) => {
  const c = cell(t, { row: { nodeLabelItems: LABELS.slice(0, 2) } });
  assert.ok(!c.trigger(), "two labels fit as chips, so there is nothing to open");
  assert.equal(c.view.all(".node-label-chip").length, 2);
});

test("a cell with no labels renders nothing", (t) => {
  const c = cell(t, { row: { nodeLabelItems: [] } });
  assert.equal(c.view.container.textContent, "");
});
