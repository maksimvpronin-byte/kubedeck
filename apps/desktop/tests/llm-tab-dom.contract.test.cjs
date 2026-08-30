// The LLM tab, rendered and clicked on.
//
// These replace grep contracts over LlmTab.tsx. The promise they hold is a
// privacy one - no log line and no Secret value may reach a third-party model -
// and it was held by `assert.doesNotMatch(source, /logs\s*:/)`. That regular
// expression reads one file and sees one spelling of one call: it would pass if
// the call were renamed, if the logs arrived through a prop the tab spreads into
// the payload, or if a second file did the fetching. What is actually promised
// is a property of the request that leaves the tab, so that is what these check,
// by looking at every key of it rather than at the source that built it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React } = require("./helpers/dom.cjs");

const { LlmTab } = loadComponent("components/LlmTab.tsx", {
  // Imported for its type only; loading the real client would drag the whole
  // transport in to prove nothing about this tab.
  "../api": { ApiClient: class {} },
});

const ROW = { uid: "uid-1", name: "api-server", namespace: "kube-system", kind: "Pod", phase: "Running" };
const SETTINGS = { llm: { enabled: true, baseUrl: "http://localhost:1234", model: "local-model" } };

// Every call the tab makes, in order, whatever it is named. A recorder rather
// than a list of stubs, so a method nobody predicted still shows up.
function recordingApi(overrides = {}) {
  const calls = [];
  const answers = {
    resourceText: async () => "apiVersion: v1\nkind: Pod\n",
    resourceEvents: async () => ({ items: [] }),
    relatedResources: async () => ({ items: [] }),
    analyzeResourceWithLlm: async () => ({ answer: "ok", model: "local-model", elapsedMs: 5, contextChars: 10, truncated: false }),
    previewLlmResourcePrompt: async () => ({ messages: [{ role: "system", content: "you are a diagnostician" }] }),
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

function props(api, extra = {}) {
  return {
    api,
    clusterId: "cluster-a",
    resource: "pods",
    row: ROW,
    settings: SETTINGS,
    yaml: "",
    describe: "",
    events: [],
    relatedLinks: [],
    loading: false,
    answer: "",
    model: "",
    elapsedMs: 0,
    contextChars: 0,
    truncated: false,
    error: null,
    copyLabel: "Copy",
    t: (key) => key,
    onLoadingChange: () => {},
    onAnswer: () => {},
    onError: () => {},
    onCopy: () => {},
    ...extra,
  };
}

// The tab's work is asynchronous - it collects four things before it sends
// anything - so a click has to be awaited rather than merely dispatched.
async function clickAndSettle(target) {
  await React.act(async () => {
    target.dispatchEvent(new (require("./helpers/dom.cjs").window.MouseEvent)("click", { bubbles: true }));
  });
}

const analyzeButton = (view) => view.all(".llm-tab-actions button")[0];
const promptButton = (view) => view.all(".llm-tab-actions button")[1];

// Walks the whole payload, not its top level: logs that arrived through a
// spread prop would sit one level down, which is exactly where a regex over the
// source cannot look.
function keysDeep(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, found);
  } else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      found.add(key);
      keysDeep(inner, found);
    }
  }
  return found;
}

test("analysing a resource never asks for its logs", async (t) => {
  const { api, calls } = recordingApi();
  const view = mount(React.createElement(LlmTab, props(api)));
  t.after(() => view.unmount());

  await clickAndSettle(analyzeButton(view));

  // Not "podLogs was not called" - nothing whose name mentions logs was.
  const askedForLogs = calls.filter((call) => /log/i.test(call.name));
  assert.deepEqual(askedForLogs, [], `the tab called ${askedForLogs.map((c) => c.name).join(", ")}`);

  // And it did send something, or the assertion above would pass on a tab that
  // does nothing at all.
  assert.ok(
    calls.some((call) => call.name === "analyzeResourceWithLlm"),
    "the tab must actually send an analysis",
  );
});

test("the request is built from named parts, and logs are not one of them", (t) => {
  // The stronger form of the promise. The old contract said the source does not
  // contain `logs:`; this says what the payload is, so a part added to it later
  // has to be added here too and cannot arrive unnoticed.
  //
  // Note what this does NOT claim: the tab spreads the row it was handed into
  // `resourceObject`, so whatever a row carries goes to the model. That is safe
  // because of where rows are built, not because of anything here - `meta()`
  // puts labels but no annotations on a row, so no last-applied-configuration
  // travels, and `keyValueSummary` gives a Secret only its key names and a
  // count, never a value. Those guarantees belong to the normalizers and are
  // tested there.
  const { api, calls } = recordingApi();
  const view = mount(React.createElement(LlmTab, props(api)));
  t.after(() => view.unmount());

  return clickAndSettle(analyzeButton(view)).then(() => {
    const [request] = calls.find((call) => call.name === "analyzeResourceWithLlm").args;
    assert.deepEqual(Object.keys(request).sort(), ["clusterId", "describe", "events", "kind", "name", "namespace", "relatedResources", "resource", "resourceObject", "usageHistory", "yaml"]);
    assert.deepEqual(request.resourceObject, ROW);
  });
});

test("the request carries no language preference, so the answer does not follow the interface", async (t) => {
  // Sending the UI preference made the answer switch to English, because
  // "system" - the default - matched neither branch of the prompt's language
  // rule. The analysis is always written in one language, chosen by the prompt.
  const { api, calls } = recordingApi();
  const view = mount(React.createElement(LlmTab, props(api)));
  t.after(() => view.unmount());

  await clickAndSettle(analyzeButton(view));

  const [request] = calls.find((call) => call.name === "analyzeResourceWithLlm").args;
  const language = [...keysDeep(request)].filter((key) => /^language$/i.test(key));
  assert.deepEqual(language, [], "the request carries a language preference");
});

test("the prompt preview shows the reader exactly what the analysis would send", async (t) => {
  // The preview is worth having only if it previews the real thing. Both paths
  // build their payload from the same place, and this is what says so.
  const { api, calls } = recordingApi();
  const view = mount(React.createElement(LlmTab, props(api)));
  t.after(() => view.unmount());

  await clickAndSettle(analyzeButton(view));
  await clickAndSettle(promptButton(view));

  const sent = calls.find((call) => call.name === "analyzeResourceWithLlm").args[0];
  const previewed = calls.find((call) => call.name === "previewLlmResourcePrompt").args[0];
  assert.deepEqual(previewed, sent);
});

test("an open prompt can be hidden while an analysis is still running", async (t) => {
  // Hiding an open prompt is local: it never waits on anything. Tying the button
  // to the shared busy flag left the prompt stuck on screen for as long as the
  // model took to answer.
  const { api, calls } = recordingApi();
  const view = mount(React.createElement(LlmTab, props(api)));
  t.after(() => view.unmount());

  await clickAndSettle(promptButton(view));
  assert.ok(view.first(".llm-prompt-preview"), "the preview should be open");

  // The analysis starts and does not finish while the reader is looking.
  view.update(React.createElement(LlmTab, props(api, { loading: true })));

  const before = calls.length;
  const hide = promptButton(view);
  assert.equal(hide.disabled, false, "the hide button must not wait on the analysis");
  await clickAndSettle(hide);

  assert.ok(!view.first(".llm-prompt-preview"), "the preview should be closed");
  assert.equal(calls.length, before, "hiding the prompt must not call the backend");
});

test("a second analysis cannot be started while one is in flight", async (t) => {
  const { api } = recordingApi();
  const view = mount(React.createElement(LlmTab, props(api, { loading: true })));
  t.after(() => view.unmount());

  assert.equal(analyzeButton(view).disabled, true);
});
