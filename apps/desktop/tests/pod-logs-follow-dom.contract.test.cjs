// Following a pod's logs, run by real React against a fake socket.
//
// Reported from a real cluster: with Follow on, the Logs tab flashed between
// the log and "No log lines" every few seconds. Every table refresh handed the
// drawer a new row object for the same pod; the stream was keyed by that
// object, so it was closed and reopened each time, and each open cleared the
// tab before the tail arrived again.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window: domWindow } = require("./helpers/dom.cjs");
const { createTestScheduler } = require("./helpers/renderer.cjs");

const { usePodDrawerLogs, LOG_STREAM_RETRY_DELAYS_MS } = loadComponent("hooks/usePodDrawerLogs.ts");

class FakeSocket {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closedByClient = false;
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  // The server side hanging up.
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  // The client side hanging up, as the hook does in its cleanup.
  close() {
    this.readyState = 3;
    this.closedByClient = true;
  }
}

function pod(extra = {}) {
  return { uid: "uid-api", name: "api", namespace: "default", containers: ["app"], ...extra };
}

function harness() {
  const clock = createTestScheduler();
  const saved = { setTimeout: domWindow.setTimeout, clearTimeout: domWindow.clearTimeout, WebSocket: globalThis.WebSocket };
  domWindow.setTimeout = clock.scheduler.setTimeout;
  domWindow.clearTimeout = clock.scheduler.clearTimeout;
  globalThis.WebSocket = FakeSocket;
  FakeSocket.instances = [];

  let content = "";
  const contents = [];
  const setContent = (next) => {
    content = typeof next === "function" ? next(content) : next;
    contents.push(content);
  };
  // Stable, as the drawer's useState setters are.
  const setError = () => {};
  const api = {
    podLogs: async () => "one-shot tail",
    podLogsStreamUrl: (clusterId, namespace, name) => `ws://gateway/${clusterId}/${namespace}/${name}`,
    parsePodLogsStreamMessage: (raw) => JSON.parse(raw),
  };
  let logs;
  function Probe({ row }) {
    logs = usePodDrawerLogs({ api, clusterId: "cluster-a", pod: row, resource: "pods", tab: "logs", currentObjectKey: "pods/default/api", isDeploymentResource: false, setContent, setError });
    return null;
  }
  const view = mount(React.createElement(Probe, { row: pod() }));
  return {
    get content() {
      return content;
    },
    contents,
    get socket() {
      return FakeSocket.instances.at(-1);
    },
    sockets: FakeSocket.instances,
    follow() {
      React.act(() => logs.setLogsFollow(true));
    },
    rerender(row) {
      view.update(React.createElement(Probe, { row }));
    },
    act(callback) {
      React.act(callback);
    },
    advance(ms) {
      React.act(() => clock.advance(ms));
    },
    close() {
      view.unmount();
      domWindow.setTimeout = saved.setTimeout;
      domWindow.clearTimeout = saved.clearTimeout;
      globalThis.WebSocket = saved.WebSocket;
    },
  };
}

test("a table refresh does not restart the stream the tab is following", () => {
  const h = harness();
  try {
    h.follow();
    assert.equal(h.sockets.length, 1);
    h.act(() => h.socket.open());
    h.act(() => h.socket.receive({ type: "lines", lines: ["line 1", "line 2"] }));
    h.advance(100);
    assert.equal(h.content, "line 1\nline 2");

    // The list reloads: same pod, new object, a changed status among its fields.
    h.rerender(pod({ status: "Running", restarts: 0 }));
    h.rerender(pod({ status: "Running", restarts: 0 }));
    assert.equal(h.sockets.length, 1, "no new stream for the same pod");
    assert.equal(h.sockets[0].closedByClient, false, "and the running one is left alone");
    assert.equal(h.content, "line 1\nline 2");
  } finally {
    h.close();
  }
});

test("a reconnect keeps the lines on screen until the new tail replaces them", () => {
  const h = harness();
  try {
    h.follow();
    h.act(() => h.socket.open());
    h.act(() => h.socket.receive({ type: "lines", lines: ["old 1", "old 2"] }));
    h.advance(100);

    h.act(() => h.socket.drop());
    h.advance(LOG_STREAM_RETRY_DELAYS_MS[0]);
    assert.equal(h.sockets.length, 2, "a dropped stream is retried");
    h.act(() => h.socket.open());
    assert.ok(!h.contents.includes(""), "the tab is never blanked on the way");
    assert.equal(h.content, "old 1\nold 2");

    h.act(() => h.socket.receive({ type: "lines", lines: ["old 2", "new 3"] }));
    h.advance(100);
    assert.equal(h.content, "old 2\nnew 3", "the new stream's tail replaces the old lines, not appended to them");
  } finally {
    h.close();
  }
});

test("a finished stream stays finished, a failing one is retried further apart", () => {
  const h = harness();
  try {
    h.follow();
    h.act(() => h.socket.open());
    h.act(() => h.socket.receive({ type: "ended", exitCode: 1 }));
    h.act(() => h.socket.drop());
    h.advance(LOG_STREAM_RETRY_DELAYS_MS[1] - 1);
    assert.equal(h.sockets.length, 1, "after a failure the wait is longer than the first retry");
    h.advance(1);
    assert.equal(h.sockets.length, 2);

    // The container stopped: kubectl exits 0 and would do so again at once.
    h.act(() => h.socket.open());
    h.act(() => h.socket.receive({ type: "ended", exitCode: 0 }));
    h.act(() => h.socket.drop());
    h.advance(Math.max(...LOG_STREAM_RETRY_DELAYS_MS) * 2);
    assert.equal(h.sockets.length, 2, "no reconnect loop after the stream reached its end");
  } finally {
    h.close();
  }
});
