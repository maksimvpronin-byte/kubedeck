// Renders a real renderer component into a real DOM.
//
// Most of what the renderer promises used to be checked by reading its source
// and matching a regular expression - the repository calls those "grep
// contracts" and says so in every one of them. They break on a rename and pass
// through a regression. This harness is what lets the same promises be checked
// by clicking on them instead.
//
// It is deliberately small: jsdom for the document, the project's own React,
// and the existing TypeScript loader with the real React handed to it rather
// than the do-nothing stub.
//
// Order matters here. react-dom decides at import time whether it has a DOM to
// work with, and an event system that was loaded without one never delivers a
// change event again - which is why the document is installed at the top of
// this file and react-dom is required after it, from inside `mount`.
const { JSDOM } = require("jsdom");
const { loadTypeScript, rendererRoot } = require("./renderer.cjs");

const GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "SVGElement",
  "Element",
  "Node",
  "Event",
  "InputEvent",
  "MouseEvent",
  "KeyboardEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "sessionStorage",
];

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
for (const key of GLOBALS) globalThis[key] = dom.window[key];
// The table measures itself; jsdom has no layout, so the observer exists but
// never fires and the component keeps its full-width defaults.
globalThis.ResizeObserver =
  dom.window.ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = require("react");

// Icons are decoration here: rendering the real SVG set would slow every test
// down and prove nothing about the component under test.
const lucideStub = new Proxy(
  {},
  {
    get: (_target, name) => {
      if (name === "__esModule") return true;
      const Icon = () => null;
      Icon.displayName = String(name);
      return Icon;
    },
    has: () => true,
  },
);

// The component and everything it imports, with the real React underneath.
function loadComponent(relativePath, stubs = {}) {
  return loadTypeScript(
    relativePath,
    {
      react: React,
      "react/jsx-runtime": require("react/jsx-runtime"),
      "lucide-react": lucideStub,
      ...stubs,
    },
    "dom",
  );
}

function mount(element) {
  const ReactDOMClient = require("react-dom/client");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOMClient.createRoot(container);
  React.act(() => root.render(element));

  const setInputValue = (input, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value");
    descriptor.set.call(input, value);
  };

  return {
    container,
    // Re-render with new props, the way a parent would.
    update(next) {
      React.act(() => root.render(next));
    },
    unmount() {
      React.act(() => root.unmount());
      container.remove();
    },
    // Every helper below goes through `act`, so effects and state updates have
    // settled by the time the assertion runs.
    click(target) {
      React.act(() => target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    },
    doubleClick(target) {
      React.act(() => target.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true })));
    },
    type(input, value) {
      React.act(() => {
        setInputValue(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    },
    toggle(checkbox) {
      React.act(() => checkbox.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    },
    all(selector) {
      return [...container.querySelectorAll(selector)];
    },
    first(selector) {
      return container.querySelector(selector);
    },
    text(selector) {
      return (container.querySelector(selector)?.textContent ?? "").trim();
    },
    rows() {
      return [...container.querySelectorAll("tbody tr")];
    },
    // The first cell of a row is its checkbox, so the first column lands second.
    rowNames() {
      return [...container.querySelectorAll("tbody tr")].map((row) => row.querySelectorAll("td")[1]?.textContent?.trim() ?? "");
    },
    checkedRowNames() {
      return [...container.querySelectorAll("tbody tr")].filter((row) => row.querySelector(".select-col input")?.checked).map((row) => row.querySelectorAll("td")[1]?.textContent?.trim() ?? "");
    },
  };
}

module.exports = { loadComponent, mount, React, rendererRoot, window: dom.window };
