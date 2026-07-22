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

test("namespace search keeps selected namespaces visible", () => {
  const model = loadTypeScript("components/NamespaceSelector.tsx", {
    "lucide-react": { ChevronDown: () => null, Search: () => null, X: () => null },
  });
  const namespaces = ["default", "netshoot", "payments", "production"];
  assert.deepEqual(model.filterNamespaces(namespaces, ["netshoot"], "pay"), ["netshoot", "payments"]);
  assert.deepEqual(model.filterNamespaces(namespaces, ["payments"], "pay"), ["payments"]);
  assert.deepEqual(model.filterNamespaces(namespaces, ["netshoot"], ""), namespaces);
  assert.deepEqual(model.filterNamespaces(namespaces, [], "missing"), []);
});

test("cluster selector uses the themed in-app menu instead of a native select", () => {
  const component = fs.readFileSync(path.join(rendererRoot, "components/ClusterSelector.tsx"), "utf8");
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const layout = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");
  const topbarClusterControl = app.slice(app.indexOf('<header className="topbar">'), app.indexOf("<NamespaceSelector"));

  assert.match(topbarClusterControl, /<ClusterSelector/);
  assert.doesNotMatch(topbarClusterControl, /<select/);
  assert.doesNotMatch(component, /<select/);
  assert.match(component, /aria-haspopup="listbox"/);
  assert.match(component, /role="option"/);
  assert.match(component, /window\.addEventListener\("pointerdown", closeOnOutsideClick\)/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(layout, /\.cluster-menu\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;/s);
  assert.match(layout, /\.cluster-menu-option\.is-selected/);
});

test("Pod Terminal delegates paste to the single xterm input path", () => {
  const source = fs.readFileSync(path.join(rendererRoot, "components/TerminalTab.tsx"), "utf8");
  const keyboardHandler = source.slice(source.indexOf("terminal.attachCustomKeyEventHandler"), source.indexOf("terminal.onSelectionChange"));

  assert.match(source, /terminal\.onData\(\(data\) => \{\s*sendTerminalInput\(socketRef\.current, data\);/s);
  assert.doesNotMatch(keyboardHandler, /paste|readText|sendTerminalInput/);
  assert.doesNotMatch(source, /addEventListener\("paste"/);
  assert.doesNotMatch(source, /navigator\.clipboard\?\.readText/);
});

test("pinned Pod Terminal is owned outside resource drawer navigation", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const drawer = fs.readFileSync(path.join(rendererRoot, "components/PodDrawer.tsx"), "utf8");
  const panel = fs.readFileSync(path.join(rendererRoot, "components/PinnedTerminalPanel.tsx"), "utf8");
  assert.match(app, /const \[pinnedTerminal, setPinnedTerminal\] = useState/);
  assert.match(app, /<PinnedTerminalPanel[\s\S]*target=\{pinnedTerminal\}/);
  assert.match(drawer, /onOpenTerminal\(pod, containers, containerName/);
  assert.doesNotMatch(drawer, /<TerminalTab/);
  assert.match(panel, /className=\{`pinned-terminal \$\{collapsed \? "collapsed" : ""\}`\}/);
  assert.match(panel, /<TerminalTab/);
});

test("pinned Pod Terminal has a visible resize handle and persists its dimensions", () => {
  const panel = fs.readFileSync(path.join(rendererRoot, "components/PinnedTerminalPanel.tsx"), "utf8");
  const uiState = fs.readFileSync(path.join(rendererRoot, "uiState.ts"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/terminal.css"), "utf8");
  const model = loadTypeScript("components/PinnedTerminalPanel.tsx", {
    "lucide-react": { ChevronDown: () => null, ChevronUp: () => null, X: () => null },
    "../uiState": { loadUiState: () => ({}), saveUiState: () => undefined },
    "./TerminalTab": { TerminalTab: () => null },
  });
  assert.match(uiState, /pinnedTerminalWidth\?: number/);
  assert.match(uiState, /pinnedTerminalHeight\?: number/);
  assert.match(panel, /new ResizeObserver/);
  assert.match(panel, /saveUiState\(\{ \.\.\.loadUiState\(\), pinnedTerminalWidth: width, pinnedTerminalHeight: height \}\)/);
  assert.match(panel, /className="pinned-terminal-resize-handle"/);
  assert.match(styles, /\.pinned-terminal-resize-handle\s*\{[^}]*cursor:\s*nwse-resize;/s);
  assert.deepEqual(model.resizePinnedTerminal({ width: 900, height: 560 }, 100, 80, 1200, 800), { width: 1000, height: 640 });
  assert.deepEqual(model.resizePinnedTerminal({ width: 900, height: 560 }, -1000, -1000, 1200, 800), { width: 420, height: 320 });
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

test("async action feedback enforces pending, success, error, and duplicate protection", async () => {
  const model = loadTypeScript("utils/asyncActionFeedback.ts");
  const clock = createTestScheduler();
  const phases = [];
  const controller = model.createAsyncActionFeedbackController({
    onPhaseChange: (phase) => phases.push(phase),
    scheduler: clock.scheduler,
  });

  const successful = controller.run(() => true);
  assert.equal(controller.phase(), "pending");
  assert.equal(await controller.run(() => true), false);
  await Promise.resolve();
  clock.advance(299);
  assert.equal(controller.phase(), "pending");
  clock.advance(1);
  assert.equal(await successful, true);
  assert.equal(controller.phase(), "success");
  clock.advance(model.ASYNC_ACTION_SUCCESS_MS);
  assert.equal(controller.phase(), "idle");

  const failed = controller.run(async () => {
    throw new Error("refresh failed");
  });
  await Promise.resolve();
  clock.advance(model.ASYNC_ACTION_MIN_PENDING_MS);
  assert.equal(await failed, false);
  assert.equal(controller.phase(), "error");
  clock.advance(model.ASYNC_ACTION_ERROR_MS);
  assert.equal(controller.phase(), "idle");
  assert.deepEqual(phases, ["pending", "success", "idle", "pending", "error", "idle"]);
});

test("async action feedback cleanup cancels timers and late phase changes", async () => {
  const model = loadTypeScript("utils/asyncActionFeedback.ts");
  const clock = createTestScheduler();
  const phases = [];
  const controller = model.createAsyncActionFeedbackController({
    onPhaseChange: (phase) => phases.push(phase),
    scheduler: clock.scheduler,
  });
  const completion = controller.run(() => true);
  await Promise.resolve();
  controller.dispose();
  clock.advance(5000);
  assert.equal(await completion, true);
  assert.deepEqual(phases, ["pending"]);
  assert.equal(clock.pending(), 0);
});

test("all manual refresh and reload surfaces use shared async feedback", () => {
  const required = [
    ["components/ResourceTable.tsx", /AsyncActionButton[\s\S]*refreshFeedback\.run/],
    ["components/ProblemsPanel.tsx", /refreshActionLabels\(t\)/],
    ["components/AuditPanel.tsx", /refreshFeedback\.run\(\(\) => loadAudit\(\)\)/],
    ["components/PortForwardsPanel.tsx", /refreshFeedback\.run\(\(\) => refresh\(\)\)/],
    ["components/AboutPanel.tsx", /refreshFeedback\.run\(\(\) => load\(\)\)/],
    ["components/LogsTab.tsx", /useControlledAsyncActionFeedback\(loading, refreshFailed\)/],
    ["components/SecretTab.tsx", /refreshFeedback\.run\(\(\) => loadSecret\(\)\)/],
    ["components/YamlTab.tsx", /reloadFeedback\.run\(onReloadFromCluster\)/],
    ["components/ResourceCacheDiagnostics.tsx", /refreshFeedback\.run\(loadStatus\)/],
    ["components/WatchDiagnostics.tsx", /refreshFeedback\.run\(\(\) => loadStatus\(\)\)/],
  ];
  for (const [relativePath, pattern] of required) {
    const source = fs.readFileSync(path.join(rendererRoot, relativePath), "utf8");
    assert.match(source, pattern, `${relativePath} must use shared feedback`);
  }

  const styles = fs.readFileSync(path.join(rendererRoot, "styles/base.css"), "utf8");
  assert.match(styles, /@keyframes async-action-spin/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /var\(--success-border\)/);
  assert.match(styles, /var\(--danger-border\)/);
  assert.doesNotMatch(styles, /\.async-action[^}]*!important/s);

  const button = fs.readFileSync(path.join(rendererRoot, "components/AsyncActionButton.tsx"), "utf8");
  assert.match(button, /aria-busy=\{phase === "pending"\}/);
  assert.match(button, /aria-live="polite"/);

  const problems = fs.readFileSync(path.join(rendererRoot, "components/ProblemsPanel.tsx"), "utf8");
  const audit = fs.readFileSync(path.join(rendererRoot, "components/AuditPanel.tsx"), "utf8");
  const portForwards = fs.readFileSync(path.join(rendererRoot, "components/PortForwardsPanel.tsx"), "utf8");
  const watch = fs.readFileSync(path.join(rendererRoot, "components/WatchDiagnostics.tsx"), "utf8");
  assert.match(problems, /refreshProblems\(true\)/);
  assert.match(audit, /loadAudit\(true\)/);
  assert.match(portForwards, /refresh\(\{ quiet: true \}\)/);
  assert.match(watch, /loadStatus\(\{ quiet: true \}\)/);
});

function createTestScheduler() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const scheduler = {
    now: () => now,
    setTimeout: (callback, delay) => {
      sequence += 1;
      timers.set(sequence, { callback, at: now + delay });
      return sequence;
    },
    clearTimeout: (timer) => timers.delete(timer),
  };
  return {
    scheduler,
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers.entries()].sort((left, right) => left[1].at - right[1].at)) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    pending: () => timers.size,
  };
}

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

  const secret = { clusterId: "cluster-a", resource: "secrets", row: { uid: "secret-1", namespace: "tools", name: "token" } };
  const pod = { clusterId: "cluster-a", resource: "pods", row: { uid: "pod-1", namespace: "tools", name: "api" } };
  assert.equal(model.currentSelectedResourceTarget(secret, "cluster-a", "pods"), null);
  assert.equal(model.currentSelectedResourceTarget(secret, "cluster-b", "secrets"), null);
  assert.equal(model.currentSelectedResourceTarget(pod, "cluster-a", "pods"), pod);
});

test("namespace selections are isolated and reconciled per cluster", () => {
  const normalizeNamespaceSelection = (value) => {
    const raw = Array.isArray(value) ? value : value.split(",");
    const normalized = [...new Set(raw.map((item) => item.trim()).filter(Boolean))];
    if (normalized.includes("_cluster")) return ["_cluster"];
    if (normalized.includes("all") || normalized.length === 0) return ["all"];
    return normalized;
  };
  const model = loadTypeScript("hooks/useNamespaceRefresh.ts", {
    "../utils/kubeResources": {
      arraysEqual: (left, right) => left.length === right.length && left.every((item, index) => item === right[index]),
      normalizeNamespaceSelection,
    },
    "../utils/errors": { asErrorInfo: (error) => error, isAbortError: () => false },
    "../utils/refresh": { getAutoRefreshIntervalSeconds: () => 0 },
  });

  const stored = model.normalizeClusterNamespaceSelections({
    "cluster-a": ["team-a", "shared", "team-a"],
    "cluster-b": ["team-b"],
    scoped: ["_cluster"],
    broken: "default",
  });
  assert.deepEqual(stored, { "cluster-a": ["team-a", "shared"], "cluster-b": ["team-b"] });
  assert.deepEqual(model.rememberedNamespacesForCluster(stored, "cluster-a"), ["team-a", "shared"]);
  assert.deepEqual(model.rememberedNamespacesForCluster(stored, "cluster-b"), ["team-b"]);
  assert.deepEqual(model.rememberedNamespacesForCluster(stored, "cluster-c"), ["all"]);
  assert.deepEqual(model.reconcileClusterNamespaceSelection(["team-a", "removed"], ["default", "team-a"]), ["team-a"]);
  assert.deepEqual(model.reconcileClusterNamespaceSelection(["removed"], ["default", "team-a"]), ["all"]);
  assert.deepEqual(model.reconcileClusterNamespaceSelection(["team-a"], []), ["team-a"]);
  assert.deepEqual(model.reconcileClusterNamespaceSelection(["_cluster"], ["default"]), ["all"]);
});

test("App keeps drawer selection atomic and persists namespace scope by cluster", () => {
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const persistence = fs.readFileSync(path.join(rendererRoot, "hooks/usePersistUiState.ts"), "utf8");
  assert.match(app, /useState<SelectedResourceTarget \| null>/);
  assert.match(app, /setSelectedTarget\(\{ clusterId: activeCluster\.id, resource, row: selectedRow \}\)/);
  assert.match(app, /cancelResourceNavigation\(\);\s*setSelectedTarget\(\{ clusterId: activeCluster\.id, resource, row: selectedRow \}\)/s);
  assert.doesNotMatch(app, /useState<ResourceRow \| null>\(null\)/);
  assert.doesNotMatch(app, /const \[selectedResource, setSelectedResource\]/);
  assert.match(persistence, /namespaceSelectionVersion: 2/);
  assert.match(persistence, /selectedNamespacesByClusterId/);
  assert.match(persistence, /delete next\.selectedNamespaces/);
  const navigation = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceNavigation.ts"), "utf8");
  assert.match(navigation, /navigationRequestRef\.current !== requestId/);
  assert.match(navigation, /navigationAbortRef\.current\?\.abort\(\)/);
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

  const deletedSelection = model.selectedRowAfterBulkDelete("pods", "pods", rows[0], [rows[0]], []);
  assert.equal(deletedSelection, null);
  const failedSelection = model.selectedRowAfterBulkDelete("pods", "pods", deleting, [], [{ row: rows[0], message: "forbidden" }]);
  assert.equal(failedSelection, rows[0]);
  assert.equal(model.selectedRowAfterBulkDelete("pods", "deployments", rows[0], [rows[0]], []), rows[0]);
});

test("bulk delete stays silent while node actions retain status feedback", () => {
  const actions = fs.readFileSync(path.join(rendererRoot, "hooks/useBulkResourceActions.ts"), "utf8");
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  const modal = fs.readFileSync(path.join(rendererRoot, "components/BulkActionModals.tsx"), "utf8");
  const drawerStyles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");
  const layoutStyles = fs.readFileSync(path.join(rendererRoot, "styles/layout.css"), "utf8");
  const locales = ["locales/en.json", "locales/ru.json"].map((relativePath) => fs.readFileSync(path.join(rendererRoot, relativePath), "utf8"));
  const bulkFlow = actions.slice(actions.indexOf("const confirmBulkDelete"), actions.indexOf("const requestNodeAction"));

  assert.doesNotMatch(bulkFlow, /setNodeActionMessage/);
  assert.doesNotMatch(bulkFlow, /bulkDelete\.(?:requested|completed)/);
  assert.doesNotMatch(bulkFlow, /if \(deletedRows\.length\)/);
  assert.match(bulkFlow, /await reloadResources\(target\.clusterId, target\.resource, selectedNamespaces\)/);
  assert.match(bulkFlow, /setError\(error\)/);
  assert.match(actions, /nodeActionMessage/);
  assert.match(actions, /setNodeActionMessage\(`\$\{label\} completed/);
  assert.match(app, /bulkActions\.nodeActionMessage/);
  assert.match(app, /bulkActions\.clearNodeActionMessage/);
  assert.doesNotMatch(app, /bulkActions\.(?:message|clearMessage)/);
  assert.match(modal, /bulk-delete-modal/);
  assert.match(modal, /onCopyBulkDelete/);
  assert.doesNotMatch(drawerStyles, /bulk-delete-result/);
  assert.doesNotMatch(layoutStyles, /bulk-delete-result/);
  for (const locale of locales) {
    assert.doesNotMatch(locale, /bulkDelete\.(?:requested|completed|completedAt|resultTitle|copyResult|failureDetails|failedMessage|total)/);
  }
});

test("bulk confirmations remain bound to their source cluster", () => {
  const actions = fs.readFileSync(path.join(rendererRoot, "hooks/useBulkResourceActions.ts"), "utf8");
  assert.match(actions, /interface BulkDeleteTarget \{\s*clusterId: string;/);
  assert.match(actions, /interface NodeActionConfirmation \{\s*clusterId: string;/);
  assert.match(actions, /setBulkDelete\(\{ clusterId: activeCluster\.id, resource, rows \}\)/);
  assert.match(actions, /api\.resourceAction\(target\.clusterId, target\.resource/);
  assert.match(actions, /api\.resourceAction\(target\.clusterId, "nodes"/);
  assert.match(actions, /reloadResources\(target\.clusterId, "nodes"/);
  assert.match(actions, /nodePreviewRequestRef\.current !== requestId/);
  assert.match(actions, /}, \[activeCluster\?\.id\]\)/);
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

  const firstRow = { uid: "pod-uid", name: "pod-a", namespace: "tools", status: "Running" };
  const refreshedRow = { ...firstRow, status: "Pending", restarts: 2 };
  const identity = model.drawerResourceIdentity("cluster-a", "pods", firstRow);
  assert.equal(model.drawerResourceIdentity("cluster-a", "pods", refreshedRow), identity);
  assert.notEqual(model.drawerResourceIdentity("cluster-b", "pods", refreshedRow), identity);
  assert.notEqual(model.drawerResourceIdentity("cluster-a", "deployments", refreshedRow), identity);
  assert.notEqual(model.drawerResourceIdentity("cluster-a", "pods", { ...refreshedRow, uid: "replacement-uid" }), identity);
  assert.notEqual(model.drawerResourceIdentity("cluster-a", "pods", { ...refreshedRow, name: "pod-b" }), identity);
  assert.notEqual(model.drawerResourceIdentity("cluster-a", "pods", { ...refreshedRow, namespace: "default" }), identity);
  assert.equal(model.drawerResourceIdentity("cluster-a", "pods", null), "");
});

test("drawer auto-refresh keeps stable lifecycle and YAML uses compact results", () => {
  const lifecycle = fs.readFileSync(path.join(rendererRoot, "hooks/usePodDrawerResourceLifecycle.ts"), "utf8");
  const drawer = fs.readFileSync(path.join(rendererRoot, "components/PodDrawer.tsx"), "utf8");
  const yaml = fs.readFileSync(path.join(rendererRoot, "components/YamlTab.tsx"), "utf8");
  const drawerStyles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");
  const lightStyles = fs.readFileSync(path.join(rendererRoot, "styles/related-panel-polish.css"), "utf8");

  assert.match(lifecycle, /}, \[currentObjectKey\]\);/);
  assert.doesNotMatch(lifecycle, /}, \[api, clusterId, pod,/);
  assert.match(lifecycle, /tab === "yaml" && yamlObjectKey === currentObjectKey/);
  assert.match(lifecycle, /snapshotObjectKey === currentObjectKey/);
  assert.match(lifecycle, /content: snapshotIsCurrent \? content : ""/);
  assert.match(drawer, /drawerResourceIdentity\(clusterId, resource, pod\)/);
  assert.match(drawer, /<div key=\{currentObjectKey\} className=/);
  assert.match(drawer, /setYamlStatus\(t\("yaml\.dryRunPassed"\)\)/);
  assert.match(drawer, /setYamlStatus\(t\("yaml\.applied"\)\)/);
  assert.match(yaml, /className="apply-result" role="status" aria-live="polite"/);
  for (const source of [drawer, yaml, drawerStyles, lightStyles]) {
    assert.doesNotMatch(source, /yaml-operation-output/);
  }
  assert.doesNotMatch(yaml, /Copy output/);
  assert.match(drawer, /<ErrorPanel error=\{error\}/);
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

test("resource watch lifecycle does not stop a shared backend watch", () => {
  const source = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceWatch.ts"), "utf8");
  assert.match(source, /\.startWatch\(clusterId, resource, watchNamespace\)/);
  assert.doesNotMatch(source, /\.stopWatch\(/);
  assert.doesNotMatch(source, /autoStartedWatchId/);
});

test("resource polling is only a fallback while live watch is unavailable", () => {
  const refresh = loadTypeScript("utils/refresh.ts");
  assert.equal(refresh.shouldPollResources(10, false), true);
  assert.equal(refresh.shouldPollResources(10, true), false);
  assert.equal(refresh.shouldPollResources(0, false), false);

  const watch = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceWatch.ts"), "utf8");
  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  assert.match(watch, /backendReady && socketReady/);
  assert.match(watch, /nextSocket\.onopen/);
  assert.match(watch, /return watchHealthy/);
  assert.match(app, /const watchHealthy = useResourceWatch\(/);
  assert.match(app, /shouldPollResources\(intervalSeconds, watchHealthy\)/);
});

test("resource table keeps one sticky header inside its scroll container", () => {
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(rendererRoot, "styles/resource-table.css"), "utf8");
  assert.equal((table.match(/<table\b/g) ?? []).length, 1);
  assert.equal((table.match(/<colgroup>/g) ?? []).length, 1);
  assert.match(table, /<div className="table-scroll">[\s\S]*<thead>/);
  assert.match(styles, /\.resource-table th\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*\d+;[^}]*background:\s*var\(--table-head\);/s);
});

test("resource table offers a 2000 row page without changing its default", () => {
  const state = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceTableState.ts"), "utf8");
  assert.match(state, /PAGE_SIZE_OPTIONS\s*=\s*\[50, 100, 200, 500, 1000, 2000\]/);
  assert.match(state, /DEFAULT_PAGE_SIZE\s*=\s*200/);
  assert.match(state, /visibleRows\.slice\(pageStart, pageStart \+ pageSize\)/);
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
