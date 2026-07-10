const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const rendererRoot = path.resolve(__dirname, "../src/renderer");

function loadTypeScript(relativePath, stubs = {}) {
  const source = fs.readFileSync(path.join(rendererRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
    if (specifier === "react") return { useCallback: (value) => value, useEffect: () => undefined, useMemo: (value) => value(), useRef: (value) => ({ current: value }), useState: (value) => [typeof value === "function" ? value() : value, () => undefined] };
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

test("resource navigation resolves cluster and namespace scope", () => {
  const model = loadTypeScript("hooks/useResourceNavigation.ts", {
    "../navigation": {
      resourceTree: {},
      sectionForResource: (resource) => resource === "nodes" ? "nodes" : "workloads",
    },
    "../utils/kubeResources": {
      findResourceDefinition: (definitions, resource) => definitions.find((item) => item.resource === resource),
      sameResourceIdentity: () => false,
    },
  });
  const definitions = [{ resource: "nodes", namespaced: false }, { resource: "pods", namespaced: true }];
  assert.deepEqual(
    model.resolveResourceNavigationTarget({ resource: "nodes", name: "n1", uid: "n1" }, "pods", "pods", "default", ["default"], definitions),
    { resource: "nodes", section: "nodes", namespace: "_cluster", clusterScoped: true },
  );
  assert.equal(
    model.resolveResourceNavigationTarget({ resource: "pods", namespace: "tools", name: "p1", uid: "p1" }, "pods", "pods", "_cluster", ["default"], definitions).namespace,
    "tools",
  );
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
  const columns = [{ key: "name", label: "Name" }, { key: "status", label: "Status" }, { key: "age", label: "Age" }];
  assert.deepEqual(model.normalizeColumnOrder(["status", "missing"], columns), ["status", "name", "age"]);
  assert.deepEqual(model.normalizeHiddenColumns(["name", "status", "age", "missing"], columns), ["name", "status"]);
  assert.deepEqual(model.moveColumnKey(["name", "status", "age"], "age", "name"), ["age", "name", "status"]);
});
