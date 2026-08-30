// The themed select, opened and chosen from.
//
// This replaces a grep contract that read ThemedSelect.tsx for the strings
// `role="listbox"`, `role="option"`, `addEventListener("pointerdown"` and
// `event.key === "Escape"`. Those four matches say the source mentions a
// listbox; they do not say a listbox opens, that Escape closes it, or that
// choosing an option reports it. The component exists because a native <select>
// cannot be themed, so what has to be proved is that the replacement behaves
// like the control it replaced.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window } = require("./helpers/dom.cjs");

const { ThemedSelect } = loadComponent("components/ThemedSelect.tsx");

const OPTIONS = [
  { value: "app", label: "app", description: "the application container" },
  { value: "sidecar", label: "sidecar" },
  { value: "init", label: "init" },
];

// The view is unmounted through `t.after` rather than at the end of the test:
// a failing assertion would skip a trailing unmount, and a component left
// mounted keeps a requestAnimationFrame alive, so the run hangs until it is
// killed instead of reporting which assertion failed.
function select(t, extra = {}) {
  const chosen = [];
  const view = mount(
    React.createElement(ThemedSelect, {
      value: "app",
      options: OPTIONS,
      ariaLabel: "Container",
      onChange: (value) => chosen.push(value),
      ...extra,
    }),
  );
  t.after(() => view.unmount());
  return {
    view,
    chosen,
    trigger: () => view.first(".themed-select-trigger"),
    menu: () => view.first('[role="listbox"]'),
    options: () => view.all('[role="option"]'),
    rerender: (next) =>
      view.update(
        React.createElement(ThemedSelect, {
          value: "app",
          options: OPTIONS,
          ariaLabel: "Container",
          onChange: (value) => chosen.push(value),
          ...extra,
          ...next,
        }),
      ),
  };
}

const press = (key) => React.act(() => window.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true })));
const pointerDownOn = (target) => React.act(() => target.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true })));

test("the menu is closed until the trigger is pressed, and it is a listbox", (t) => {
  const s = select(t);
  assert.ok(!s.menu(), "the menu must be closed");
  assert.equal(s.trigger().getAttribute("aria-expanded"), "false");
  assert.equal(s.trigger().getAttribute("aria-haspopup"), "listbox");

  s.view.click(s.trigger());

  assert.ok(s.menu(), "the trigger must open a listbox");
  assert.equal(s.trigger().getAttribute("aria-expanded"), "true");
  assert.equal(s.menu().getAttribute("aria-label"), "Container");
  // The label of each option, without the description that rides under it.
  assert.deepEqual(
    s.options().map((option) => option.querySelector(".themed-select-option-copy span").textContent),
    ["app", "sidecar", "init"],
  );
  assert.equal(s.options()[0].querySelector("small").textContent, "the application container");
});

test("the current option is the one marked selected", (t) => {
  const s = select(t, { value: "sidecar" });
  s.view.click(s.trigger());

  const selected = s.options().filter((option) => option.getAttribute("aria-selected") === "true");
  assert.equal(selected.length, 1);
  assert.match(selected[0].textContent, /sidecar/);
});

test("choosing an option closes the menu and reports the choice once", (t) => {
  const s = select(t);
  s.view.click(s.trigger());
  s.view.click(s.options()[1]);

  assert.deepEqual(s.chosen, ["sidecar"]);
  assert.ok(!s.menu(), "the menu must close behind a choice");
});

test("choosing the option that is already current changes nothing", (t) => {
  // A native select does not fire change when the same value is picked, and the
  // handlers behind this one refetch on every change.
  const s = select(t);
  s.view.click(s.trigger());
  s.view.click(s.options()[0]);

  assert.deepEqual(s.chosen, []);
  assert.ok(!s.menu(), "the menu must be closed");
});

test("Escape closes the menu and gives the trigger back the focus", (t) => {
  const s = select(t);
  s.view.click(s.trigger());
  assert.ok(s.menu());

  press("Escape");

  assert.ok(!s.menu(), "the menu must be closed");
  assert.ok(document.activeElement === s.trigger(), "the trigger must take the focus back");
});

test("Tab closes the menu, so the control does not trap the keyboard", (t) => {
  const s = select(t);
  s.view.click(s.trigger());
  press("Tab");
  assert.ok(!s.menu(), "the menu must be closed");
});

test("a press outside closes the menu, a press inside it does not", (t) => {
  const s = select(t);
  s.view.click(s.trigger());

  pointerDownOn(s.options()[2]);
  assert.ok(s.menu(), "pressing inside the menu must not close it");

  pointerDownOn(document.body);
  assert.ok(!s.menu(), "pressing outside must close it");
});

test("the keyboard opens the menu from the trigger", (t) => {
  for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) {
    const s = select(t);
    React.act(() => s.trigger().dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true })));
    assert.ok(s.menu(), `${key} must open the menu`);
  }
});

test("a disabled select does not open, and closes if it is disabled while open", (t) => {
  const s = select(t);
  s.view.click(s.trigger());
  assert.ok(s.menu());

  s.rerender({ disabled: true });

  assert.ok(!s.menu(), "a select disabled while open must close");
  assert.equal(s.trigger().disabled, true);
});
