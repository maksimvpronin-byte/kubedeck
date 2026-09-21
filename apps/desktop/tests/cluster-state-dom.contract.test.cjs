// Hooks and panels that decide what the user is told about a cluster, run by
// real React: the background namespace refresh, the CRD list that follows the
// active cluster, and the error panel.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadComponent, mount, React, rendererRoot, window: domWindow } = require("./helpers/dom.cjs");
const { createTestScheduler } = require("./helpers/renderer.cjs");

const { useNamespaceRefresh } = loadComponent("hooks/useNamespaceRefresh.ts");
const { useCrdDefinitions } = loadComponent("hooks/useCrdDefinitions.ts");
const { ErrorPanel } = loadComponent("components/ErrorPanel.tsx");
const { PortForwardModal } = loadComponent("components/PortForwardModal.tsx");
// The test loader does not read JSON, so the dictionary is handed over as i18n.ts would.
const russian = JSON.parse(fs.readFileSync(path.join(rendererRoot, "locales/ru.json"), "utf8"));
const translateRu = (key) => russian[key] ?? key;

function withClock() {
  const clock = createTestScheduler();
  const saved = { setTimeout: domWindow.setTimeout, clearTimeout: domWindow.clearTimeout, setInterval: domWindow.setInterval, clearInterval: domWindow.clearInterval };
  const intervals = new Map();
  let nextInterval = 0;
  domWindow.setTimeout = clock.scheduler.setTimeout;
  domWindow.clearTimeout = clock.scheduler.clearTimeout;
  domWindow.setInterval = (callback, delay) => {
    const id = `interval-${(nextInterval += 1)}`;
    const tick = () => {
      if (!intervals.has(id)) return;
      intervals.set(id, clock.scheduler.setTimeout(tick, delay));
      callback();
    };
    intervals.set(id, clock.scheduler.setTimeout(tick, delay));
    return id;
  };
  domWindow.clearInterval = (id) => {
    clock.scheduler.clearTimeout(intervals.get(id));
    intervals.delete(id);
  };
  return {
    advance(ms) {
      React.act(() => clock.advance(ms));
    },
    restore() {
      Object.assign(domWindow, saved);
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("disconnecting invalidates a pending namespace response and cancels its request", async () => {
  const calls = [];
  const api = {
    namespaces: (clusterId, signal) => {
      const call = { clusterId, signal, ...deferred() };
      calls.push(call);
      return call.promise;
    },
  };
  const onError = () => {};
  let state;
  function Probe({ clusterId }) {
    state = useNamespaceRefresh({ api, activeClusterId: clusterId, settings: { refreshIntervalSeconds: 0 }, initialSelectedNamespaces: ["all"], onError });
    return null;
  }
  const view = mount(React.createElement(Probe, { clusterId: "cluster-a" }));
  try {
    view.update(React.createElement(Probe, { clusterId: undefined }));
    await React.act(async () => calls[0].resolve({ items: [{ metadata: { name: "old-cluster" } }] }));
    assert.deepEqual(state.namespaces, [], "a disconnected cluster must not publish its namespace list");
    assert.equal(calls[0].signal.aborted, true);
  } finally {
    view.unmount();
  }
});

test("a namespace list slower than the refresh interval still arrives", async () => {
  const clock = withClock();
  const calls = [];
  const api = {
    namespaces: (clusterId, signal) => {
      const call = { clusterId, signal, ...deferred() };
      calls.push(call);
      return call.promise;
    },
  };
  let state;
  function Probe({ clusterId }) {
    state = useNamespaceRefresh({ api, activeClusterId: clusterId, settings: { refreshIntervalSeconds: 10 }, initialSelectedNamespaces: ["all"], onError: () => {} });
    return null;
  }
  const view = mount(React.createElement(Probe, { clusterId: "cluster-a" }));
  try {
    assert.equal(calls.length, 1);
    // The cluster takes 15 seconds; the refresh ticks every 10.
    clock.advance(10_000);
    assert.equal(calls.length, 1, "the tick waits for the list already asked for");
    assert.equal(calls[0].signal.aborted, false, "and does not kill it");
    await React.act(async () => calls[0].resolve({ items: [{ metadata: { name: "team-a" } }, { metadata: { name: "default" } }] }));
    assert.deepEqual(state.namespaces, ["default", "team-a"]);

    clock.advance(10_000);
    assert.equal(calls.length, 2, "the next tick runs once the previous list is in");

    // A cluster switch still supersedes whatever is running.
    view.update(React.createElement(Probe, { clusterId: "cluster-b" }));
    assert.equal(calls[1].signal.aborted, true);
    assert.equal(calls.at(-1).clusterId, "cluster-b");
  } finally {
    view.unmount();
    clock.restore();
  }
});

test("the CRD list of a cluster left before it arrived never reaches the next one", async () => {
  const calls = [];
  const errors = [];
  let rows = {};
  const setRows = (next) => {
    rows = typeof next === "function" ? next(rows) : next;
  };
  const api = {
    resources: (clusterId, resource, namespace, signal) => {
      const call = { clusterId, resource, namespace, signal, ...deferred() };
      calls.push(call);
      return call.promise;
    },
  };
  function Probe({ clusterId }) {
    useCrdDefinitions({ api, clusterId, loaded: (rows.customresourcedefinitions ?? []).length > 0, setRows, onError: (error) => errors.push(error) });
    return null;
  }
  const view = mount(React.createElement(Probe, { clusterId: "cluster-a" }));
  try {
    assert.equal(calls[0].clusterId, "cluster-a");
    view.update(React.createElement(Probe, { clusterId: "cluster-b" }));
    assert.equal(calls[0].signal.aborted, true, "leaving a cluster cancels its request");

    // B answers first, A answers late - with rows or with an error.
    await React.act(async () => calls[1].resolve({ items: [{ name: "widgets.b.example.com" }] }));
    await React.act(async () => calls[0].resolve({ items: [{ name: "gadgets.a.example.com" }] }));
    assert.deepEqual(rows.customresourcedefinitions, [{ name: "widgets.b.example.com" }]);
    await React.act(async () => calls[0].reject(new Error("cluster-a is gone")));
    assert.deepEqual(errors, [], "nor does its error");

    // Coming back to A asks again: its list never arrived.
    rows = {};
    view.update(React.createElement(Probe, { clusterId: "cluster-a" }));
    assert.equal(calls.at(-1).clusterId, "cluster-a");
    assert.equal(calls.length, 3);
  } finally {
    view.unmount();
  }
});

test("an error names what was refused, in the interface language, with the code tucked away", () => {
  const t = translateRu;
  const error = {
    code: "KUBECTL_FAILED",
    message: 'deployments.apps is forbidden: User "dev" cannot list resource "deployments" in API group "apps" in the namespace "team-a"',
    rawStderr: "Error from server (Forbidden)",
    commandPreview: "kubectl get deployments -n team-a",
  };
  const view = mount(React.createElement(ErrorPanel, { error, copyLabel: t("error.copy"), t }));
  try {
    assert.equal(view.text(".error-header strong"), "Нет доступа", "a human title, not KUBECTL_FAILED");
    assert.equal(view.text(".error-scope"), "Нет права list для deployments в namespace team-a.");
    assert.equal(view.text(".error-hints strong"), "Что проверить");
    const details = view.first("details.error-details");
    assert.ok(details, "technical details are there");
    assert.equal(details.open, false, "but folded away");
    assert.match(details.querySelector("summary").textContent, /KUBECTL_FAILED/);
  } finally {
    view.unmount();
  }

  const english = mount(React.createElement(ErrorPanel, { error: { code: "HTTP_ERROR", message: "Internal Server Error", rawStderr: "", commandPreview: "" }, copyLabel: "Copy" }));
  try {
    assert.equal(english.text(".error-header strong"), "KubeDeck could not complete the request");
    assert.doesNotMatch(english.container.textContent, /hotfix/);
  } finally {
    english.unmount();
  }
});

test("an error offers the step that fixes it, and only one that makes sense", () => {
  const calls = [];
  const kubectlMissing = { code: "KUBECTL_NOT_FOUND", message: "kubectl not found: kubectl", rawStderr: "", commandPreview: "" };
  const view = mount(React.createElement(ErrorPanel, { error: kubectlMissing, copyLabel: "Copy", t: translateRu, onRetry: () => calls.push("retry"), onOpenSettings: () => calls.push("settings") }));
  try {
    const buttons = view.all(".error-actions button").map((button) => button.textContent);
    assert.deepEqual(buttons, ["Открыть настройки"], "trying again does not find a missing kubectl");
    view.click(view.first(".error-actions button"));
    assert.deepEqual(calls, ["settings"]);
  } finally {
    view.unmount();
  }

  const timeout = { code: "RESOURCE_LOAD_TIMEOUT", message: "pods refresh did not finish", rawStderr: "", commandPreview: "" };
  const retryable = mount(React.createElement(ErrorPanel, { error: timeout, copyLabel: "Copy", t: translateRu, onRetry: () => calls.push("retry") }));
  try {
    assert.deepEqual(
      retryable.all(".error-actions button").map((button) => button.textContent),
      ["Повторить"],
    );
  } finally {
    retryable.unmount();
  }

  const withoutActions = mount(React.createElement(ErrorPanel, { error: timeout, copyLabel: "Copy" }));
  try {
    assert.ok(!withoutActions.first(".error-actions"), "no button when the caller cannot say what again means");
  } finally {
    withoutActions.unmount();
  }
});

test("the port-forward window speaks the interface language", () => {
  const draft = { namespace: "default", resource: "pod", name: "api", localPort: 0, remotePort: 8080 };
  const view = mount(
    React.createElement(PortForwardModal, {
      draft,
      row: { uid: "1", name: "api", namespace: "default", ports: "8080/TCP" },
      error: null,
      copyLabel: "Copy",
      loading: false,
      onDraftChange: () => {},
      onCancel: () => {},
      onStart: () => {},
      t: translateRu,
    }),
  );
  try {
    assert.equal(view.text("#port-forward-title"), "Проброс порта");
    assert.match(view.container.textContent, /Сделать pod\/api доступным на localhost/);
    assert.deepEqual(
      view.all("footer button").map((button) => button.textContent),
      ["Отмена", "Запустить"],
    );
    assert.doesNotMatch(view.container.textContent, /Remote port|Auto-pick|Cancel/);
  } finally {
    view.unmount();
  }
});
