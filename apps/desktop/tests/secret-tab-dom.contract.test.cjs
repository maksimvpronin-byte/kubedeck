// The Secret tab, revealed and edited.
//
// This replaces a grep contract that read SecretTab.tsx for seven strings -
// among them `The decoded value is not shown in this confirmation.` and the
// absence of `<code>{draft}`. Those say the file contains a sentence and does
// not contain one spelling of one JSX expression. The promise underneath is that
// a decoded Secret never appears in the confirmation dialog, and the only honest
// way to check it is to reveal a real value, open the dialog, and read
// everything the dialog renders.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window } = require("./helpers/dom.cjs");

const { SecretTab } = loadComponent("components/SecretTab.tsx", {
  "../api": { ApiClient: class {} },
});

const VALUE = "postgres://kubedeck:hunter2@db.internal:5432/app";

function secretApi(overrides = {}) {
  const calls = [];
  const answers = {
    secretKeys: async () => ({
      type: "Opaque",
      immutable: false,
      revealTimeoutSeconds: 30,
      keys: [
        { key: "DATABASE_URL", validBase64: true, decodedBytes: VALUE.length, binary: false },
        { key: "keystore.p12", validBase64: true, decodedBytes: 2048, binary: true },
      ],
    }),
    revealSecret: async (_cluster, _ns, _name, key) => ({ key, value: key === "DATABASE_URL" ? VALUE : "�� binary �", binary: key !== "DATABASE_URL", revealTimeoutSeconds: 30 }),
    updateSecret: async () => ({ ok: true }),
    auditSecretCopy: async () => ({ ok: true }),
    ...overrides,
  };
  const api = new Proxy(
    {},
    {
      get(_target, name) {
        if (typeof name !== "string") return undefined;
        return (...args) => {
          calls.push({ name, args });
          const answer = answers[name];
          if (!answer) throw new Error(`the tab called api.${name}, which this test did not expect`);
          return answer(...args);
        };
      },
    },
  );
  return { api, calls };
}

// The tab loads its keys in an effect, so mounting has to be awaited.
async function secretTab(t, overrides = {}) {
  const { api, calls } = secretApi(overrides);
  let view;
  await React.act(async () => {
    view = mount(React.createElement(SecretTab, { api, clusterId: "cluster-a", row: { name: "app-secrets", namespace: "default" }, copyLabel: "Copy", t: (key) => key }));
  });
  t.after(() => view.unmount());

  const cardFor = (key) => view.all(".secret-key-card").find((card) => card.querySelector("strong")?.textContent === key);
  const buttonIn = (root, label) => [...root.querySelectorAll("button")].find((button) => button.textContent.trim().startsWith(label));

  return {
    view,
    calls,
    api,
    card: cardFor,
    reveal: async (key) => {
      await React.act(async () => buttonIn(cardFor(key), "Reveal").dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    },
    press: async (root, label) => {
      await React.act(async () => buttonIn(root, label).dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    },
    textarea: (key) => cardFor(key).querySelector("textarea"),
    dialog: () => view.first('[role="dialog"]'),
  };
}

const type = async (input, value) => {
  await React.act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};

test("a Secret shows its keys and none of its values until asked", async (t) => {
  const s = await secretTab(t);

  assert.deepEqual(
    s.view.all(".secret-key-card strong").map((node) => node.textContent),
    ["DATABASE_URL", "keystore.p12"],
  );
  assert.equal(s.view.all(".secret-value-placeholder").length, 2);
  assert.ok(!s.view.container.textContent.includes("hunter2"), "no value may be on screen before it is revealed");
  assert.ok(!s.calls.some((call) => call.name === "revealSecret"), "nothing may be decoded until the reader asks");
});

test("revealing a text value opens it for editing straight away", async (t) => {
  // There is no separate Edit button on purpose: a revealed value is already
  // the thing you would be editing, and a second click to reach it only means
  // the value sits on screen for longer.
  const s = await secretTab(t);
  await s.reveal("DATABASE_URL");

  assert.equal(s.textarea("DATABASE_URL").value, VALUE);
  assert.ok(!s.view.container.textContent.includes("Edit"), "a separate Edit step would keep the value on screen longer");
});

test("a binary value is shown but never opened for editing", async (t) => {
  const s = await secretTab(t);
  await s.reveal("keystore.p12");

  assert.ok(!s.textarea("keystore.p12"), "binary data must not be editable as text");
  assert.ok(s.card("keystore.p12").querySelector("pre"), "it is shown read-only instead");
});

test("an immutable Secret is revealed but never opened for editing", async (t) => {
  const s = await secretTab(t, {
    secretKeys: async () => ({ type: "Opaque", immutable: true, revealTimeoutSeconds: 30, keys: [{ key: "DATABASE_URL", validBase64: true, decodedBytes: 10, binary: false }] }),
  });
  await s.reveal("DATABASE_URL");

  assert.ok(!s.textarea("DATABASE_URL"), "the API would refuse the write, so the field must not invite it");
});

test("saving asks in an in-app dialog, and the dialog never shows the value", async (t) => {
  // The point of the whole contract. A native window.confirm cannot be themed
  // and cannot be read from a test, and whatever the dialog does show must not
  // be the decoded Secret.
  const s = await secretTab(t);
  await s.reveal("DATABASE_URL");
  await type(s.textarea("DATABASE_URL"), "postgres://kubedeck:rotated@db.internal:5432/app");
  await s.press(s.card("DATABASE_URL"), "Save");

  const dialog = s.dialog();
  assert.ok(dialog, "an in-app dialog must open");
  assert.equal(dialog.getAttribute("aria-modal"), "true");

  const shown = dialog.textContent;
  assert.ok(!shown.includes("hunter2"), "the old value is in the confirmation");
  assert.ok(!shown.includes("rotated"), "the new value is in the confirmation");
  // What it does show is enough to know what is about to change.
  assert.ok(shown.includes("cluster-a"), "the dialog must name what is being changed");
  assert.ok(shown.includes("default/app-secrets"), "the dialog must name the Secret");
  assert.ok(shown.includes("DATABASE_URL"), "the dialog must name the key");

  assert.ok(!s.calls.some((call) => call.name === "updateSecret"), "nothing may be written before the reader confirms");
});

test("confirming writes the draft, cancelling writes nothing", async (t) => {
  const s = await secretTab(t);
  await s.reveal("DATABASE_URL");
  await type(s.textarea("DATABASE_URL"), "rotated-value");

  await s.press(s.card("DATABASE_URL"), "Save");
  await s.press(s.dialog(), "Cancel");
  assert.ok(!s.dialog(), "cancelling closes the dialog");
  assert.ok(!s.calls.some((call) => call.name === "updateSecret"));

  await s.press(s.card("DATABASE_URL"), "Save");
  await s.press(s.dialog(), "Confirm");

  const write = s.calls.find((call) => call.name === "updateSecret");
  assert.ok(write, "confirming must write");
  assert.deepEqual(write.args, ["cluster-a", "default", "app-secrets", "DATABASE_URL", "rotated-value"]);
});

test("Escape closes the confirmation without writing", async (t) => {
  const s = await secretTab(t);
  await s.reveal("DATABASE_URL");
  await type(s.textarea("DATABASE_URL"), "rotated-value");
  await s.press(s.card("DATABASE_URL"), "Save");
  assert.ok(s.dialog());

  await React.act(async () => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

  assert.ok(!s.dialog());
  assert.ok(!s.calls.some((call) => call.name === "updateSecret"));
});

test("hiding a value takes it off the screen along with the draft", async (t) => {
  const s = await secretTab(t);
  await s.reveal("DATABASE_URL");
  assert.ok(s.view.container.textContent.includes("hunter2"));

  await s.press(s.card("DATABASE_URL"), "Hide");

  assert.ok(!s.view.container.textContent.includes("hunter2"), "hiding must remove the value from the document");
  assert.ok(!s.textarea("DATABASE_URL"), "and the draft with it");
});

test("a revealed value hides itself when its time runs out", async (t) => {
  // The tab promises this in the warning it renders, and the timeout comes from
  // the server. A fifth of a second here rather than the thirty the API sends.
  const s = await secretTab(t, {
    secretKeys: async () => ({ type: "Opaque", immutable: false, revealTimeoutSeconds: 0.2, keys: [{ key: "DATABASE_URL", validBase64: true, decodedBytes: 10, binary: false }] }),
    revealSecret: async (_cluster, _ns, _name, key) => ({ key, value: VALUE, binary: false, revealTimeoutSeconds: 0.2 }),
  });
  await s.reveal("DATABASE_URL");
  assert.ok(s.view.container.textContent.includes("hunter2"));

  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

  assert.ok(!s.view.container.textContent.includes("hunter2"), "the value must hide itself without being asked");
});

test("copying a value is written to the audit log", async (t) => {
  const s = await secretTab(t);
  await s.reveal("DATABASE_URL");
  await s.press(s.card("DATABASE_URL"), "Copy");

  const audited = s.calls.find((call) => call.name === "auditSecretCopy");
  assert.ok(audited, "a copy that is not audited is a copy nobody can account for");
  assert.deepEqual(audited.args, ["cluster-a", "default", "app-secrets", "DATABASE_URL"]);
  assert.ok(!audited.args.includes(VALUE), "the audit record names the key, never the value");
});

test("auto-hide takes the confirmation dialog down with the value", async (t) => {
  // The dangerous case. If the value hides itself while the confirmation is
  // open, a dialog left standing would let the reader confirm a write of a
  // draft that is no longer on screen anywhere.
  const s = await secretTab(t, {
    secretKeys: async () => ({ type: "Opaque", immutable: false, revealTimeoutSeconds: 0.2, keys: [{ key: "DATABASE_URL", validBase64: true, decodedBytes: 10, binary: false }] }),
    revealSecret: async (_cluster, _ns, _name, key) => ({ key, value: VALUE, binary: false, revealTimeoutSeconds: 0.2 }),
  });
  await s.reveal("DATABASE_URL");
  await type(s.textarea("DATABASE_URL"), "rotated-value");
  await s.press(s.card("DATABASE_URL"), "Save");
  assert.ok(s.dialog(), "the confirmation is open when the clock runs out");

  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

  assert.ok(!s.dialog(), "the confirmation must close with the value it was about to write");
  assert.ok(!s.calls.some((call) => call.name === "updateSecret"));
});
