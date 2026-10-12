// The kubeconfig editor and what follows a save, run by real React: a Windows
// kubeconfig keeps its line endings, and a cluster behind the "unavailable"
// panel is opened again in the open so the error on screen is the new one.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window: domWindow } = require("./helpers/dom.cjs");

// CodeMirror does not load here; a textarea stands in for it with the same
// contract - the value in, every edit out through onChange.
function EditorStub({ value, readOnly, onChange }) {
  return React.createElement("textarea", { className: "editor-stub", value, readOnly, onChange: (event) => onChange(event.target.value) });
}

const { KubeconfigEditorModal } = loadComponent("components/KubeconfigEditorModal.tsx", {
  "./YamlSourceEditor": { YamlSourceEditor: EditorStub },
});

const CLUSTER = { id: "cluster-a", displayName: "k8s1.test.local", kubeconfigPath: "/app/kubeconfigs/cluster-a.yaml" };
const CRLF_KUBECONFIG = "apiVersion: v1\r\nclusters:\r\n- cluster:\r\n    server: https://k8s1:6443\r\n  name: k8s1\r\n";

function editText(view, textarea, value) {
  React.act(() => {
    Object.getOwnPropertyDescriptor(domWindow.HTMLTextAreaElement.prototype, "value").set.call(textarea, value);
    textarea.dispatchEvent(new domWindow.Event("input", { bubbles: true }));
  });
}

async function openModal(content, onSaved = () => {}) {
  const saves = [];
  const api = {
    clusterKubeconfig: async () => ({ clusterId: CLUSTER.id, displayName: CLUSTER.displayName, path: CLUSTER.kubeconfigPath, editable: true, maxBytes: 1024 * 1024, content }),
    saveClusterKubeconfig: async (clusterId, saved, typedName) => {
      saves.push({ clusterId, content: saved, typedName });
      return { ok: true, cluster: CLUSTER, path: CLUSTER.kubeconfigPath };
    },
  };
  let view;
  await React.act(async () => {
    view = mount(React.createElement(KubeconfigEditorModal, { api, cluster: CLUSTER, t: (key) => key, onClose: () => {}, onSaved }));
  });
  view.type(view.first(".kubeconfig-confirm input"), CLUSTER.displayName);
  return { view, saves };
}

const saveButton = (view) => view.all("button").find((button) => button.textContent === "kubeconfig.save");

test("a CRLF kubeconfig opens unchanged and is saved back in CRLF", async (t) => {
  const saved = [];
  const { view, saves } = await openModal(CRLF_KUBECONFIG, (cluster) => saved.push(cluster.id));
  t.after(() => view.unmount());

  assert.equal(saveButton(view).disabled, true, "opening a Windows file is not a change");

  const textarea = view.first(".editor-stub");
  editText(view, textarea, textarea.value.replace("6443", "6444"));
  assert.equal(saveButton(view).disabled, false, "the edit is something to save");

  await React.act(async () => saveButton(view).dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true })));
  assert.equal(saves.length, 1);
  assert.equal(saves[0].content, CRLF_KUBECONFIG.replace("6443", "6444"), "only the edited line differs, and every line still ends in CRLF");
  assert.deepEqual(saved, ["cluster-a"]);
});

test("an LF kubeconfig is saved in LF", async (t) => {
  const lf = CRLF_KUBECONFIG.replace(/\r\n/g, "\n");
  const { view, saves } = await openModal(lf);
  t.after(() => view.unmount());

  const textarea = view.first(".editor-stub");
  editText(view, textarea, textarea.value.replace("6443", "6444"));
  await React.act(async () => saveButton(view).dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true })));
  assert.equal(saves[0].content, lf.replace("6443", "6444"));
});

// The controller, with a gateway that refuses to open the cluster until its
// kubeconfig has been saved.
function controllerHarness(t) {
  const calls = { open: 0, config: 0 };
  let openError = new Error("forbidden: old credentials");
  class FakeApiClient {
    health() {
      return Promise.resolve({ ok: true });
    }
    config() {
      calls.config += 1;
      return Promise.resolve({ clusters: [CLUSTER], connectedClusterIds: [], settings: {} });
    }
    kubectlStatus() {
      return Promise.resolve({ version: { gitVersion: "v1.30.0" } });
    }
    openLastCluster() {
      return Promise.resolve({ cluster: null });
    }
    clearResourceCache() {
      return Promise.resolve();
    }
    resourceDefinitions() {
      return Promise.resolve({ items: [] });
    }
    openCluster() {
      calls.open += 1;
      return Promise.reject(openError);
    }
  }
  const { useClusterController } = loadComponent("hooks/useClusterController.ts", {
    "../api": { ApiClient: FakeApiClient },
    "../bootProgress": { beginBootStage() {}, completeBootStage() {}, failBootStage() {}, finishBootWhenIdle() {} },
  });

  const errors = [];
  // Made once, as App's state setters are: the boot effect depends on setError,
  // and a new one on every render would start the boot over each time.
  const options = {
    initialSelectedNamespaces: [],
    setRows: () => {},
    setSelectedRow: () => {},
    setLoading: () => {},
    setError: (error) => errors.push(typeof error === "function" ? "updater" : (error?.message ?? null)),
  };
  let controller;
  function Harness() {
    controller = useClusterController(options);
    return null;
  }

  const saved = domWindow.kubedeck;
  domWindow.kubedeck = { getBackendAuth: () => Promise.resolve({ baseUrl: "http://gateway", token: "token" }) };
  t.after(() => {
    domWindow.kubedeck = saved;
  });
  return {
    calls,
    errors,
    get controller() {
      return controller;
    },
    setOpenError(error) {
      openError = error;
    },
    async mount() {
      let view;
      await React.act(async () => {
        view = mount(React.createElement(Harness));
      });
      return view;
    },
  };
}

test("saving the kubeconfig of an unavailable cluster opens it again and shows the new error", async (t) => {
  const harness = controllerHarness(t);
  const view = await harness.mount();
  t.after(() => view.unmount());

  await React.act(async () => {
    await harness.controller.openCluster(CLUSTER).catch(() => undefined);
  });
  assert.equal(harness.controller.unavailableCluster?.id, "cluster-a", "the cluster is behind the unavailable panel");
  assert.equal(harness.errors.at(-1), "forbidden: old credentials");

  harness.setOpenError(new Error("x509: certificate signed by unknown authority"));
  const opensBefore = harness.calls.open;
  await React.act(async () => {
    await harness.controller.kubeconfigSaved(CLUSTER);
  });
  assert.ok(harness.calls.open > opensBefore, "the cluster is opened again with the new kubeconfig");
  assert.equal(harness.errors.at(-1), "x509: certificate signed by unknown authority", "and the error on screen is the new one");
});

test("saving the kubeconfig of a cluster that is not on screen re-reads the config", async (t) => {
  const harness = controllerHarness(t);
  const view = await harness.mount();
  t.after(() => view.unmount());

  const opensBefore = harness.calls.open;
  const configBefore = harness.calls.config;
  await React.act(async () => {
    await harness.controller.kubeconfigSaved({ ...CLUSTER, id: "cluster-b" });
  });
  assert.equal(harness.calls.open, opensBefore, "a cluster nobody is looking at is not opened");
  assert.ok(harness.calls.config > configBefore, "but the rail learns it was disconnected");
});
