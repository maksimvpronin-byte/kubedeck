// The confirmation dialog the renderer asks with, in place of window.confirm.
//
// A native dialog on Windows could leave the window with no keyboard focus
// once it closed: the caret blinked in the table filter and no key reached it
// until the window was reloaded. What has to hold for the replacement is that
// it answers like the dialog it replaced, and that the field the person was
// typing in has the keyboard again when it closes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadComponent, mount, React, rendererRoot, window } = require("./helpers/dom.cjs");

const { ConfirmDialog } = loadComponent("components/ConfirmDialog.tsx");

const translate = (key) => key;

// The dialog is controlled, so it is driven the way the application drives it:
// a parent holding the open request, with an input that had focus before.
function harness(testContext) {
  const confirmed = [];
  let ask;
  function Harness() {
    const [request, setRequest] = React.useState(null);
    ask = setRequest;
    return React.createElement(
      React.Fragment,
      null,
      React.createElement("input", { className: "filter" }),
      React.createElement(ConfirmDialog, { request, t: translate, onClose: () => setRequest(null) }),
    );
  }
  const view = mount(React.createElement(Harness));
  testContext.after(() => view.unmount());
  return {
    view,
    confirmed,
    ask: (request) => React.act(() => ask({ title: "Unsaved changes", message: "Discard?", confirmLabel: "Discard", onConfirm: () => confirmed.push(request?.name ?? "first"), ...request })),
    dialog: () => view.first('[role="alertdialog"]'),
    buttons: () => view.all(".confirm-modal footer button"),
  };
}

const pressEscape = (target) => React.act(() => target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

test("confirming runs the action once and closes the dialog", (t) => {
  const h = harness(t);
  h.ask();
  assert.ok(h.dialog(), "the dialog is on screen");
  assert.equal(h.view.text("#confirm-dialog-title"), "Unsaved changes");
  assert.equal(h.view.text("#confirm-dialog-message"), "Discard?");

  h.view.click(h.buttons()[1]);
  assert.deepEqual(h.confirmed, ["first"]);
  assert.ok(!h.dialog(), "the dialog is gone after the answer");
});

test("cancelling, closing and Escape leave the action unrun", (t) => {
  const h = harness(t);
  h.ask();
  h.view.click(h.buttons()[0]);
  assert.ok(!h.dialog());

  h.ask();
  h.view.click(h.view.first(".confirm-modal header button"));
  assert.ok(!h.dialog());

  h.ask();
  pressEscape(h.buttons()[1]);
  assert.ok(!h.dialog());

  assert.deepEqual(h.confirmed, [], "nothing was agreed to");
});

test("the keyboard goes back to the field that had it", (t) => {
  const h = harness(t);
  const filter = h.view.first(".filter");
  filter.focus();
  assert.equal(document.activeElement, filter);

  h.ask();
  assert.equal(document.activeElement, h.buttons()[1], "Enter answers the question asked");

  pressEscape(document.activeElement);
  assert.equal(document.activeElement, filter, "typing carries on where it stopped");
});

test("a destructive question starts on Cancel", (t) => {
  const h = harness(t);
  h.ask({ danger: true, confirmLabel: "Remove" });
  assert.equal(document.activeElement, h.buttons()[0]);
  assert.ok(h.buttons()[1].classList.contains("danger"));
});

test("an action that asks a second question keeps the dialog for it", (t) => {
  // Leaving an edited drawer for unsaved settings asks twice. The second
  // question must not be closed by the answer to the first.
  const h = harness(t);
  h.ask({ name: "yaml", onConfirm: () => h.ask({ name: "settings", message: "Leave settings?" }) });
  h.view.click(h.buttons()[1]);

  assert.ok(h.dialog(), "the second question is on screen");
  assert.equal(h.view.text("#confirm-dialog-message"), "Leave settings?");
  h.view.click(h.buttons()[1]);
  assert.deepEqual(h.confirmed, ["settings"]);
  assert.ok(!h.dialog());
});

test("the renderer never opens a native dialog", () => {
  // The one property here a search answers better than a click: no file may
  // reach for window.confirm, alert or prompt, because each of them can strand
  // the keyboard on Windows.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && /\bwindow\.(confirm|alert|prompt)\s*\(/.test(fs.readFileSync(full, "utf8"))) offenders.push(path.relative(rendererRoot, full));
    }
  };
  walk(rendererRoot);
  assert.deepEqual(offenders, []);
});
