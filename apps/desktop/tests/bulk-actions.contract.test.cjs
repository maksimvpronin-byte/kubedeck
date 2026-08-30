// Bulk resource actions.
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

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. It is an absence: no toast, no banner, no modal
// after an action that worked. Silence has nothing to render, so a rendered
// test can only ever confirm that the particular surfaces it thought to look
// for are missing - which is what reading the source already does, more
// completely.
test("bulk delete and successful node actions stay silent", () => {
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
  assert.doesNotMatch(actions, /nodeActionMessage/);
  assert.doesNotMatch(app, /bulkActions\.nodeActionMessage/);
  assert.doesNotMatch(app, /bulkActions\.(?:message|clearMessage)/);
  assert.match(modal, /bulk-delete-modal/);
  assert.match(modal, /onCopyBulkDelete/);
  assert.doesNotMatch(drawerStyles, /bulk-delete-result/);
  assert.doesNotMatch(layoutStyles, /bulk-delete-result/);
  for (const locale of locales) {
    assert.doesNotMatch(locale, /bulkDelete\.(?:requested|completed|completedAt|resultTitle|copyResult|failureDetails|failedMessage|total)/);
  }
});

// grep contract: asserts on source text, not behaviour.
// Stays one, and here is why. The guarantee is that a confirmation raised on
// one cluster cannot be answered against another - so the interesting case is a
// cluster switch between raising and confirming, which happens through the
// application shell rather than inside this hook. Driving it would mean
// standing up the shell; what is left here is that every target carries its own
// clusterId and that every call reads it back off the target.
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
