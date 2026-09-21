// The watch hook, run by real React against a fake socket and a fake gateway.
// What it promises: the table is called healthy only while a kubectl watch is
// running behind the socket, and a watch that ends by itself hands the table
// back to polling, reloads it and is started again.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window: domWindow } = require("./helpers/dom.cjs");
const { createTestScheduler } = require("./helpers/renderer.cjs");

const { useResourceWatch, WATCH_RESTART_DELAYS_MS } = loadComponent("hooks/useResourceWatch.ts");

class FakeSocket {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function watchHarness() {
  const clock = createTestScheduler();
  const saved = { setTimeout: domWindow.setTimeout, clearTimeout: domWindow.clearTimeout, now: Date.now, WebSocket: globalThis.WebSocket };
  domWindow.setTimeout = clock.scheduler.setTimeout;
  domWindow.clearTimeout = clock.scheduler.clearTimeout;
  Date.now = clock.scheduler.now;
  globalThis.WebSocket = FakeSocket;
  FakeSocket.instances = [];

  const starts = [];
  const refreshes = [];
  const api = {
    startWatch: (...args) => new Promise((resolve, reject) => starts.push({ args, resolve, reject })),
    resourceWatchEventsUrl: (clusterId, resource, namespace) => `ws://gateway/${clusterId}/${resource}?namespace=${namespace}`,
    parseResourceWatchEvent: (raw) => JSON.parse(raw),
  };
  const refresh = async (...args) => refreshes.push(args);
  const namespaces = ["default"];
  let healthy;
  function Probe() {
    healthy = useResourceWatch({ api, clusterId: "cluster-a", resource: "pods", namespaces, clusterScoped: false, enabled: true, refresh });
    return null;
  }
  const view = mount(React.createElement(Probe));
  return {
    starts,
    refreshes,
    get healthy() {
      return healthy;
    },
    get socket() {
      return FakeSocket.instances.at(-1);
    },
    act(callback) {
      React.act(callback);
    },
    async settle(callback) {
      await React.act(async () => callback());
    },
    advance(ms) {
      React.act(() => clock.advance(ms));
    },
    close() {
      view.unmount();
      domWindow.setTimeout = saved.setTimeout;
      domWindow.clearTimeout = saved.clearTimeout;
      Date.now = saved.now;
      globalThis.WebSocket = saved.WebSocket;
    },
  };
}

test("a watch that ends behind a live socket hands the table back to polling and comes back", async () => {
  const h = watchHarness();
  try {
    assert.equal(h.starts.length, 1);
    assert.deepEqual(h.starts[0].args, ["cluster-a", "pods", "default"]);
    await h.settle(() => h.starts[0].resolve({ id: "watch-1", alreadyRunning: false, status: "running" }));
    assert.equal(h.healthy, false, "a started watch without a socket is not live yet");
    h.act(() => h.socket.open());
    assert.equal(h.healthy, false, "opening a socket waits for confirmation that its watch is still running");
    // Opening the socket asks for the watch again: it may have died unheard.
    await h.settle(() => h.starts[1].resolve({ id: "watch-1", alreadyRunning: true, status: "running" }));
    assert.equal(h.healthy, true);

    // kubectl died; the socket, kept alive by its heartbeat, did not.
    h.act(() => h.socket.receive({ type: "watch.ended", watchId: "watch-1", status: "failed" }));
    assert.equal(h.healthy, false, "polling takes over at once");
    h.advance(1000);
    assert.equal(h.refreshes.length, 1, "and the table catches up with what the dead watch missed");

    h.advance(WATCH_RESTART_DELAYS_MS[0]);
    assert.equal(h.starts.length, 3, "the watch is started again");
    await h.settle(() => h.starts[2].resolve({ id: "watch-2", alreadyRunning: false, status: "running" }));
    assert.equal(h.healthy, true);
    h.advance(1000);
    assert.equal(h.refreshes.length, 2, "the gap before the new watch began is reloaded too");

    // An end of the replaced watch arriving late changes nothing.
    h.act(() => h.socket.receive({ type: "watch.ended", watchId: "watch-1", status: "failed" }));
    assert.equal(h.healthy, true);
  } finally {
    h.close();
  }
});

test("a watch that keeps failing is retried further and further apart", async () => {
  const h = watchHarness();
  try {
    h.act(() => h.socket.open());
    await h.settle(() => h.starts[0].reject(new Error("forbidden")));
    await h.settle(() => h.starts[1]?.reject(new Error("forbidden")));
    assert.equal(h.healthy, false);

    const startsAfter = (ms) => {
      h.advance(ms);
      return h.starts.length;
    };
    const before = h.starts.length;
    assert.equal(startsAfter(WATCH_RESTART_DELAYS_MS[0] - 1), before, "no retry before the first delay");
    assert.equal(startsAfter(1), before + 1);
    await h.settle(() => h.starts.at(-1).reject(new Error("forbidden")));
    assert.equal(startsAfter(WATCH_RESTART_DELAYS_MS[1] - 1), before + 1, "the second wait is longer");
    assert.equal(startsAfter(1), before + 2);
  } finally {
    h.close();
  }
});

test("an end arriving before the start response cannot make a dead watch healthy", async () => {
  const h = watchHarness();
  try {
    h.act(() => h.socket.open());
    h.act(() => h.socket.receive({ type: "watch.ended", watchId: "watch-1", status: "failed" }));
    await h.settle(() => h.starts[0].resolve({ id: "watch-1", status: "running" }));
    assert.equal(h.healthy, false);
    h.advance(WATCH_RESTART_DELAYS_MS[0]);
    assert.equal(h.starts.length, 2);
    await h.settle(() => h.starts[1].resolve({ id: "watch-2", status: "running" }));
    assert.equal(h.healthy, true);
  } finally {
    h.close();
  }
});

test("socket recovery verifies the watch and reloads changes missed during the gap", async () => {
  const h = watchHarness();
  try {
    await h.settle(() => h.starts[0].resolve({ id: "watch-1", status: "running" }));
    h.act(() => h.socket.open());
    await h.settle(() => h.starts[1].resolve({ id: "watch-1", status: "running" }));
    const oldSocket = h.socket;
    h.act(() => oldSocket.close());
    assert.equal(h.healthy, false);
    h.advance(1000);
    h.act(() => h.socket.open());
    assert.equal(h.healthy, false, "a connected socket does not yet prove the backend watch is running");
    await h.settle(() => h.starts[2].resolve({ id: "watch-1", status: "running" }));
    assert.equal(h.healthy, true);
    h.advance(1000);
    assert.equal(h.refreshes.length, 1, "even an unchanged watch ID must reload after a socket gap");
    h.act(() => oldSocket.receive({ type: "watch.ended", watchId: "watch-1", status: "failed" }));
    assert.equal(h.healthy, true, "messages from the replaced socket are ignored");
  } finally {
    h.close();
  }
});

test("a start reply with a stopped process is retried instead of trusted", async () => {
  const h = watchHarness();
  try {
    h.act(() => h.socket.open());
    await h.settle(() => h.starts[0].resolve({ id: "watch-1", status: "failed" }));
    assert.equal(h.healthy, false);
    h.advance(WATCH_RESTART_DELAYS_MS[0]);
    assert.equal(h.starts.length, 2);
  } finally {
    h.close();
  }
});

test("opening a socket during start rechecks for an end that had no subscriber", async () => {
  const h = watchHarness();
  try {
    h.act(() => h.socket.open());
    await h.settle(() => h.starts[0].resolve({ id: "watch-1", status: "running" }));
    assert.equal(h.healthy, false);
    assert.equal(h.starts.length, 2, "the first reply may predate the socket subscription");
    await h.settle(() => h.starts[1].resolve({ id: "watch-2", status: "running" }));
    assert.equal(h.healthy, true);
  } finally {
    h.close();
  }
});
