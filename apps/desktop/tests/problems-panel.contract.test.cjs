// The Problems panel: how a row is classified and summarised, and how the
// panel sizes itself. Split out of renderer-controllers.contract.test.cjs; see
// docs/file-structure-refactor-plan.md, section F.
//
// A test marked `grep contract` reads a source file and asserts on its text.
// It breaks on a rename and passes through a real regression, so it is a
// placeholder for a behavioural test rather than one. See section C of
// docs/file-structure-refactor-plan.md.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTypeScript, rendererRoot } = require("./helpers/renderer.cjs");

// The classification used to be reachable only through the React tree, so it
// was checked by grepping ProblemsPanel.tsx. It is a module now.
const model = loadTypeScript("components/problemsModel.ts");
const t = (key) => key;

test("a problem is classified by its own category before anything is guessed", () => {
  assert.equal(model.problemCategory({ category: "crashLoop" }), "crashLoop");
  assert.equal(model.problemCategory({ category: "imagePull" }), "imagePull");
  // An unknown category is not passed through as-is: the panel has a label for
  // every category it renders, and an invented one would have none.
  assert.equal(model.problemCategory({ category: "somethingNew" }), "generic");
  assert.equal(model.problemCategory({}), "generic");
});

test("a generic problem is classified from what the row actually says", () => {
  const advice = (row) => model.problemAdvice(row, t).key;

  assert.equal(advice({ reason: "CrashLoopBackOff" }), "crashLoop");
  assert.equal(advice({ message: "Back-off restarting failed container" }), "crashLoop");
  assert.equal(advice({ reason: "ErrImagePull" }), "imagePull");
  assert.equal(advice({ message: "Failed to pull image nginx:latest" }), "imagePull");
  assert.equal(advice({ message: "0/3 nodes are available: insufficient cpu" }), "scheduling");
  assert.equal(advice({ reason: "Unschedulable" }), "scheduling");
  assert.equal(advice({ message: "node not ready" }), "node");
  assert.equal(advice({ message: "persistentvolumeclaim not bound" }), "storage");
  assert.equal(advice({ message: "Liveness probe failed" }), "probe");
  assert.equal(advice({ kind: "Event" }), "event");
  assert.equal(advice({}), "generic");

  // An explicit category wins over the text: the backend already decided.
  assert.equal(advice({ category: "node", reason: "CrashLoopBackOff" }), "node");
});

test("severity ordering puts critical first and unknown severities last", () => {
  assert.equal(model.normalizeSeverity("critical"), "critical");
  assert.equal(model.normalizeSeverity("CRITICAL"), "critical");
  assert.equal(model.normalizeSeverity("warning"), "warning");
  assert.equal(model.normalizeSeverity("whatever"), "info");
  assert.equal(model.normalizeSeverity(undefined), "info");
  assert.ok(model.severityRank("critical") < model.severityRank("warning"));
  assert.ok(model.severityRank("warning") < model.severityRank("info"));
});

test("guidance groups by category, counts each group and keeps at most four", () => {
  const rows = [
    { category: "crashLoop", severity: "critical", name: "a" },
    { category: "crashLoop", severity: "critical", name: "b" },
    { category: "imagePull", severity: "warning", name: "c" },
    { category: "storage", severity: "info", name: "d" },
    { category: "node", severity: "warning", name: "e" },
    { category: "probe", severity: "info", name: "f" },
  ];
  const guidance = model.summarizeGuidance(rows, t);

  assert.equal(guidance.length, 4, "the block shows four groups at most");
  assert.equal(guidance[0].key, "crashLoop", "the most severe group leads");
  assert.equal(guidance[0].count, 2, "two crash-looping pods are one group of two");
  assert.equal(guidance[0].severity, "critical");
  assert.ok(
    guidance.every((item) => item.title && item.nextCheck),
    "every group carries advice",
  );
});

test("opening a problem goes to the object it is about, not to the row that reported it", () => {
  // An Event row reports on a pod. Clicking it has to open the pod.
  const row = {
    resource: "events",
    namespace: "default",
    name: "web.17abc",
    kind: "Event",
    targetResource: "pods",
    targetNamespace: "shop",
    targetName: "web-7d8f",
    targetKind: "Pod",
  };
  const locator = model.problemOpenLocator(row);

  assert.equal(locator.resource, "pods");
  assert.equal(locator.namespace, "shop");
  assert.equal(locator.name, "web-7d8f");
  assert.equal(locator.uid, "pods:shop:web-7d8f", "the identity follows the target, not the event");
  assert.equal(model.problemTargetLabel(row), "pods/shop/web-7d8f");
});

test("a problem without a separate target opens itself, under a stable identity", () => {
  const row = { resource: "pods", namespace: "default", name: "web-7d8f", kind: "Pod" };
  const locator = model.problemOpenLocator(row);

  assert.equal(locator.resource, "pods");
  assert.equal(locator.namespace, "default");
  assert.equal(locator.name, "web-7d8f");
  // The row is reached by identity, and a problem row carries no Kubernetes
  // uid, so one is built from what does identify the object.
  assert.equal(locator.uid, "pods:default:web-7d8f");
  assert.equal(model.problemTargetLabel(row), "pods/default/web-7d8f");
});

test("a problem that names no resource at all is handed back untouched", () => {
  const row = { severity: "warning", message: "something happened" };
  assert.deepEqual(model.problemOpenLocator(row), row);
});

test("a cluster-scoped problem reads as _cluster rather than as an empty namespace", () => {
  assert.equal(model.problemTargetLabel({ resource: "nodes", name: "node-1" }), "nodes/_cluster/node-1");
});

test("the copied diagnostic carries the target, and names the source when they differ", () => {
  const row = {
    resource: "events",
    namespace: "default",
    name: "web.17abc",
    targetResource: "pods",
    targetNamespace: "shop",
    targetName: "web-7d8f",
    severity: "critical",
    category: "crashLoop",
    reason: "BackOff",
    message: "Back-off restarting failed container",
  };
  const text = model.problemDiagnosticText(row, { displayName: "prod" }, t);

  assert.match(text, /prod/);
  assert.match(text, /pods\/shop\/web-7d8f/);
  assert.match(text, /BackOff/);
  assert.match(text, /problems\.copy\.source/, "the reporting event is named too, since it differs from the target");
  assert.match(text, /problems\.advice\.crashLoop\.next/, "a row without its own nextCheck falls back to the advice");

  const direct = model.problemDiagnosticText({ resource: "pods", namespace: "shop", name: "web-7d8f" }, null, t);
  assert.doesNotMatch(direct, /problems\.copy\.source/, "nothing to name when the source is the target");
});

test("rows are keyed by uid, and by namespace and name when there is none", () => {
  assert.equal(model.rowKey({ uid: "abc" }), "abc");
  assert.equal(model.rowKey({ namespace: "shop", name: "web" }), "shop-web");
  assert.equal(model.rowKey({ name: "node-1" }), "_cluster-node-1");
});

test("filter options are deduplicated and sorted case-insensitively", () => {
  assert.deepEqual(model.uniqueSorted(["prod", "Dev", "prod", "acme"]), ["acme", "Dev", "prod"]);
});

// grep contract: asserts on source text, not behaviour.
test("the problems panel sizes itself by its own width, not the window's", () => {
  const problems = fs.readFileSync(path.join(rendererRoot, "styles/problems-panel.css"), "utf8");
  const panels = fs.readFileSync(path.join(rendererRoot, "styles/panels.css"), "utf8");

  // The panel is squeezed by the drawer, not by the window. A viewport media
  // query cannot see that, so on a wide screen with the drawer open the card
  // kept two columns, the button column took its max-content width, and the
  // text column collapsed until `overflow-wrap: anywhere` broke the resource
  // path one character per line.
  assert.match(problems, /\.problems-priority \{[^}]*container-type: inline-size/);
  assert.match(problems, /@container problems-priority \(max-width: 1050px\)[\s\S]*?\.problems-priority-list/);
  assert.match(problems, /@container problems-priority \(max-width: 560px\)[\s\S]*?\.problem-priority-card/);
  assert.doesNotMatch(problems, /@media[^{]*\{\s*\.problems-priority-list/, "the list must not key off the viewport again");
  assert.doesNotMatch(problems, /@media[^{]*\{\s*\.problem-priority-card/, "nor the card");

  assert.match(panels, /\.problems-guidance \{[^}]*container-type: inline-size/);
  assert.match(panels, /@container problems-guidance \(max-width: 1050px\)/);
  assert.doesNotMatch(panels, /@media[^{]*\{\s*\.problems-guidance-grid/);

  // The summary row needs no query at all - auto-fit follows the space that is
  // actually there.
  assert.match(problems, /\.problem-summary-grid \{[^}]*repeat\(auto-fit, minmax\(160px, 1fr\)\)/);
  assert.doesNotMatch(problems, /@media[^{]*\{\s*\.problem-summary-grid/);
});
