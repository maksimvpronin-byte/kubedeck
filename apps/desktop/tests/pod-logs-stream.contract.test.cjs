// Following a pod's logs is a stream, not a poll.
//
// Until 2.23.0 the drawer re-ran `kubectl logs --tail=500` every three seconds
// and transferred the whole tail again, whatever had changed. These tests cover
// the socket that replaced it: one long-lived kubectl per open tab, lines as
// they are written, and a process that stops when nobody is reading.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { WebSocket } = require("ws");

const { startGateway } = require("../dist/main/backend/gateway.js");
const { matchPodLogsWebSocket, podLogsArgs } = require("../dist/main/backend/logs/podLogsWebSocket.js");

const TOKEN = "pod-logs-stream-contract-token";
const ORIGIN = "http://127.0.0.1:5173";

function fakeChild(state) {
  const child = new EventEmitter();
  child.pid = Math.floor(Math.random() * 100000) + 1000;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.kill = () => {
    if (child.killed) return true;
    child.killed = true;
    state.kills += 1;
    process.nextTick(() => child.emit("close", null, "SIGTERM"));
    return true;
  };
  return child;
}

function logsSpawn(state) {
  return (_executable, args) => {
    const child = fakeChild(state);
    if (args.includes("logs")) {
      state.commands.push(args);
      state.children.push(child);
      return child;
    }
    // Everything else - `cluster-info`, the namespace list that opening a
    // cluster needs - answers immediately.
    process.nextTick(() => {
      child.stdout.write(args.includes("namespaces") ? JSON.stringify({ items: [{ metadata: { name: "default" } }] }) : "ok");
      child.stdout.end();
      child.stderr.end();
      child.exitCode = 0;
      child.emit("close", 0, null);
    });
    return child;
  };
}

function streamUrl(baseUrl, clusterId, options = {}) {
  const url = new URL(baseUrl);
  url.protocol = "ws:";
  url.pathname = `/clusters/${clusterId}/pods/default/api-server/logs/stream`;
  for (const [key, value] of Object.entries(options)) url.searchParams.set(key, String(value));
  url.searchParams.set("token", TOKEN);
  return url.toString();
}

function collect(socket) {
  const messages = [];
  socket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  return messages;
}

function waitFor(predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      const value = predicate();
      if (value) return resolve(value);
      if (Date.now() - startedAt > timeoutMs) return reject(new Error("condition was not reached in time"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

async function openCluster(t) {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-logs-stream-"));
  const source = path.join(appDataRoot, "source.yaml");
  fs.writeFileSync(source, "apiVersion: v1\n", "utf8");
  const state = { commands: [], children: [], kills: 0 };

  const gateway = await startGateway({
    sessionToken: TOKEN,
    appDataRoot,
    appVersion: "2.23.0",
    log: () => {},
    spawnKubectl: logsSpawn(state),
  });
  t.after(async () => {
    await gateway.close();
    fs.rmSync(appDataRoot, { recursive: true, force: true });
  });

  const headers = { "Content-Type": "application/json", "X-KubeDeck-Token": TOKEN };
  const imported = await fetch(`${gateway.baseUrl}/clusters/import`, { method: "POST", headers, body: JSON.stringify({ sourcePath: source, displayName: "logs" }) });
  const cluster = await imported.json();
  await fetch(`${gateway.baseUrl}/clusters/${cluster.id}/open`, { method: "POST", headers });
  return { gateway, cluster, state, headers };
}

test("the log stream route builds the kubectl command the tab asked for", () => {
  const target = matchPodLogsWebSocket({ url: "/clusters/c1/pods/tools/api/logs/stream?container=app&tail=120&timestamps=true&previous=true" });
  assert.deepEqual(target, { clusterId: "c1", namespace: "tools", pod: "api", container: "app", tail: 120, timestamps: true, previous: true });
  assert.deepEqual(podLogsArgs(target), ["logs", "api", "-n", "tools", "-f", "--tail=120", "-c", "app", "--previous", "--timestamps"]);

  // Defaults, and a tail nobody should be able to ask for.
  const plain = matchPodLogsWebSocket({ url: "/clusters/c1/pods/tools/api/logs/stream?tail=999999" });
  assert.equal(plain.tail, 500);
  assert.deepEqual(podLogsArgs(plain), ["logs", "api", "-n", "tools", "-f", "--tail=500"]);

  assert.equal(matchPodLogsWebSocket({ url: "/clusters/c1/pods/tools/api/logs" }), null, "the bounded HTTP route is not this one");
});

test("one socket carries one kubectl, and the lines it writes arrive in batches", async (t) => {
  const { gateway, cluster, state } = await openCluster(t);

  const socket = new WebSocket(streamUrl(gateway.baseUrl, cluster.id, { container: "app", tail: 200 }), { origin: ORIGIN });
  const messages = collect(socket);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  const connected = await waitFor(() => messages.find((message) => message.type === "status"));
  assert.equal(connected.data, "connected");
  assert.equal(connected.pod, "api-server");
  assert.equal(state.commands.length, 1, "exactly one kubectl for the open tab");
  assert.match(state.commands[0].join(" "), /logs api-server -n default -f --tail=200 -c app$/, "it follows the pod, the container and the tail the tab asked for");

  const child = state.children[0];
  child.stdout.write("first line\nsecond line\n");
  const batch = await waitFor(() => messages.find((message) => message.type === "lines"));
  assert.deepEqual(batch.lines, ["first line", "second line"]);

  // A second burst arrives as its own batch; nothing is re-sent.
  child.stdout.write("third line\n");
  const second = await waitFor(() => messages.filter((message) => message.type === "lines")[1]);
  assert.deepEqual(second.lines, ["third line"]);
  assert.equal(state.commands.length, 1, "and still one kubectl - nothing is polled");

  // kubectl writing to stderr is reported without ending the stream.
  child.stderr.write("unable to retrieve container logs\n");
  const error = await waitFor(() => messages.find((message) => message.type === "error"));
  assert.match(error.message, /unable to retrieve container logs/);

  socket.close();
  await waitFor(() => state.kills === 1);
  assert.equal(state.kills, 1, "closing the tab stops the kubectl behind it");
});

test("a pod that stops logging ends the stream instead of leaving it open", async (t) => {
  const { gateway, cluster, state } = await openCluster(t);
  const socket = new WebSocket(streamUrl(gateway.baseUrl, cluster.id), { origin: ORIGIN });
  const messages = collect(socket);
  await new Promise((resolve) => socket.once("open", resolve));
  await waitFor(() => messages.find((message) => message.type === "status"));

  const child = state.children[0];
  child.stdout.write("last line\n");
  child.stdout.end();
  child.exitCode = 0;
  child.emit("close", 0, null);

  const ended = await waitFor(() => messages.find((message) => message.type === "ended"));
  assert.equal(ended.exitCode, 0);
  // Whatever was buffered goes out before the end.
  assert.ok(messages.some((message) => message.type === "lines" && message.lines.includes("last line")));
  await waitFor(() => socket.readyState === WebSocket.CLOSED);
});

test("disconnecting the cluster closes the streams that were reading it", async (t) => {
  const { gateway, cluster, state, headers } = await openCluster(t);
  const socket = new WebSocket(streamUrl(gateway.baseUrl, cluster.id), { origin: ORIGIN });
  const messages = collect(socket);
  await new Promise((resolve) => socket.once("open", resolve));
  await waitFor(() => messages.find((message) => message.type === "status"));

  await fetch(`${gateway.baseUrl}/clusters/${cluster.id}/disconnect`, { method: "POST", headers, body: JSON.stringify({ confirmed: true }) });
  await waitFor(() => socket.readyState === WebSocket.CLOSED);
  await waitFor(() => state.kills >= 1);

  // And a new stream is refused while the cluster stays disconnected. The
  // gateway refuses an upgrade the way it always has - by completing the
  // handshake and closing with a policy violation, so the client hears why.
  const spawnsBefore = state.commands.length;
  const refused = new WebSocket(streamUrl(gateway.baseUrl, cluster.id), { origin: ORIGIN });
  const closeCode = await new Promise((resolve) => {
    refused.once("close", (code) => resolve(code));
    refused.once("error", () => resolve(-1));
  });
  assert.equal(closeCode, 1008, "a disconnected cluster does not get a new log stream");
  assert.equal(state.commands.length, spawnsBefore, "and no kubectl is started for it");
});
