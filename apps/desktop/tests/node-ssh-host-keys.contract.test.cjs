// Host key verification: the prompt, the decisions, a changed key, the jump
// host checked separately, and the store the accepted fingerprints go to.
// Split out of node-ssh.contract.test.cjs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { TOKEN, autoTrustHostKeys, connectPayload, createGateway, createSshState, expectedFingerprint, knownHostsPath, openSshSocket, waitForClose, waitForMessage } = require("./helpers/ssh.cjs");

test("Node SSH asks before trusting an unknown host key and remembers the accepted fingerprint", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-new-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = await openSshSocket(gateway);

  const promptPromise = waitForMessage(socket, (message) => message.type === "host-key-request");
  socket.send(JSON.stringify(connectPayload()));
  const prompt = await promptPromise;

  assert.equal(prompt.data.role, "target");
  assert.equal(prompt.data.host, "10.0.0.10");
  assert.equal(prompt.data.port, 22);
  assert.equal(prompt.data.algorithm, "ssh-ed25519");
  assert.equal(prompt.data.fingerprint, expectedFingerprint("key-for-10.0.0.10"));
  // Nothing may be authenticated while the user is still deciding.
  assert.deepEqual(state.authenticated, []);
  assert.deepEqual(state.windows, []);

  const connected = waitForMessage(socket, (message) => message.type === "status" && message.data === "Connected");
  socket.send(JSON.stringify({ type: "host-key-decision", decision: "trust" }));
  await connected;
  assert.deepEqual(state.authenticated, ["10.0.0.10"]);
  assert.deepEqual(state.unverifiedHosts, []);

  const stored = JSON.parse(fs.readFileSync(knownHostsPath(appDataRoot), "utf8"));
  assert.equal(stored.version, 1);
  assert.equal(stored.hosts["10.0.0.10:22"].fingerprint, expectedFingerprint("key-for-10.0.0.10"));
  assert.equal(stored.hosts["10.0.0.10:22"].algorithm, "ssh-ed25519");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(knownHostsPath(appDataRoot)).mode & 0o777, 0o600);
  }

  const audit = await (await fetch(`${gateway.baseUrl}/audit?limit=100`, { headers: { "X-KubeDeck-Token": TOKEN } })).json();
  assert.ok(audit.items.some((item) => item.status === "host-key-trusted"));

  socket.send(JSON.stringify({ type: "close" }));
  await waitForClose(socket);
});

test("Node SSH keeps waiting for the host key decision while the terminal reports a resize", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-resize-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = await openSshSocket(gateway);

  const promptPromise = waitForMessage(socket, (message) => message.type === "host-key-request");
  socket.send(JSON.stringify(connectPayload()));
  await promptPromise;

  // xterm fits itself as soon as the confirmation changes the panel layout, so
  // the decision is not necessarily the next message on the socket.
  socket.send(JSON.stringify({ type: "resize", cols: 132, rows: 43 }));
  socket.send(JSON.stringify({ type: "input", data: "ignored\r" }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(state.authenticated, []);
  assert.deepEqual(state.inputs, []);

  const connected = waitForMessage(socket, (message) => message.type === "status" && message.data === "Connected");
  socket.send(JSON.stringify({ type: "host-key-decision", decision: "trust" }));
  await connected;
  assert.deepEqual(state.authenticated, ["10.0.0.10"]);

  socket.send(JSON.stringify({ type: "close" }));
  await waitForClose(socket);
});

test("Node SSH treats an explicit close during the host key prompt as a refusal", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-close-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = await openSshSocket(gateway);

  const promptPromise = waitForMessage(socket, (message) => message.type === "host-key-request");
  socket.send(JSON.stringify(connectPayload()));
  await promptPromise;

  const errorPromise = waitForMessage(socket, (message) => message.type === "error");
  socket.send(JSON.stringify({ type: "close" }));
  const error = await errorPromise;

  assert.equal(error.code, "SSH_HOST_KEY_REJECTED");
  assert.deepEqual(state.authenticated, []);
  assert.equal(fs.existsSync(knownHostsPath(appDataRoot)), false);
  await waitForClose(socket);
});

test("Node SSH refuses the session when the user rejects an unknown host key", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-reject-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = await openSshSocket(gateway);
  autoTrustHostKeys(socket, "reject");

  const errorPromise = waitForMessage(socket, (message) => message.type === "error");
  socket.send(JSON.stringify(connectPayload()));
  const error = await errorPromise;

  assert.equal(error.code, "SSH_HOST_KEY_REJECTED");
  assert.equal(error.data.includes("secret-password"), false);
  assert.deepEqual(state.authenticated, []);
  assert.deepEqual(state.windows, []);
  assert.equal(fs.existsSync(knownHostsPath(appDataRoot)), false);
  await waitForClose(socket);
});

test("Node SSH refuses a changed host key without offering to trust it", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-mismatch-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const remembered = { version: 1, hosts: { "10.0.0.10:22": { algorithm: "ssh-ed25519", fingerprint: expectedFingerprint("old-key"), rememberedAt: "2026-01-01T00:00:00.000Z" } } };
  fs.writeFileSync(knownHostsPath(appDataRoot), `${JSON.stringify(remembered, null, 2)}\n`, "utf8");

  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = await openSshSocket(gateway);
  let prompted = false;
  socket.on("message", (data) => {
    if (JSON.parse(data.toString()).type === "host-key-request") prompted = true;
  });

  const errorPromise = waitForMessage(socket, (message) => message.type === "error");
  socket.send(JSON.stringify(connectPayload()));
  const error = await errorPromise;

  assert.equal(error.code, "SSH_HOST_KEY_MISMATCH");
  assert.equal(prompted, false);
  assert.deepEqual(state.authenticated, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(knownHostsPath(appDataRoot), "utf8")), remembered);

  const audit = await (await fetch(`${gateway.baseUrl}/audit?limit=100`, { headers: { "X-KubeDeck-Token": TOKEN } })).json();
  assert.ok(audit.items.some((item) => item.status === "host-key-mismatch"));
  await waitForClose(socket);
});

test("Node SSH stops waiting for a host key decision after the configured timeout", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-timeout-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot, { sshHostKeyDecisionTimeoutMs: 60 });
  const socket = await openSshSocket(gateway);

  const errorPromise = waitForMessage(socket, (message) => message.type === "error");
  socket.send(JSON.stringify(connectPayload()));
  const error = await errorPromise;

  assert.equal(error.code, "SSH_HOST_KEY_TIMEOUT");
  assert.deepEqual(state.authenticated, []);
  await waitForClose(socket);
});

test("Node SSH verifies the jump host separately from the target", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-jump-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const state = createSshState();
  const gateway = await createGateway(t, state, appDataRoot);
  const socket = await openSshSocket(gateway, "cluster-b", "node-b");

  const prompts = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (message.type !== "host-key-request") return;
    prompts.push(message.data);
    socket.send(JSON.stringify({ type: "host-key-decision", decision: "trust" }));
  });

  const connected = waitForMessage(socket, (message) => message.type === "status" && message.data === "Connected");
  socket.send(JSON.stringify(connectPayload({ useJumpHost: true, jumpHost: "jump.example.test", jumpPort: 2200, jumpUsername: "jump-user", jumpAuthMethod: "password", jumpPassword: "jump-secret" })));
  await connected;

  assert.equal(prompts.length, 2);
  assert.deepEqual(
    prompts.map((prompt) => [prompt.role, prompt.host, prompt.port]),
    [
      ["jump", "jump.example.test", 2200],
      ["target", "10.0.0.10", 22],
    ],
  );
  assert.deepEqual(state.unverifiedHosts, []);

  const stored = JSON.parse(fs.readFileSync(knownHostsPath(appDataRoot), "utf8"));
  assert.deepEqual(Object.keys(stored.hosts).sort(), ["10.0.0.10:22", "jump.example.test:2200"]);

  socket.send(JSON.stringify({ type: "close" }));
  await waitForClose(socket);
});

test("Known SSH host keys can be listed and forgotten, but never added over HTTP", async (t) => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-ssh-hostkey-api-"));
  t.after(() => fs.rmSync(appDataRoot, { recursive: true, force: true }));
  const remembered = {
    version: 1,
    hosts: {
      "10.0.0.10:22": { algorithm: "ssh-ed25519", fingerprint: expectedFingerprint("key-a"), rememberedAt: "2026-01-01T00:00:00.000Z" },
      "jump.example.test:2200": { algorithm: "ssh-rsa", fingerprint: expectedFingerprint("key-b"), rememberedAt: "2026-01-02T00:00:00.000Z" },
    },
  };
  fs.writeFileSync(knownHostsPath(appDataRoot), `${JSON.stringify(remembered, null, 2)}\n`, "utf8");
  const gateway = await createGateway(t, createSshState(), appDataRoot);
  const headers = { "X-KubeDeck-Token": TOKEN, "Content-Type": "application/json" };

  const listed = await (await fetch(`${gateway.baseUrl}/ssh/known-hosts`, { headers })).json();
  assert.deepEqual(
    listed.items.map((item) => `${item.host}:${item.port}`),
    ["10.0.0.10:22", "jump.example.test:2200"],
  );

  const unauthorized = await fetch(`${gateway.baseUrl}/ssh/known-hosts`);
  assert.equal(unauthorized.status, 401);

  const created = await fetch(`${gateway.baseUrl}/ssh/known-hosts`, { method: "POST", headers, body: JSON.stringify({ host: "evil.example.test", port: 22, fingerprint: "SHA256:whatever" }) });
  assert.equal(created.status, 405);

  const removed = await (await fetch(`${gateway.baseUrl}/ssh/known-hosts`, { method: "DELETE", headers, body: JSON.stringify({ host: "10.0.0.10", port: 22 }) })).json();
  assert.equal(removed.removed, true);

  const remaining = await (await fetch(`${gateway.baseUrl}/ssh/known-hosts`, { headers })).json();
  assert.deepEqual(
    remaining.items.map((item) => item.host),
    ["jump.example.test"],
  );

  const invalid = await fetch(`${gateway.baseUrl}/ssh/known-hosts`, { method: "DELETE", headers, body: JSON.stringify({ host: "", port: 22 }) });
  assert.equal(invalid.status, 422);
});
