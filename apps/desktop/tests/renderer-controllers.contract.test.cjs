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
