// Node labels: selecting nodes in the table and changing their labels at once.
//
// What has to hold: each node is sent only what it needs, a label kubelet owns
// is never offered, what will change and the command that does it are on the
// screen before anything is sent, and nothing is sent until Apply.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadComponent, mount, React, rendererRoot, window } = require("./helpers/dom.cjs");
const { loadTypeScript } = require("./helpers/renderer.cjs");

const labels = loadTypeScript("utils/nodeLabels.ts");
const { NodeLabelsModal } = loadComponent("components/NodeLabelsModal.tsx");
const { ResourceTable } = loadComponent("components/ResourceTable.tsx", { "react-dom": require("react-dom") });

// The English strings, so the assertions read the way the dialog does.
const english = JSON.parse(fs.readFileSync(path.join(rendererRoot, "locales/en.json"), "utf8"));
const translate = (key) => english[key] ?? key;

function node(name, own) {
  return { uid: `uid-${name}`, name, namespace: "", labels: { "kubernetes.io/hostname": name, "kubernetes.io/arch": "amd64", ...own } };
}

const NODES = [
  node("worker-01", { "node-role.kubernetes.io/worker": "", disktype: "ssd", team: "payments" }),
  node("worker-02", { "node-role.kubernetes.io/worker": "", disktype: "ssd", team: "payments", gpu: "a100" }),
  node("worker-03", { "node-role.kubernetes.io/worker": "", disktype: "hdd", team: "search" }),
];

test("a plan sends each node only what it needs", () => {
  const plan = labels.planNodeLabelChanges(NODES, { set: { disktype: "ssd", maintenance: "planned" }, remove: ["gpu"] });
  assert.deepEqual(
    plan.map((entry) => [entry.row.name, entry.changes]),
    [
      ["worker-01", { set: { maintenance: "planned" }, remove: [] }],
      ["worker-02", { set: { maintenance: "planned" }, remove: ["gpu"] }],
      ["worker-03", { set: { disktype: "ssd", maintenance: "planned" }, remove: [] }],
    ],
  );
  assert.deepEqual(plan[2].operations[0], { kind: "change", key: "disktype", value: "ssd", from: "hdd" });
  assert.equal(
    labels.nodeLabelCommandPreview(plan),
    [
      "kubectl label nodes worker-01 maintenance=planned --overwrite",
      "kubectl label nodes worker-02 maintenance=planned gpu- --overwrite",
      "kubectl label nodes worker-03 disktype=ssd maintenance=planned --overwrite",
    ].join("\n"),
  );

  // A node that already matches is left out of the command entirely.
  assert.equal(labels.nodeLabelCommandPreview(labels.planNodeLabelChanges(NODES, { set: { "node-role.kubernetes.io/worker": "" }, remove: ["absent"] })), "");
});

test("label keys and values follow the Kubernetes rules, and kubelet's own are refused", () => {
  assert.equal(labels.nodeLabelKeyProblem("disktype"), null);
  assert.equal(labels.nodeLabelKeyProblem("example.com/rack"), null);
  assert.equal(labels.nodeLabelKeyProblem(""), "empty");
  assert.equal(labels.nodeLabelKeyProblem("a/b/c"), "slash");
  assert.equal(labels.nodeLabelKeyProblem("Example.com/rack"), "prefix");
  assert.equal(labels.nodeLabelKeyProblem("-n"), "name");
  assert.equal(labels.nodeLabelKeyProblem("kubernetes.io/hostname"), "protected");
  assert.equal(labels.nodeLabelValueProblem(""), null);
  assert.equal(labels.nodeLabelValueProblem("two words"), "value");
  assert.equal(labels.isSystemNodeLabel("node-role.kubernetes.io/worker"), true);
  assert.equal(labels.isSystemNodeLabel("example.com/rack"), false);
  assert.deepEqual(
    labels.nodeLabelStats(NODES).map((stat) => [stat.key, stat.count]),
    [
      ["disktype", 3],
      ["gpu", 1],
      ["node-role.kubernetes.io/worker", 3],
      ["team", 3],
    ],
  );
});

function dialog(testContext, rows = NODES) {
  const confirmed = [];
  let closed = 0;
  const view = mount(
    React.createElement(NodeLabelsModal, {
      target: { clusterId: "c1", rows },
      t: translate,
      onClose: () => {
        closed += 1;
      },
      onConfirm: (changes) => confirmed.push(changes),
    }),
  );
  testContext.after(() => view.unmount());
  const row = (key) => view.all(".node-labels-row").find((item) => item.querySelector(".node-labels-key")?.textContent === key);
  const mode = (key, name) => view.click([...row(key).querySelectorAll(".node-labels-modes button")].find((button) => button.classList.contains(`is-${name}`)));
  const apply = () => view.all(".node-labels-actions button").find((button) => button.textContent === "Apply");
  return { view, confirmed, closed: () => closed, row, mode, apply };
}

test("the dialog lists the selected nodes' labels with how many carry each, and none of kubelet's", (t) => {
  const d = dialog(t);
  const keys = d.view.all(".node-labels-key").map((key) => key.textContent);
  assert.deepEqual(keys, ["disktype", "gpu", "team", "node-role.kubernetes.io/worker"], "own labels first, system labels apart");
  assert.ok(!keys.includes("kubernetes.io/hostname") && !keys.includes("kubernetes.io/arch"));
  assert.equal(d.row("gpu").querySelector(".node-labels-coverage").textContent, "1 of 3");
  assert.equal(d.row("team").querySelector(".node-labels-coverage").textContent, "3 of 3");
  assert.ok(d.apply().disabled, "nothing chosen, nothing to apply");
});

test("set, remove and add become one change list, shown before it is sent", (t) => {
  const d = dialog(t);
  d.mode("gpu", "remove");
  d.mode("team", "set");
  // The values differ between nodes, so set starts from an empty field.
  const teamInput = d.row("team").querySelector("input");
  assert.equal(teamInput.value, "");
  d.view.type(teamInput, "payments");

  const [keyInput, valueInput] = d.view.all(".node-labels-add input");
  d.view.type(keyInput, "maintenance");
  d.view.type(valueInput, "planned");
  React.act(() => d.view.first(".node-labels-add").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(keyInput.value, "", "the form clears once the label is on the list");

  assert.equal(
    d.view.text(".node-action-confirm-command"),
    [
      "kubectl label nodes worker-01 maintenance=planned --overwrite",
      "kubectl label nodes worker-02 maintenance=planned gpu- --overwrite",
      "kubectl label nodes worker-03 maintenance=planned team=payments --overwrite",
    ].join("\n"),
  );
  const changeRow = d.view.all(".node-labels-diff-row").find((item) => item.querySelector("code").textContent === "worker-03");
  assert.match(changeRow.textContent, /team: search → payments/);
  assert.deepEqual(d.confirmed, [], "nothing is sent before Apply");

  d.view.click(d.apply());
  assert.deepEqual(d.confirmed, [{ set: { team: "payments", maintenance: "planned" }, remove: ["gpu"] }]);
});

test("an invalid key cannot be added and an invalid value cannot be applied", (t) => {
  const d = dialog(t);
  const [keyInput] = d.view.all(".node-labels-add input");
  d.view.type(keyInput, "kubernetes.io/hostname");
  assert.equal(d.view.text(".node-labels-error"), english["nodeLabels.error.protected"]);
  assert.ok(d.view.first(".node-labels-add button").disabled);

  d.mode("disktype", "set");
  const input = d.row("disktype").querySelector("input");
  assert.equal(input.value, "", "values differ, so nothing is guessed");
  d.view.type(input, "fast disk");
  assert.ok(d.apply().disabled);
  d.view.type(input, "nvme");
  assert.ok(!d.apply().disabled);
});

test("Escape and Cancel close the dialog without sending", (t) => {
  const d = dialog(t);
  d.mode("gpu", "remove");
  React.act(() => d.view.first('[role="dialog"]').dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  d.view.click(d.view.all(".node-labels-actions button").find((button) => button.textContent === "Cancel"));
  assert.equal(d.closed(), 2);
  assert.deepEqual(d.confirmed, []);
});

test("the Labels button appears for selected nodes and hands them over", (t) => {
  const requested = [];
  const view = mount(
    React.createElement(ResourceTable, {
      title: "Nodes",
      rows: NODES,
      columns: [{ key: "name", label: "Name" }],
      loading: false,
      onRefresh: () => {},
      onOpen: () => {},
      onPin: () => {},
      onNamespaceClick: () => {},
      onBulkLabels: (rows) => requested.push(rows.map((row) => row.name)),
      filterLabel: "Filter",
      refreshLabel: "Refresh",
      stateKey: "node-labels-test",
      labels: { editLabels: "Labels" },
    }),
  );
  t.after(() => view.unmount());
  const button = () => view.all(".secondary-btn").find((item) => item.textContent.includes("Labels"));
  assert.ok(!button(), "nothing selected, no button");
  view.toggle(view.all("tbody .select-col input")[0]);
  view.toggle(view.all("tbody .select-col input")[2]);
  assert.match(button().textContent, /\(2\)/);
  view.click(button());
  assert.deepEqual(requested, [["worker-01", "worker-03"]]);
});
