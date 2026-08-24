// The Node SSH session itself: what travels over the websocket once the host
// key is settled - output, input, resize, a jump host, audit redaction and
// shutdown. The host key handshake is in node-ssh-host-keys, and the checks on
// the connect message are in ssh-payload.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { WebSocket } = require("ws");

const { TOKEN, autoTrustHostKeys, connectPayload, createGateway, createSshState, sshUrl, waitForClose, waitForMessage } = require("./helpers/ssh.cjs");

test("Node SSH password session supports output, input, resize, audit redaction, and shutdown", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-node-ssh-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = new WebSocket(sshUrl(gateway.baseUrl), {
    origin: "http://127.0.0.1:5173",
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  autoTrustHostKeys(socket);
  const connectedPromise = waitForMessage(socket, (message) => message.type === "status" && message.data === "Connected");
  const outputPromise = waitForMessage(socket, (message) => message.type === "output");
  socket.send(JSON.stringify(connectPayload()));
  await connectedPromise;
  const output = await outputPromise;
  assert.match(output.data, /ssh-ready/);

  socket.send(JSON.stringify({ type: "input", data: "whoami\r" }));
  socket.send(JSON.stringify({ type: "resize", cols: 160, rows: 55 }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(state.inputs, ["whoami\r"]);
  assert.deepEqual(state.resizes, [{ rows: 55, cols: 160, height: 0, width: 0 }]);
  assert.equal(state.configs[0].host, "10.0.0.10");
  assert.equal(state.configs[0].password, "secret-password");
  assert.deepEqual(state.windows[0], {
    term: "xterm-256color",
    cols: 120,
    rows: 40,
    height: 0,
    width: 0,
  });

  const response = await fetch(`${gateway.baseUrl}/audit?limit=100`, {
    headers: { "X-KubeDeck-Token": TOKEN },
  });
  const auditText = JSON.stringify(await response.json());
  assert.equal(auditText.includes("secret-password"), false);
  assert.equal(auditText.includes("whoami"), false);
  assert.match(auditText, /node\.ssh/);

  const closed = waitForClose(socket);
  await gateway.close();
  await closed;
  assert.ok(state.clientEnds >= 1);
  assert.ok(state.clientDestroys >= 1);
});

test("Node SSH private key through jump host opens a forwarded target connection", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-node-ssh-jump-"));
  const keyPath = path.join(appDataRoot, "id_test");
  fs.writeFileSync(keyPath, "FAKE-PRIVATE-KEY", "utf8");
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = new WebSocket(sshUrl(gateway.baseUrl, "cluster-b", "node-b"), {
    origin: "file://",
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  autoTrustHostKeys(socket);
  const connected = waitForMessage(socket, (message) => message.type === "status" && message.data === "Connected");
  socket.send(
    JSON.stringify(
      connectPayload({
        authMethod: "privateKey",
        password: "",
        keyPath,
        keyPassphrase: "target-passphrase",
        useJumpHost: true,
        jumpHost: "jump.example.test",
        jumpPort: 2200,
        jumpUsername: "jump-user",
        jumpAuthMethod: "password",
        jumpPassword: "jump-secret",
      }),
    ),
  );
  await connected;
  assert.equal(state.configs.length, 2);
  assert.equal(state.configs[0].host, "jump.example.test");
  assert.equal(state.configs[0].password, "jump-secret");
  assert.equal(state.configs[1].host, "10.0.0.10");
  assert.equal(Buffer.isBuffer(state.configs[1].privateKey), true);
  assert.equal(state.configs[1].passphrase, "target-passphrase");
  assert.ok(state.configs[1].sock);
  assert.deepEqual(state.forwardOut, [
    {
      sourceHost: "127.0.0.1",
      sourcePort: 0,
      destinationHost: "10.0.0.10",
      destinationPort: 22,
    },
  ]);
  socket.send(JSON.stringify({ type: "close" }));
  await waitForClose(socket);
});

test("Node SSH rejects unauthorized websocket and redacts failed authentication", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-node-ssh-fail-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  state.failHost = "10.0.0.99";
  const gateway = await createGateway(t, state, appDataRoot);

  const unauthorized = new WebSocket(sshUrl(gateway.baseUrl, "cluster-a", "node-a", "wrong"), {
    origin: "http://127.0.0.1:5173",
  });
  await waitForClose(unauthorized);

  const socket = new WebSocket(sshUrl(gateway.baseUrl), {
    origin: "http://127.0.0.1:5173",
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  autoTrustHostKeys(socket);
  const errorPromise = waitForMessage(socket, (message) => message.type === "error");
  socket.send(JSON.stringify(connectPayload({ host: "10.0.0.99" })));
  const message = await errorPromise;
  assert.equal(message.data.includes("secret-password"), false);
  assert.match(message.data, /REDACTED/);
  await waitForClose(socket);
});
