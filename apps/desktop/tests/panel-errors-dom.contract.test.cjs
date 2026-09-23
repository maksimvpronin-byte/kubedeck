// Panels that poll, and the application's one error banner.
//
// A poll that succeeds used to clear the banner whatever was on it - a failed
// settings save, a failed load - within seconds; and the panels that show
// their own error also put it on the banner, so it appeared twice.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window } = require("./helpers/dom.cjs");

const { WatchDiagnostics } = loadComponent("components/WatchDiagnostics.tsx");
const { PortForwardsPanel } = loadComponent("components/PortForwardsPanel.tsx");

const settle = () => React.act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));
// The refresh button holds "pending" for a moment and ignores a second press
// meanwhile, so a test that presses it twice waits the action out.
const ASYNC_ACTION_SETTLE_MS = 1600;
const settleAction = () => React.act(async () => new Promise((resolve) => window.setTimeout(resolve, ASYNC_ACTION_SETTLE_MS)));
const t = (key) => key;
const CLUSTER = { id: "c1", displayName: "prod" };

test("a watch status poll clears only the error it raised itself", async (t_) => {
  const reports = [];
  let fail = false;
  const api = {
    watchStatus: async () => {
      if (fail) throw new Error("gateway went away");
      return { mode: "cache-invalidation", total: 0, active: 0, watches: [] };
    },
  };
  const view = mount(React.createElement(WatchDiagnostics, { api, activeCluster: CLUSTER, selectedNamespaces: ["default"], resourceTab: "pods", t, onError: (error) => reports.push(error) }));
  t_.after(() => view.unmount());
  await settle();
  assert.deepEqual(reports, [], "a successful poll with nothing of its own to clear leaves the banner alone");

  fail = true;
  view.click(view.all("button").find((button) => button.textContent.includes("common.refresh")));
  await settleAction();
  assert.equal(reports.length, 1);
  assert.match(reports[0].message, /gateway went away/);

  fail = false;
  view.click(view.all("button").find((button) => button.textContent.includes("common.refresh")));
  await settleAction();
  assert.equal(reports.at(-1), null, "its own error is taken down once it recovers");
});

test("a port-forward failure is shown in the panel, once, and copy says whether it copied", async (t_) => {
  let fail = true;
  const api = {
    portForwards: async () => {
      if (fail) throw new Error("port-forward list failed");
      return {
        items: [
          {
            id: "pf1",
            clusterId: "c1",
            namespace: "default",
            resource: "svc",
            name: "api",
            localPort: 8080,
            remotePort: 80,
            status: "running",
            pid: 42,
            url: "http://localhost:8080",
            source: "kubedeck",
            stoppable: true,
          },
        ],
      };
    },
  };
  const view = mount(React.createElement(PortForwardsPanel, { api, cluster: CLUSTER, copyLabel: "copy", t }));
  t_.after(() => view.unmount());
  await settle();
  assert.equal(view.all(".error-panel").length, 1, "the failure is on the panel");
  assert.match(view.text(".error-panel"), /port-forward list failed/);

  fail = false;
  view.click(view.all("button").find((button) => button.textContent.includes("common.refresh")));
  await settleAction();
  assert.equal(view.all(".error-panel").length, 0);

  // No clipboard in this window: the panel must not claim it copied.
  view.click(view.all("button").find((button) => button.textContent === "portForwards.copyUrl"));
  await settle();
  assert.match(view.text(".port-forward-message"), /portForwards\.copyFailed/);
});

test("opening Settings does not take down the error that brought the user there", async (t_) => {
  const { ResourceCacheDiagnostics } = loadComponent("components/ResourceCacheDiagnostics.tsx");
  const reports = [];
  const api = { resourceCacheStatus: async () => ({ items: [], ttlSeconds: 15 }) };
  const view = mount(React.createElement(ResourceCacheDiagnostics, { api, activeCluster: CLUSTER, t, onError: (error) => reports.push(error) }));
  t_.after(() => view.unmount());
  await settle();
  assert.deepEqual(reports, [], "a kubectl error with an Open settings button stays on the banner");
});
