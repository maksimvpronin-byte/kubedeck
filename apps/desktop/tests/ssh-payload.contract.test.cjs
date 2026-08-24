// What the SSH websocket checks before a socket is opened: the shape of a
// connect message, the limits on every field, and the ssh command line the
// drawer shows back. All pure - no gateway, no fake client.
// Split out of node-ssh.contract.test.cjs; see docs/file-structure-refactor-plan.md.
const test = require("node:test");
const assert = require("node:assert/strict");

const sshPayload = require("../dist/main/backend/ssh/sshPayload.js");
const { buildSshCommandPreview, matchNodeSshWebSocket, normalizeSshConnectPayload } = require("../dist/main/backend/ssh/nodeSshWebSocket.js");
const { connectPayload } = require("./helpers/ssh.cjs");

/** The smallest connect message that passes, for tests about one field at a time. */
function connectMessage(extra = {}) {
  return { type: "connect", host: "10.0.0.5", username: "ops", authMethod: "agent", ...extra };
}

test("Node SSH route and command preview remain compatible", () => {
  assert.deepEqual(matchNodeSshWebSocket({ url: "/clusters/cluster-a/nodes/node-a/ssh" }), { clusterId: "cluster-a", name: "node-a" });
  const payload = normalizeSshConnectPayload(
    connectPayload({
      port: 2222,
      useJumpHost: true,
      jumpHost: "jump.example.test",
      jumpPort: 2200,
      jumpUsername: "jump-user",
      jumpAuthMethod: "password",
      jumpPassword: "jump-secret",
    }),
  );
  const preview = buildSshCommandPreview(payload);
  assert.equal(preview, "ssh -p 2222 -J jump-user@jump.example.test:2200 devops@10.0.0.10");
  assert.equal(preview.includes("secret-password"), false);
  assert.equal(preview.includes("jump-secret"), false);
  assert.throws(
    () => normalizeSshConnectPayload(connectPayload({ host: "bad host" })),
    (error) => error.code === "INVALID_SSH_HOST",
  );
});

test("an SSH connect payload is checked before anything is opened", () => {
  const payload = sshPayload.normalizeSshConnectPayload(connectMessage());
  assert.equal(payload.target.host, "10.0.0.5");
  assert.equal(payload.target.port, 22, "the default port is filled in");
  assert.equal(payload.target.username, "ops");
  assert.equal(payload.jump, null);

  // The first message has to be a connect, and it has to be an object.
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload({ type: "input" }),
    (error) => error.code === "INVALID_SSH_MESSAGE",
  );
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload("connect"),
    (error) => error.code === "INVALID_SSH_MESSAGE",
  );
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload([]),
    (error) => error.code === "INVALID_SSH_MESSAGE",
  );
});

test("a host, port, username or auth method that could not work is refused", () => {
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ host: "" })),
    (error) => error.code === "SSH_HOST_REQUIRED",
  );
  // A host is put on a command line, so a space or a shell character in it is
  // refused rather than quoted.
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ host: "node one" })),
    (error) => error.code === "INVALID_SSH_HOST",
  );
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ host: "node;rm -rf /" })),
    (error) => error.code === "INVALID_SSH_HOST",
  );
  // 2.20.10: a port that was given and cannot work is refused, including 0.
  // It used to read as "not set" - it is falsy - and became 22 without a word.
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ port: 0 })),
    (error) => error.code === "INVALID_SSH_PORT",
  );
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ port: -1 })),
    (error) => error.code === "INVALID_SSH_PORT",
  );
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ port: "ssh" })),
    (error) => error.code === "INVALID_SSH_PORT",
  );
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ port: 70000 })),
    (error) => error.code === "INVALID_SSH_PORT",
  );
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ port: 22.5 })),
    (error) => error.code === "INVALID_SSH_PORT",
  );
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ username: "" })),
    (error) => error.code === "SSH_USERNAME_REQUIRED",
  );
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ username: "ops user" })),
    (error) => error.code === "INVALID_SSH_USERNAME",
  );
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ authMethod: "kerberos" })),
    (error) => error.code === "INVALID_SSH_AUTH_METHOD",
  );
});

test("an auth method that needs a secret is refused without one", () => {
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ authMethod: "password" })),
    (error) => error.code === "SSH_PASSWORD_REQUIRED",
  );
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ authMethod: "privateKey" })),
    (error) => error.code === "SSH_PRIVATE_KEY_REQUIRED",
  );
  assert.doesNotThrow(() => sshPayload.normalizeSshConnectPayload(connectMessage({ authMethod: "password", password: "s3cret" })));
  assert.doesNotThrow(() => sshPayload.normalizeSshConnectPayload(connectMessage({ authMethod: "privateKey", keyPath: "~/.ssh/id_ed25519" })));
});

test("an oversized field is refused rather than carried into a session", () => {
  const huge = "x".repeat(200 * 1024);
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ authMethod: "password", password: huge })),
    (error) => error.code === "SSH_VALUE_TOO_LARGE",
  );
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ host: "y".repeat(2048) })),
    (error) => error.code === "SSH_VALUE_TOO_LARGE",
  );
});

test("a jump host inherits the target's user and is checked the same way", () => {
  const payload = sshPayload.normalizeSshConnectPayload(connectMessage({ useJumpHost: true, jumpHost: "bastion.internal", jumpPort: 2222 }));
  assert.equal(payload.jump.host, "bastion.internal");
  assert.equal(payload.jump.port, 2222);
  assert.equal(payload.jump.username, "ops", "a jump host with no user of its own borrows the target's");

  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ useJumpHost: true, jumpHost: "bad host" })),
    (error) => error.code === "INVALID_SSH_HOST",
  );
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ useJumpHost: true, jumpHost: "bastion", jumpAuthMethod: "password" })),
    (error) => error.code === "SSH_PASSWORD_REQUIRED",
  );
});

test("the size the client asks for is clamped, never trusted", () => {
  const tiny = sshPayload.normalizeSshConnectPayload(connectMessage({ rows: 1, cols: 1 }));
  assert.equal(tiny.rows, 5, "the shared PTY floor");
  assert.equal(tiny.cols, 20);

  const huge = sshPayload.normalizeSshConnectPayload(connectMessage({ rows: 9999, cols: 9999 }));
  assert.equal(huge.rows, 200);
  assert.equal(huge.cols, 500);

  const absent = sshPayload.normalizeSshConnectPayload(connectMessage());
  assert.equal(absent.rows, 24, "the shared default, which pod exec and SSH now share");
  assert.equal(absent.cols, 100);
});

test("the command preview shows the connection the user actually asked for", () => {
  const preview = (extra) => sshPayload.buildSshCommandPreview(sshPayload.normalizeSshConnectPayload(connectMessage(extra)));

  assert.equal(preview({}), "ssh ops@10.0.0.5", "a default port is not repeated back");
  assert.equal(preview({ port: 2200 }), "ssh -p 2200 ops@10.0.0.5");
  assert.equal(preview({ authMethod: "privateKey", keyPath: "/home/ops/.ssh/id_ed25519" }), "ssh -i /home/ops/.ssh/id_ed25519 ops@10.0.0.5");
  assert.equal(preview({ authMethod: "privateKey", keyPath: "/home/ops/my key" }), 'ssh -i "/home/ops/my key" ops@10.0.0.5', "a path with a space is quoted");
  assert.equal(preview({ useJumpHost: true, jumpHost: "bastion" }), "ssh -J ops@bastion ops@10.0.0.5");
  assert.equal(preview({ useJumpHost: true, jumpHost: "bastion", jumpPort: 2222 }), "ssh -J ops@bastion:2222 ops@10.0.0.5");

  // The preview is shown to the user; a password must never reach it.
  assert.doesNotMatch(preview({ authMethod: "password", password: "s3cret" }), /s3cret/);
});

test("an absent port is 22, and that is a different case from a port that cannot work", () => {
  // The SSH form fills an empty field in before sending, so in practice the
  // backend sees a number - but a message that omits the port is still valid.
  for (const absent of [undefined, null, ""]) {
    const payload = sshPayload.normalizeSshConnectPayload({ type: "connect", host: "10.0.0.5", username: "ops", authMethod: "agent", port: absent });
    assert.equal(payload.target.port, 22);
  }
  const omitted = sshPayload.normalizeSshConnectPayload({ type: "connect", host: "10.0.0.5", username: "ops", authMethod: "agent" });
  assert.equal(omitted.target.port, 22);

  // A jump host omitting its port gets the same default, and a jump port that
  // cannot work is refused just like the target's.
  const jump = sshPayload.normalizeSshConnectPayload(connectMessage({ useJumpHost: true, jumpHost: "bastion" }));
  assert.equal(jump.jump.port, 22);
  assert.throws(
    () => sshPayload.normalizeSshConnectPayload(connectMessage({ useJumpHost: true, jumpHost: "bastion", jumpPort: 0 })),
    (error) => error.code === "INVALID_SSH_PORT",
  );

  // The edges stay usable.
  assert.equal(sshPayload.normalizeSshConnectPayload(connectMessage({ port: 1 })).target.port, 1);
  assert.equal(sshPayload.normalizeSshConnectPayload(connectMessage({ port: 65535 })).target.port, 65535);
  assert.equal(sshPayload.normalizeSshConnectPayload(connectMessage({ port: "2200" })).target.port, 2200, "a port arrives from a text field as a string");
});
