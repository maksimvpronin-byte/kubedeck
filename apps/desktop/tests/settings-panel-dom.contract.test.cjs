// The settings form, rendered: the save button is in view at the top, and the
// application is told whether there is anything unsaved to lose.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window } = require("./helpers/dom.cjs");

// The panel previews the theme it is set to, and announces it with a
// CustomEvent; Node has one of its own that jsdom's window does not accept.
globalThis.CustomEvent = window.CustomEvent;

// The kubeconfig editor is CodeMirror, which does not load here, and it only
// opens from a cluster's menu; nothing below reaches it.
const { SettingsPanel } = loadComponent("components/SettingsPanel.tsx", {
  "react-dom": require("react-dom"),
  "./KubeconfigEditorModal": { KubeconfigEditorModal: () => null },
});

const SETTINGS = {
  kubectlPath: "kubectl",
  theme: "dark",
  language: "en",
  refreshIntervalSeconds: 30,
  llm: { enabled: false, provider: "openai_compatible", baseUrl: "", model: "", apiKeyConfigured: false },
};

function panel(dirtyReports, props = {}) {
  return React.createElement(SettingsPanel, {
    api: null,
    settings: SETTINGS,
    save: () => {},
    onLanguagePreview: () => {},
    onDirtyChange: (dirty) => dirtyReports.push(dirty),
    t: (key) => key,
    clusters: [],
    activeCluster: null,
    selectedNamespaces: [],
    resourceTab: "pods",
    openingClusterId: null,
    importKubeconfig: () => {},
    openCluster: () => {},
    renameCluster: () => {},
    removeCluster: () => {},
    reorderClusters: () => {},
    reorderingClusters: false,
    onError: () => {},
    ...props,
  });
}

test("the save button sits in the bar at the top of the settings", (t) => {
  const view = mount(panel([]));
  t.after(() => view.unmount());
  const bar = view.first(".settings-save-bar");
  assert.ok(bar, "there is a save bar");
  assert.equal(view.container.querySelector(".settings-panel").firstElementChild, bar, "and it comes first");
  assert.match(bar.textContent, /settings\.save/);
  assert.equal(view.all("button").filter((button) => button.textContent === "settings.save").length, 1, "the button is not also halfway down");
});

test("a change is reported as unsaved, and putting it back is not a change", (t) => {
  const reports = [];
  const view = mount(panel(reports));
  t.after(() => view.unmount());
  assert.equal(reports.at(-1), false, "opening the settings is not a change");
  assert.ok(!view.first(".settings-unsaved"));

  const kubectl = view.container.querySelector("input:not([type])");
  view.type(kubectl, "/usr/local/bin/kubectl");
  assert.equal(reports.at(-1), true);
  assert.equal(view.text(".settings-unsaved"), "settings.unsaved");

  view.type(kubectl, "kubectl");
  assert.equal(reports.at(-1), false, "the value is back as it was saved");
  assert.ok(!view.first(".settings-unsaved"));
});

test("a panel that goes away leaves nothing unsaved behind", () => {
  const reports = [];
  const view = mount(panel(reports));
  view.type(view.container.querySelector("input:not([type])"), "other");
  assert.equal(reports.at(-1), true);
  view.unmount();
  assert.equal(reports.at(-1), false, "leaving was confirmed, or the panel would still be here");
});

test("a fresh copy of the same settings does not wipe what is being edited", (t) => {
  const reports = [];
  const view = mount(panel(reports));
  t.after(() => view.unmount());
  view.type(view.container.querySelector("input:not([type])"), "/opt/kubectl");
  // Importing, renaming or opening a cluster fetches the config again.
  view.update(panel(reports, { settings: JSON.parse(JSON.stringify(SETTINGS)) }));
  assert.equal(view.container.querySelector("input:not([type])").value, "/opt/kubectl", "the edit survives");
  assert.equal(reports.at(-1), true);

  // Settings that really changed - saved elsewhere - do replace the form.
  view.update(panel(reports, { settings: { ...SETTINGS, kubectlPath: "/usr/bin/kubectl" } }));
  assert.equal(view.container.querySelector("input:not([type])").value, "/usr/bin/kubectl");
  assert.equal(reports.at(-1), false);
});
