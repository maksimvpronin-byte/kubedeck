// The resource drawer's request lifecycle and remembered tab.
// Split out of renderer-controllers.contract.test.cjs; see
// docs/file-structure-refactor-plan.md, section C.
// A test marked `grep contract` reads a source file and asserts on its text.
// It breaks on a rename and passes through a real regression, so it is a
// placeholder for a behavioural test rather than one. See section C of
// docs/file-structure-refactor-plan.md.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTypeScript, rendererRoot } = require("./helpers/renderer.cjs");

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. Both halves live in App.tsx: that the drawer's
// selection moves in one step rather than two, and that the namespace scope is
// stored per cluster. The scope half is now driven for real in
// namespace-refresh-dom.contract.test.cjs; the atomicity half is a shape of the
// shell's own state, and reaching it means mounting the whole application.
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
    metrics: {},
    serviceEndpoints: null,
    usageHistory: null,
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

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. It is about what does not happen on a refresh -
// no remount, no lost tab, no second request - inside a hook wired to the whole
// drawer. A component that is not remounted looks exactly like one that is, in
// the document.
test("drawer auto-refresh keeps stable lifecycle and YAML uses compact results", () => {
  const lifecycle = fs.readFileSync(path.join(rendererRoot, "hooks/usePodDrawerResourceLifecycle.ts"), "utf8");
  const drawer = fs.readFileSync(path.join(rendererRoot, "components/PodDrawer.tsx"), "utf8");
  const yamlActions = fs.readFileSync(path.join(rendererRoot, "hooks/usePodDrawerYamlActions.ts"), "utf8");
  const yaml = fs.readFileSync(path.join(rendererRoot, "components/YamlTab.tsx"), "utf8");
  const drawerStyles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");
  const lightStyles = fs.readFileSync(path.join(rendererRoot, "styles/related-panel.css"), "utf8");

  assert.match(lifecycle, /}, \[currentObjectKey\]\);/);
  assert.doesNotMatch(lifecycle, /}, \[api, clusterId, pod,/);
  assert.match(lifecycle, /tab === "yaml" && yamlObjectKey === currentObjectKey/);
  assert.match(lifecycle, /snapshotObjectKey === currentObjectKey/);
  assert.match(lifecycle, /content: snapshotIsCurrent \? content : ""/);
  assert.match(drawer, /drawerResourceIdentity\(clusterId, resource, pod\)/);
  assert.doesNotMatch(drawer, /<div key=\{currentObjectKey\} className=/);
  assert.match(drawer, /const resolvedInitialTab: DrawerTab = drawerTabs\.includes\(initialTab\) \? initialTab : "summary";/);
  assert.match(yamlActions, /setYamlStatus\(t\("yaml\.dryRunPassed"\)\)/);
  assert.match(yamlActions, /setYamlStatus\(t\("yaml\.applied"\)\)/);
  assert.match(yaml, /className="apply-result" role="status" aria-live="polite"/);
  for (const source of [drawer, yaml, drawerStyles, lightStyles]) {
    assert.doesNotMatch(source, /yaml-operation-output/);
  }
  assert.doesNotMatch(yaml, /Copy output/);
  const tabBody = fs.readFileSync(path.join(rendererRoot, "components/PodDrawerTabBody.tsx"), "utf8");
  assert.match(tabBody, /<ErrorPanel error=\{error\}/);
});

test("the drawer tab is remembered per resource and dropped for kinds that lack it", () => {
  const model = loadTypeScript("utils/workspaceTabs.ts");
  assert.equal(model.drawerTabForResource({}, "pods"), "summary");
  const afterYaml = model.rememberDrawerTab({}, "pods", "yaml");
  assert.equal(model.drawerTabForResource(afterYaml, "pods"), "yaml");
  assert.equal(model.drawerTabForResource(afterYaml, "services"), "summary");
  assert.equal(model.rememberDrawerTab(afterYaml, "pods", "yaml"), afterYaml, "an unchanged tab must not produce a new object");
  assert.equal(model.rememberDrawerTab(afterYaml, "", "yaml"), afterYaml);
  assert.equal(model.drawerTabForResource(model.rememberDrawerTab(afterYaml, "secrets", "secret"), "secrets"), "secret");

  const hook = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceWorkspaceTabs.ts"), "utf8");
  assert.match(hook, /drawerTab: drawerTabForResource\(drawerTabMemory, currentSelectedTarget\.resource\)/);
  assert.match(hook, /drawerTab: drawerTabForResource\(drawerTabMemory, selectedTarget\.resource\)/);

  const app = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
  assert.match(app, /rememberResourceDrawerTab\(displayedResourceWorkspaceTab\.resource, drawerTab\);/);

  const drawer = fs.readFileSync(path.join(rendererRoot, "components/PodDrawer.tsx"), "utf8");
  assert.match(drawer, /const resolvedInitialTab: DrawerTab = drawerTabs\.includes\(initialTab\) \? initialTab : "summary";/);
  assert.match(drawer, /useEffect\(\(\) => setTab\(resolvedInitialTab\), \[currentObjectKey, resolvedInitialTab\]\);/);
});
