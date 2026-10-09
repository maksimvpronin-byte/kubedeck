// The Secret tab: values shown as base64 and ready to edit, decoded on request,
// saved at once.
//
// Each value is on screen as the manifest holds it - the YAML tab shows the
// same base64 - so nothing waits behind a Reveal button or hides itself on a
// timer. Decoding to text is what the audit log records. Save writes straight
// away, without a confirmation, and an edit nobody saved is dropped without a
// question when the Secret is left.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window } = require("./helpers/dom.cjs");
const { loadTypeScript } = require("./helpers/renderer.cjs");

const { SecretTab } = loadComponent("components/SecretTab.tsx", {
  "../api": { ApiClient: class {}, ApiError: class extends Error {} },
});
const codec = loadTypeScript("utils/secretCodec.ts");

// The English dictionary, so buttons are found by the words on them and a key
// missing from it shows up as the key.
const EN = require("../src/renderer/locales/en.json");
const translate = (key) => EN[key] ?? key;

const VALUE = "postgres://kubedeck:hunter2@db.internal:5432/app";
const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
const BINARY = Buffer.from([0, 255, 1, 2, 3]).toString("base64");

function keyInfo(key, encoded, extra = {}) {
  const decoded = Buffer.from(encoded, "base64");
  return { key, encoded, encodedBytes: encoded.length, decodedBytes: decoded.length, validBase64: true, binary: false, utf8: true, ...extra };
}

function secretApi(overrides = {}) {
  const calls = [];
  const answers = {
    secretKeys: async () => ({
      type: "Opaque",
      immutable: false,
      keys: [keyInfo("DATABASE_URL", b64(VALUE)), keyInfo("keystore.p12", BINARY, { binary: true, utf8: false })],
    }),
    revealSecret: async (_cluster, _ns, _name, key) => ({ key, value: VALUE, decodedBytes: VALUE.length, binary: false }),
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
    view = mount(React.createElement(SecretTab, { api, clusterId: "cluster-a", row: { name: "app-secrets", namespace: "default" }, copyLabel: "Copy", t: translate }));
  });
  t.after(() => view.unmount());

  const rowFor = (key) => view.all(".secret-key-row").find((row) => row.dataset.key === key);
  const button = (key, label) => rowFor(key).querySelector(`button[aria-label="${label}"]`);
  const click = async (target) => {
    await React.act(async () => target.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  };

  return {
    view,
    calls,
    api,
    row: rowFor,
    button,
    textarea: (key) => rowFor(key)?.querySelector("textarea"),
    named: (name) => calls.filter((call) => call.name === name),
    click,
    decode: (key) => click(button(key, "Decode")),
    save: (key) => click(button(key, "Save")),
  };
}

const type = async (input, value) => {
  await React.act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
};

test("values are shown as base64 straight away, ready to edit, with nothing on a timer", async (t) => {
  const s = await secretTab(t);

  assert.equal(s.textarea("DATABASE_URL").value, b64(VALUE));
  assert.equal(s.textarea("keystore.p12").value, BINARY);
  assert.equal(s.textarea("DATABASE_URL").readOnly, false, "a value is ready to edit without a separate step");
  assert.ok(!s.view.container.textContent.includes("hunter2"), "nothing is decoded until the eye is pressed");
  assert.equal(s.named("revealSecret").length, 0, "showing base64 is not a decode and is not audited as one");
  assert.ok(!s.view.container.textContent.includes("Auto-hide"), "no value hides itself any more");
  assert.equal(s.button("DATABASE_URL", "Save").disabled, true, "Save waits for a change");
});

test("the eye decodes a value to text, audited once, and back to base64", async (t) => {
  const s = await secretTab(t);
  await s.decode("DATABASE_URL");

  assert.equal(s.textarea("DATABASE_URL").value, VALUE);
  assert.deepEqual(s.named("revealSecret")[0].args, ["cluster-a", "default", "app-secrets", "DATABASE_URL"]);
  assert.equal(s.row("DATABASE_URL").querySelector(".secret-format-chip").textContent, "text");

  await s.click(s.button("DATABASE_URL", "Show as base64"));
  assert.equal(s.textarea("DATABASE_URL").value, b64(VALUE));
  await s.decode("DATABASE_URL");
  assert.equal(s.named("revealSecret").length, 1, "going back and forth is one decode in the audit log, not one per press");
});

test("a value that cannot be read as text stays base64", async (t) => {
  const s = await secretTab(t, {
    secretKeys: async () => ({
      type: "Opaque",
      immutable: false,
      keys: [
        keyInfo("keystore.p12", BINARY, { binary: true, utf8: false }),
        keyInfo("latin1", Buffer.from("café au lait", "latin1").toString("base64"), { utf8: false }),
        { key: "legacy", encoded: "tok_8f3a=b9!", encodedBytes: 12, decodedBytes: 0, validBase64: false, binary: false, utf8: false },
      ],
    }),
  });

  assert.equal(s.button("keystore.p12", "Binary data: base64 only").disabled, true);
  assert.equal(s.button("latin1", "Binary data: base64 only").disabled, true, "editing bytes that are not UTF-8 as text would change them");
  assert.equal(s.button("legacy", "Not valid base64").disabled, true);
  assert.equal(s.textarea("legacy").value, "tok_8f3a=b9!", "a value that is not base64 is shown as it is stored");
  assert.equal(s.row("legacy").querySelector(".secret-format-chip").textContent, "as is");
  assert.equal(s.button("legacy", "Save").disabled, true, "an untouched value has nothing to save");
});

test("Save writes a text edit at once, as base64, with no confirmation", async (t) => {
  const s = await secretTab(t);
  await s.decode("DATABASE_URL");
  await type(s.textarea("DATABASE_URL"), "postgres://kubedeck:роторот@db.internal:5432/app");

  assert.ok(s.row("DATABASE_URL").textContent.includes("encoded to base64 on save"));
  assert.equal(s.button("DATABASE_URL", "Save").disabled, false);
  await s.save("DATABASE_URL");

  assert.ok(!s.view.first('[role="dialog"]'), "Save does not ask");
  const write = s.named("updateSecret")[0];
  assert.ok(write, "Save writes at once");
  assert.deepEqual(write.args, ["cluster-a", "default", "app-secrets", "DATABASE_URL", b64("postgres://kubedeck:роторот@db.internal:5432/app")]);
  assert.equal(s.named("secretKeys").length, 2, "the keys are read again after the write");
  assert.ok(s.row("DATABASE_URL").textContent.includes("Saved to the cluster"));
});

test("a base64 edit is saved as typed, wrapped lines joined", async (t) => {
  const s = await secretTab(t);
  const next = Buffer.from([9, 8, 7, 6, 5, 4, 3, 2, 1]).toString("base64");
  await type(s.textarea("keystore.p12"), `${next.slice(0, 6)}\n${next.slice(6)}`);
  await s.save("keystore.p12");

  assert.equal(s.named("updateSecret")[0].args[4], next);
});

test("an edit that is not base64 cannot be saved, and can be undone", async (t) => {
  const s = await secretTab(t);
  await type(s.textarea("DATABASE_URL"), "not base64!");

  assert.equal(s.textarea("DATABASE_URL").value, "not base64!", "what was typed stays on screen to be fixed");
  assert.equal(s.button("DATABASE_URL", "Save").disabled, true);
  assert.ok(s.row("DATABASE_URL").querySelector(".secret-value-field.is-invalid"));
  assert.ok(s.row("DATABASE_URL").textContent.includes("Not valid base64"));

  const undo = [...s.row("DATABASE_URL").querySelectorAll("button")].find((node) => node.textContent === "Undo changes");
  await s.click(undo);
  assert.equal(s.textarea("DATABASE_URL").value, b64(VALUE));
  assert.equal(s.named("updateSecret").length, 0);
});

test("saving one key keeps the edit in progress on another", async (t) => {
  const s = await secretTab(t);
  await type(s.textarea("keystore.p12"), "AAAA");
  await type(s.textarea("DATABASE_URL"), b64("rotated"));
  await s.save("DATABASE_URL");

  assert.equal(s.textarea("keystore.p12").value, "AAAA", "the other key's edit survives the reload");
  assert.equal(s.button("keystore.p12", "Save").disabled, false);
});

test("a failed save keeps the edit and shows why", async (t) => {
  const s = await secretTab(t, {
    updateSecret: async () => {
      throw new Error("Conflict: changed in the cluster since it was loaded");
    },
  });
  await type(s.textarea("DATABASE_URL"), b64("rotated"));
  await s.save("DATABASE_URL");

  assert.equal(s.textarea("DATABASE_URL").value, b64("rotated"));
  assert.ok(s.view.container.textContent.includes("changed in the cluster since it was loaded"));
});

test("an immutable Secret is shown read-only, with no Save", async (t) => {
  const s = await secretTab(t, {
    secretKeys: async () => ({ type: "Opaque", immutable: true, keys: [keyInfo("DATABASE_URL", b64(VALUE))] }),
  });

  assert.equal(s.textarea("DATABASE_URL").readOnly, true, "the API would refuse the write, so the field must not invite it");
  assert.equal(s.button("DATABASE_URL", "Save"), null);
  await s.decode("DATABASE_URL");
  assert.equal(s.textarea("DATABASE_URL").value, VALUE, "it can still be decoded and read");
});

test("a value too large to show is not put in a field", async (t) => {
  const s = await secretTab(t, {
    secretKeys: async () => ({ type: "Opaque", immutable: false, keys: [{ key: "huge", encoded: null, encodedBytes: 3_000_000, decodedBytes: 2_250_000, validBase64: true, binary: true, utf8: false }] }),
  });

  assert.equal(s.textarea("huge"), null);
  assert.ok(s.row("huge").textContent.includes("Too large to show here"));
  assert.equal(s.button("huge", "Copy base64").disabled, true);
});

test("Copy copies what is on screen and the audit names only the key", async (t) => {
  const copied = [];
  // Node has a navigator of its own, and it is the one the tab reaches.
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (text) => copied.push(text) }, configurable: true });
  t.after(() => delete globalThis.navigator.clipboard);
  const s = await secretTab(t);

  await s.click(s.button("DATABASE_URL", "Copy base64"));
  await s.decode("DATABASE_URL");
  await s.click(s.button("DATABASE_URL", "Copy text"));

  assert.deepEqual(copied, [b64(VALUE), VALUE]);
  const audited = s.named("auditSecretCopy");
  assert.equal(audited.length, 2, "a copy that is not audited is a copy nobody can account for");
  assert.deepEqual(audited[0].args, ["cluster-a", "default", "app-secrets", "DATABASE_URL"]);
  assert.ok(s.row("DATABASE_URL").textContent.includes("Copied as text"));
});

test("leaving a Secret drops its unsaved edit without asking, and shows nothing of it under the next", async (t_) => {
  let refuse = false;
  const s = await secretTab(t_, {
    secretKeys: async (_cluster, _ns, name) => {
      if (refuse) throw new Error(`secrets "${name}" is forbidden`);
      return { type: "Opaque", immutable: false, keys: [keyInfo("DATABASE_URL", b64(VALUE))] };
    },
  });
  await s.decode("DATABASE_URL");
  await type(s.textarea("DATABASE_URL"), "half-typed");

  // The next Secret cannot be read: nothing of the first may remain.
  refuse = true;
  await React.act(async () => {
    s.view.update(React.createElement(SecretTab, { api: s.api, clusterId: "cluster-a", row: { name: "other-secrets", namespace: "default" }, copyLabel: "Copy", t: translate }));
  });
  assert.ok(!s.view.first('[role="dialog"]'), "nothing asks about the unsaved edit");
  assert.equal(s.named("updateSecret").length, 0, "and nothing is written");
  assert.ok(!s.view.container.textContent.includes("hunter2"), "the first Secret's value is gone");
  assert.ok(!s.view.container.querySelector("textarea"), "and so is the edit in progress");
  assert.equal(s.view.all(".secret-key-row").length, 0, "the first Secret's keys are not shown under the second's name");
});

test("the base64 codec goes by bytes and refuses what the backend refuses", () => {
  // Through UTF-8, not atob's Latin-1: Cyrillic must round-trip byte for byte.
  assert.equal(codec.encodeSecretText("пароль"), b64("пароль"));
  assert.equal(codec.decodeSecretText(b64("пароль")), "пароль");
  assert.equal(codec.decodeSecretText(b64("﻿with a BOM")), "﻿with a BOM", "a byte-order mark is kept, not eaten");
  assert.equal(codec.decodeSecretText(Buffer.from("café", "latin1").toString("base64")), null, "not UTF-8: no text to edit");
  assert.equal(codec.decodeSecretText("%%%"), null);

  assert.equal(codec.canonicalSecretBase64(" aGVs\nbG8= "), "aGVsbG8=");
  assert.equal(codec.canonicalSecretBase64("aGVsbG8"), null, "missing padding");
  assert.equal(codec.canonicalSecretBase64("aGVsbG9="), null, "spare bits set: decodes, but is not what it encodes back to");
  assert.equal(codec.canonicalSecretBase64(""), "", "an empty value is a value");
  const large = Buffer.alloc(200_000, 7).toString("base64");
  assert.equal(codec.encodeSecretText(Buffer.from(large, "base64").toString("latin1")).length > 0, true, "a large value does not overflow the stack");
});
