const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const rendererRoot = path.resolve(__dirname, "../src/renderer");

function loadTypeScript(relativePath, stubs = {}) {
  const source = fs.readFileSync(path.join(rendererRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
    if (specifier === "react")
      return {
        useCallback: (value) => value,
        useEffect: () => undefined,
        useMemo: (value) => value(),
        useRef: (value) => ({ current: value }),
        useState: (value) => [typeof value === "function" ? value() : value, () => undefined],
      };
    if (specifier === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
    return {};
  };
  new Function("module", "exports", "require", output)(module, module.exports, localRequire);
  return module.exports;
}

test("cluster controller detects removal of the active cluster", () => {
  const model = loadTypeScript("hooks/useClusterController.ts");
  const active = { id: "cluster-a" };
  assert.equal(model.isActiveClusterConfigured(null, active), true);
  assert.equal(model.isActiveClusterConfigured({ clusters: [active], settings: {} }, active), true);
  assert.equal(model.isActiveClusterConfigured({ clusters: [{ id: "cluster-b" }], settings: {} }, active), false);
});

test("cluster ordering helper moves items without mutating the source", () => {
  const model = loadTypeScript("components/ClusterPanel.tsx", {
    "lucide-react": {
      ChevronDown: () => null,
      ChevronUp: () => null,
      GripVertical: () => null,
      Plus: () => null,
    },
  });
  const clusters = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(
    model.moveCluster(clusters, 2, 0).map((cluster) => cluster.id),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    model.moveCluster(clusters, 0, 1).map((cluster) => cluster.id),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    clusters.map((cluster) => cluster.id),
    ["a", "b", "c"],
  );
  assert.equal(model.moveCluster(clusters, 0, 0), clusters);
  assert.equal(model.moveCluster(clusters, -1, 0), clusters);
});

test("LLM renderer never fetches or submits Kubernetes logs", () => {
  const source = fs.readFileSync(path.join(rendererRoot, "components/LlmTab.tsx"), "utf8");
  assert.doesNotMatch(source, /\.podLogs\(|\.deploymentLogs\(/);
  assert.doesNotMatch(source, /previousLogs\s*:/);
  assert.doesNotMatch(source, /logs\s*:/);
});

test("namespace selector keeps complete long names readable", () => {
  const component = fs.readFileSync(path.join(rendererRoot, "components/NamespaceSelector.tsx"), "utf8");
  const layout = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");
  assert.match(component, /className="namespace-menu-label"/);
  assert.match(component, /title=\{namespace\}/);
  assert.match(layout, /\.namespace-menu\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;/s);
  assert.match(layout, /\.namespace-menu-options\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;/s);
  assert.match(layout, /\.namespace-menu-label\s*\{[^}]*min-width:\s*max-content;[^}]*white-space:\s*nowrap;/s);
  assert.doesNotMatch(layout, /\.namespace-menu\s*\{[^}]*max-width:/s);
  assert.doesNotMatch(layout, /\.namespace-menu-label\s*\{[^}]*(?:text-overflow|overflow-wrap):/s);
});

test("theme preferences normalize legacy values and resolve System safely", () => {
  const model = loadTypeScript("utils/theme.ts");
  const darkMedia = { matches: true };
  const lightMedia = { matches: false };
  assert.equal(model.normalizeThemePreference("dark"), "midnight");
  assert.equal(model.normalizeThemePreference("unknown-theme"), "midnight");
  assert.equal(model.resolveTheme("system", darkMedia), "midnight");
  assert.equal(model.resolveTheme("system", lightMedia), "light");
  assert.equal(model.resolveTheme("nord", lightMedia), "nord");
  assert.deepEqual(
    model.THEME_OPTIONS.map(({ id }) => id),
    ["system", "light", "midnight", "nord", "forest", "plum", "mocha"],
  );
});

test("theme application updates data attributes and persists the preference", () => {
  const previous = {
    document: global.document,
    localStorage: global.localStorage,
    window: global.window,
    CustomEvent: global.CustomEvent,
  };
  const stored = new Map();
  const events = [];
  global.document = { documentElement: { dataset: {} } };
  global.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  global.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  global.window = {
    dispatchEvent: (event) => events.push(event),
    matchMedia: () => ({ matches: true }),
  };
  try {
    const model = loadTypeScript("utils/theme.ts");
    assert.equal(model.applyThemePreference("plum", { matches: false }), "plum");
    assert.deepEqual(global.document.documentElement.dataset, { themePreference: "plum", theme: "plum" });
    assert.equal(stored.get("kubedeck.theme"), "plum");
    stored.set("kubedeck.theme", "dark");
    assert.equal(model.restoreStoredThemePreference(), "midnight");
    assert.equal(global.document.documentElement.dataset.theme, "midnight");
    assert.equal(events.at(-1).detail, "midnight");
    stored.delete("kubedeck.theme");
    assert.equal(model.restoreStoredThemePreference(), "midnight");
    assert.equal(global.document.documentElement.dataset.themePreference, "system");
  } finally {
    global.document = previous.document;
    global.localStorage = previous.localStorage;
    global.window = previous.window;
    global.CustomEvent = previous.CustomEvent;
  }
});

test("every color theme exposes the shared token contract", () => {
  const tokens = fs.readFileSync(path.join(rendererRoot, "styles/tokens.css"), "utf8");
  const required = [
    "app-bg",
    "sidebar-bg",
    "topbar-bg",
    "panel",
    "panel-muted",
    "surface",
    "surface-2",
    "surface-hover",
    "surface-active",
    "surface-selected",
    "focus-ring",
    "text",
    "text-strong",
    "text-inverse",
    "muted",
    "border",
    "border-strong",
    "input-bg",
    "input-border",
    "button-bg",
    "button-border",
    "button-hover",
    "button-active",
    "button-disabled-bg",
    "button-disabled-text",
    "primary",
    "primary-soft",
    "code-bg",
    "terminal-bg",
    "terminal-text",
    "overlay",
    "shadow-menu",
    "shadow-lg",
    "success-bg",
    "warning-bg",
    "danger-bg",
    "error-bg",
    "scrollbar-track",
    "scrollbar-thumb",
    "primary-resize",
  ];
  for (const token of required) assert.match(tokens, new RegExp(`--${token}:`), `missing --${token}`);
  for (const theme of ["midnight", "nord", "forest", "plum", "mocha", "light"]) {
    assert.match(tokens, new RegExp(`data-theme=["']${theme}["']`), `missing ${theme} selector`);
  }

  const blocks = [...tokens.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
  const base = cssHexTokens(blocks.filter(([, selector]) => selector.includes(":root,") || selector.includes('data-theme="midnight"')));
  for (const theme of ["midnight", "nord", "forest", "plum", "mocha", "light"]) {
    const palette = {
      ...base,
      ...cssHexTokens(blocks.filter(([, selector]) => selector.includes(`data-theme="${theme}"`))),
    };
    for (const [foreground, background] of [
      ["text", "app-bg"],
      ["text", "panel"],
      ["muted", "panel"],
    ]) {
      assert.ok(contrastRatio(palette[foreground], palette[background]) >= 4.5, `${theme} ${foreground}/${background} must meet WCAG AA`);
    }
  }
});

function cssHexTokens(blocks) {
  const result = {};
  for (const [, , body] of blocks) {
    for (const match of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) result[match[1]] = match[2];
  }
  return result;
}

function contrastRatio(first, second) {
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(first), luminance(second)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

test("resource pagination uses semantic button tokens for every state", () => {
  const component = fs.readFileSync(path.join(rendererRoot, "components/ResourceTablePagination.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");
  assert.equal((component.match(/className="secondary-btn"/g) || []).length, 4);
  for (const state of ["secondary-btn {", ":hover:not(:disabled)", ":active:not(:disabled)", ":disabled"]) {
    assert.match(styles, new RegExp(`\\.pagination-actions[\\s\\S]*?${state.replace(/[()]/g, "\\$&")}`));
  }
  for (const token of ["--button-bg", "--button-border", "--button-hover", "--button-active", "--button-disabled-bg"]) {
    assert.match(styles, new RegExp(`var\\(${token}\\)`));
  }
});

test("resource navigation resolves cluster and namespace scope", () => {
  const model = loadTypeScript("hooks/useResourceNavigation.ts", {
    "../navigation": {
      resourceTree: {},
      sectionForResource: (resource) => (resource === "nodes" ? "nodes" : "workloads"),
    },
    "../utils/kubeResources": {
      findResourceDefinition: (definitions, resource) => definitions.find((item) => item.resource === resource),
      sameResourceIdentity: () => false,
    },
  });
  const definitions = [
    { resource: "nodes", namespaced: false },
    { resource: "pods", namespaced: true },
  ];
  assert.deepEqual(model.resolveResourceNavigationTarget({ resource: "nodes", name: "n1", uid: "n1" }, "pods", "pods", "default", ["default"], definitions), {
    resource: "nodes",
    section: "nodes",
    namespace: "_cluster",
    clusterScoped: true,
  });
  assert.equal(model.resolveResourceNavigationTarget({ resource: "pods", namespace: "tools", name: "p1", uid: "p1" }, "pods", "pods", "_cluster", ["default"], definitions).namespace, "tools");
});

test("bulk action helpers preserve identity, scope summary, and terminating state", () => {
  const model = loadTypeScript("hooks/useBulkResourceActions.ts");
  const rows = [
    { uid: "a", name: "pod-a", namespace: "default" },
    { uid: "b", name: "pod-b", namespace: "tools" },
  ];
  assert.equal(model.resourceIdentityLabel(rows[0]), "default/pod-a");
  assert.equal(model.bulkDeleteNamespaceSummary(rows), "default, tools");
  assert.match(model.bulkDeleteListText("pods", rows), /pods default\/pod-a/);
  const deleting = model.markDeletingRow("pods", rows[0]);
  assert.equal(deleting.status, "Terminating");
  assert.equal(deleting.phase, "Terminating");
  assert.ok(deleting.deletionTimestamp);
});

test("bulk partial failures preserve counts and command preview without leaking Secret data", () => {
  const model = loadTypeScript("hooks/useBulkResourceActions.ts");
  const error = model.buildPartialActionError({
    label: "Drain",
    resource: "nodes",
    completedCount: 1,
    failures: [
      { row: { uid: "b", name: "node-b" }, message: "Secret token=super-sensitive-value" },
      { row: { uid: "c", name: "node-c" }, message: "connection timed out" },
    ],
    commandPreview: "kubectl drain node-a\nkubectl drain node-b\nkubectl drain node-c",
  });
  assert.equal(error.code, "PARTIAL_RESULT");
  assert.equal(error.message, "Drain partial result. Completed: 1. Failed: 2.");
  assert.match(error.rawStderr, /nodes _cluster\/node-b - Sensitive error details were redacted/);
  assert.match(error.rawStderr, /nodes _cluster\/node-c - connection timed out/);
  assert.doesNotMatch(error.rawStderr, /super-sensitive-value/);
  assert.match(error.commandPreview, /kubectl drain node-b/);
});

test("resource table normalization keeps known columns and one visible column", () => {
  const model = loadTypeScript("hooks/useResourceTableState.ts", {
    "../utils/time": { parseTimestamp: (value) => Date.parse(String(value)) },
  });
  const columns = [
    { key: "name", label: "Name" },
    { key: "status", label: "Status" },
    { key: "age", label: "Age" },
  ];
  assert.deepEqual(model.normalizeColumnOrder(["status", "missing"], columns), ["status", "name", "age"]);
  assert.deepEqual(model.normalizeHiddenColumns(["name", "status", "age", "missing"], columns), ["name", "status"]);
  assert.deepEqual(model.moveColumnKey(["name", "status", "age"], "age", "name"), ["age", "name", "status"]);
  assert.deepEqual(model.resourceTablePreferencePatch("pods", columns, { name: 240 }, ["status", "name"], ["age"]), {
    columnWidths: { pods: { name: 240 } },
    columnOrders: { pods: ["status", "name", "age"] },
    hiddenColumns: { pods: ["age"] },
  });
});

test("drawer request generations reject stale responses and reset resource data", () => {
  const model = loadTypeScript("hooks/usePodDrawerResourceLifecycle.ts", {
    "../api": { ApiError: class ApiError extends Error {} },
    "../components/podDrawerHelpers": { isAbortError: () => false },
  });
  const guard = model.createDrawerRequestGuard();
  const yamlRequest = guard.next();
  const describeRequest = guard.next();
  assert.equal(guard.isCurrent(yamlRequest), false);
  assert.equal(guard.isCurrent(describeRequest), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(describeRequest), false);
  assert.deepEqual(model.drawerResourceResetSnapshot(), {
    content: "",
    describeContent: "",
    yamlBaseline: "",
    yamlDraft: "",
    yamlObjectKey: "",
    events: [],
    relatedLinks: [],
    relatedSources: {},
    relatedErrors: [],
  });
});

test("watch reconnect controller keeps one pending reconnect and stops cleanly", () => {
  const model = loadTypeScript("hooks/useResourceWatch.ts");
  const scheduled = [];
  const cancelled = [];
  const controller = model.createWatchReconnectController(
    (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    (timer) => cancelled.push(timer),
    25,
  );
  const first = controller.connectionStarted();
  controller.connectionClosed(first, () => undefined);
  controller.connectionClosed(first, () => undefined);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 25);
  const second = controller.connectionStarted();
  controller.connectionClosed(first, () => undefined);
  assert.equal(scheduled.length, 1);
  controller.stop();
  assert.deepEqual(cancelled, [1]);
  controller.connectionClosed(second, () => undefined);
  assert.equal(scheduled.length, 1);
});

test("lazy panel boundary resets its failure after navigation", () => {
  class Component {
    constructor(props) {
      this.props = props;
      this.state = {};
    }
    setState(next) {
      this.state = { ...this.state, ...next };
    }
  }
  const model = loadTypeScript("components/LazyPanelBoundary.tsx", { react: { Component } });
  const boundary = new model.LazyPanelBoundary({ resetKey: "settings", children: null });
  boundary.state = { failed: true };
  boundary.props = { resetKey: "about", children: null };
  boundary.componentDidUpdate({ resetKey: "settings", children: null });
  assert.equal(boundary.state.failed, false);
});

test("renderer error normalizer preserves ApiError fields and redacts sensitive fallbacks", () => {
  class ApiError extends Error {
    constructor(info) {
      super(info.message);
      this.info = info;
    }
  }
  const model = loadTypeScript("utils/errors.ts", { "../api": { ApiError } });
  const apiInfo = { code: "FORBIDDEN", message: "Denied", rawStderr: "safe diagnostic", commandPreview: "kubectl auth can-i" };
  assert.deepEqual(model.toErrorInfo(new ApiError(apiInfo)), apiInfo);
  const fallback = model.toErrorInfo(new Error("Authorization Bearer super-secret-token"));
  assert.equal(fallback.message, "Sensitive error details were redacted");
  assert.doesNotMatch(JSON.stringify(fallback), /super-secret-token/);
  assert.equal(model.toErrorInfo({ message: "timeout", rawStderr: "password=hunter2" }).rawStderr, "Sensitive error details were redacted");
});
