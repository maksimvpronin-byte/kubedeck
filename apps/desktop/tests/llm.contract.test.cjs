const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { chatCompletion, LlmClientError, normalizeBaseUrl, validateLlmSettings } = require("../dist/main/backend/llm/client.js");
const { buildResourceContext, sanitizeText, sanitizeValue } = require("../dist/main/backend/llm/context.js");
const { buildUserPrompt } = require("../dist/main/backend/llm/prompts.js");
const { handleLlmRequest, publicLlmStatus } = require("../dist/main/backend/routes/llm.js");
const { writeSettings } = require("../dist/main/backend/routes/config.js");
const { ConfigStore } = require("../dist/main/backend/config/configStore.js");
const { MemorySecretStore } = require("../dist/main/backend/security/memorySecretStore.js");
const { migratePlaintextLlmSecret } = require("../dist/main/backend/security/migrateSecrets.js");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function tempAppDataRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function llmSettings(baseUrl, overrides = {}) {
  return {
    enabled: true,
    provider: "openai_compatible",
    baseUrl,
    model: "test-model",
    apiKeyConfigured: true,
    temperature: 0.2,
    timeoutSeconds: 5,
    maxContextChars: 60000,
    maxOutputTokens: 4096,
    ...overrides,
  };
}

function resolvedSettings(baseUrl, overrides = {}) {
  const { apiKey = "test-api-key", ...rest } = overrides;
  return { ...llmSettings(baseUrl, rest), apiKey };
}

function resourceRequest(overrides = {}) {
  return {
    clusterId: "cluster-1",
    resource: "pods",
    kind: "Pod",
    namespace: "default",
    name: "api-0",
    resourceObject: {
      kind: "Pod",
      metadata: { name: "api-0", namespace: "default" },
      status: {
        phase: "Running",
        qosClass: "Burstable",
        containerStatuses: [{ name: "api", ready: true, restartCount: 0 }],
      },
    },
    describe: "Name: api-0\nStatus: Running\nReady: 1/1\nRestart Count: 0\nEvents: <none>",
    yaml: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: api-0",
    relatedResources: [{ resource: "services", name: "api" }],
    ...overrides,
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function startSettingsServer(configStore, auditStore, secretStore) {
  const server = http.createServer((request, response) => {
    if (request.method === "PUT" && request.url === "/settings") {
      void writeSettings(request, response, configStore, auditStore, secretStore);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const url = await listen(server);
  return { server, url };
}

test("LLM sanitizer removes structured and textual secrets", () => {
  const sanitized = sanitizeValue({
    kind: "Secret",
    metadata: { name: "registry" },
    data: { password: "c2VjcmV0" },
    stringData: { token: "token-value" },
  });
  assert.equal(sanitized.data, "[REDACTED]");
  assert.equal(sanitized.stringData, "[REDACTED]");

  const text = sanitizeText("Authorization: Bearer abc.def\nPASSWORD=super-secret\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
  assert.doesNotMatch(text, /abc\.def|super-secret|BEGIN PRIVATE KEY/);
  assert.match(text, /\[REDACTED\]/);
});

test("resource context excludes Kubernetes log streams and preserves truncation", () => {
  const sentinel = "forbidden-log-sentinel";
  const built = buildResourceContext(resourceRequest({ logs: sentinel, previousLogs: `previous-${sentinel}` }), 60000);
  assert.equal(built.truncated, false);
  assert.match(built.context, /RESOURCE IDENTITY/);
  assert.match(built.context, /LOG CONTEXT POLICY/);
  assert.match(built.context, /not collected or sent to LLM providers/);
  assert.doesNotMatch(built.context, new RegExp(sentinel));
  assert.doesNotMatch(built.context, /CONTAINER LOGS|previousLogs|currentLogs/);
  assert.match(built.context, /Events already provided by describe: <none>/);

  const truncated = buildResourceContext(resourceRequest({ describe: "x".repeat(10000) }), 1200);
  assert.equal(truncated.truncated, true);
  assert.ok(truncated.context.length <= 1200);
  assert.match(truncated.context, /\[TRUNCATED\]$/);
});

test("prompt builder keeps exact context boundary and user request", () => {
  const prompt = buildUserPrompt("phase: Pending", "Найди причину");
  assert.match(prompt, /KUBEDECK CONTEXT START\nphase: Pending/);
  assert.match(prompt, /TASK\nНайди причину/);
  assert.match(prompt, /<kubedeck_final>/);
});

test("LLM client normalizes endpoint and renders fixed five-section answer", async (t) => {
  let received;
  const server = http.createServer(async (request, response) => {
    received = {
      url: request.url,
      authorization: request.headers.authorization,
      body: await readBody(request),
    };
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        model: "served-model",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content:
                '<think>hidden</think><kubedeck_final>{"conclusion":["Работает"],"facts":["Phase: Running"],"risks":["ошибочный риск"],"nextChecks":["лишняя проверка"],"missing":["логи"]}</kubedeck_final>',
            },
          },
        ],
      }),
    );
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const context = buildResourceContext(resourceRequest(), 60000).context;
  const messages = [
    { role: "system", content: "system" },
    { role: "user", content: buildUserPrompt(context) },
  ];
  const completion = await chatCompletion(resolvedSettings(baseUrl), messages);

  assert.equal(received.url, "/v1/chat/completions");
  assert.equal(received.authorization, "Bearer test-api-key");
  assert.equal(received.body.model, "test-model");
  assert.equal(received.body.max_tokens, 4096);
  assert.equal(completion.model, "served-model");
  assert.match(completion.answer, /1\. Короткий вывод/);
  assert.match(completion.answer, /3\. Проблемы \/ риски\n- Активных проблем не выявлено\./);
  assert.match(completion.answer, /4\. Что проверить дальше\n- Ничего срочного\./);
  assert.doesNotMatch(completion.answer, /hidden|ошибочный риск|лишняя проверка/);
});

test("LLM client preserves empty, reasoning-only and token-limit error codes", async () => {
  const base = resolvedSettings("http://127.0.0.1:12345");
  const response = (body) => async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body);
    },
  });

  await assert.rejects(chatCompletion(base, [], response({ choices: [{ message: { content: "" } }] })), (error) => error instanceof LlmClientError && error.code === "LLM_EMPTY_RESPONSE");
  await assert.rejects(
    chatCompletion(base, [], response({ choices: [{ finish_reason: "stop", message: { reasoning_content: "thinking" } }] })),
    (error) => error instanceof LlmClientError && error.code === "LLM_EMPTY_FINAL_RESPONSE",
  );
  await assert.rejects(
    chatCompletion(base, [], response({ choices: [{ finish_reason: "length", message: { reasoning_content: "thinking" } }] })),
    (error) => error instanceof LlmClientError && error.code === "LLM_OUTPUT_TOKEN_LIMIT",
  );
});

test("LLM settings validation and public status do not expose the API key", () => {
  assert.equal(normalizeBaseUrl("http://127.0.0.1:1234/chat/completions"), "http://127.0.0.1:1234/v1");
  assert.throws(
    () => validateLlmSettings(llmSettings("file:///tmp/model")),
    (error) => error.code === "LLM_BASE_URL_INVALID",
  );
  assert.throws(
    () => validateLlmSettings(llmSettings("http://127.0.0.1:1234", { enabled: false })),
    (error) => error.code === "LLM_DISABLED",
  );
  const status = publicLlmStatus(llmSettings("http://127.0.0.1:1234"), true);
  assert.deepEqual(status, {
    enabled: true,
    configured: true,
    provider: "openai_compatible",
    baseUrl: "http://127.0.0.1:1234",
    model: "test-model",
    secretStorageAvailable: true,
  });
  assert.equal("apiKey" in status, false);
});

test("LLM HTTP routes keep status, test, preview, and analyze contracts", async (t) => {
  const llmBodies = [];
  const llm = http.createServer(async (request, response) => {
    const body = await readBody(request);
    llmBodies.push(body);
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        model: body.model,
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: '<kubedeck_final>{"conclusion":["Ответ"],"facts":["Факт"],"risks":[],"nextChecks":[],"missing":[]}</kubedeck_final>',
            },
          },
        ],
      }),
    );
  });
  const llmUrl = await listen(llm);
  t.after(() => close(llm));

  const secretStore = new MemorySecretStore();
  secretStore.write("llm-api-key", "test-api-key");

  const configStore = {
    load() {
      return { settings: { llm: llmSettings(llmUrl) } };
    },
  };
  const logs = [];
  const api = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (!handleLlmRequest(request, response, pathname, configStore, secretStore, (line) => logs.push(line))) {
      response.statusCode = 404;
      response.end();
    }
  });
  const apiUrl = await listen(api);
  t.after(() => close(api));

  const statusResponse = await fetch(`${apiUrl}/llm/status`);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.configured, true);
  assert.equal(status.secretStorageAvailable, true);
  assert.equal("apiKey" in status, false);

  const testResponse = await fetch(`${apiUrl}/llm/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const tested = await testResponse.json();
  assert.equal(tested.ok, true);
  assert.equal(tested.model, "test-model");

  const candidateResponse = await fetch(`${apiUrl}/llm/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKeyUpdate: { action: "replace", value: "unsaved-candidate-key" } }),
  });
  const candidateTested = await candidateResponse.json();
  assert.equal(candidateTested.ok, true);
  assert.equal(secretStore.read("llm-api-key"), "test-api-key");

  const previewResponse = await fetch(`${apiUrl}/llm/preview-resource-prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resourceRequest()),
  });
  const preview = await previewResponse.json();
  assert.equal(preview.messages.length, 2);
  assert.equal(preview.maxOutputTokens, 4096);
  assert.match(preview.context, /RESOURCE IDENTITY/);
  assert.match(preview.context, /LOG CONTEXT POLICY/);

  const analyzeResponse = await fetch(`${apiUrl}/llm/analyze-resource`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resourceRequest()),
  });
  const analyzed = await analyzeResponse.json();
  assert.equal(analyzeResponse.status, 200);
  assert.equal(analyzed.model, "test-model");
  assert.equal(analyzed.maxOutputTokens, 4096);
  assert.match(analyzed.answer, /1\. Короткий вывод/);
  assert.equal(logs.length, 0);

  const callsBeforeForbiddenRequests = llmBodies.length;
  for (const route of ["preview-resource-prompt", "analyze-resource"]) {
    const sentinel = `forbidden-${route}-log`;
    const forbiddenResponse = await fetch(`${apiUrl}/llm/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(resourceRequest({ logs: sentinel, previousLogs: sentinel })),
    });
    assert.equal(forbiddenResponse.status, 400);
    const forbidden = await forbiddenResponse.json();
    assert.equal(forbidden.detail.code, "LLM_LOG_CONTEXT_FORBIDDEN");
    assert.doesNotMatch(JSON.stringify(forbidden), new RegExp(sentinel));
    assert.doesNotMatch(logs.join("\n"), new RegExp(sentinel));
  }
  assert.equal(llmBodies.length, callsBeforeForbiddenRequests);
});

test("LLM route errors never log API keys or request payloads", async (t) => {
  const secret = "never-log-this-api-key";
  const secretStore = new MemorySecretStore();
  secretStore.write("llm-api-key", secret);

  const configStore = {
    load() {
      return {
        settings: {
          llm: llmSettings("http://127.0.0.1:1", { timeoutSeconds: 1 }),
        },
      };
    },
  };
  const logs = [];
  const api = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    handleLlmRequest(request, response, pathname, configStore, secretStore, (line) => logs.push(line));
  });
  const apiUrl = await listen(api);
  t.after(() => close(api));

  const response = await fetch(`${apiUrl}/llm/analyze-resource`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(resourceRequest({ userRequest: "payload-secret-marker" })),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.detail.code, "LLM_UNREACHABLE");
  const joined = logs.join("\n");
  assert.doesNotMatch(joined, new RegExp(secret));
  assert.doesNotMatch(joined, /payload-secret-marker/);
  assert.match(joined, /code=LLM_UNREACHABLE/);
});

test("MemorySecretStore behaves like the real SecretStore contract", () => {
  const store = new MemorySecretStore();
  assert.equal(store.isAvailable(), true);
  assert.equal(store.has("llm-api-key"), false);
  assert.equal(store.read("llm-api-key"), "");

  store.write("llm-api-key", "abc");
  assert.equal(store.has("llm-api-key"), true);
  assert.equal(store.read("llm-api-key"), "abc");

  store.delete("llm-api-key");
  assert.equal(store.has("llm-api-key"), false);
  assert.equal(store.read("llm-api-key"), "");

  const unavailable = new MemorySecretStore(false);
  assert.equal(unavailable.isAvailable(), false);
  assert.throws(() => unavailable.write("llm-api-key", "x"), /unavailable/);
});

test("migratePlaintextLlmSecret moves an available plaintext key into secret storage and scrubs files", () => {
  const appDataRoot = tempAppDataRoot("kubedeck-llm-migrate-available-");
  const configPath = path.join(appDataRoot, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ clusters: [], settings: { llm: { apiKey: "plaintext-secret" } } }));

  const secretStore = new MemorySecretStore();
  const result = migratePlaintextLlmSecret(appDataRoot, secretStore);

  assert.deepEqual(result, { migrated: true, blocked: false });
  assert.equal(secretStore.read("llm-api-key"), "plaintext-secret");

  const rewritten = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal("apiKey" in rewritten.settings.llm, false);
  assert.equal(rewritten.settings.llm.apiKeyConfigured, true);

  if (process.platform !== "win32") {
    const mode = fs.statSync(configPath).mode & 0o777;
    assert.equal(mode, 0o600);
  }

  assert.ok(fs.existsSync(path.join(appDataRoot, "secrets", "migration-v1.json")));

  const secondRun = migratePlaintextLlmSecret(appDataRoot, secretStore);
  assert.deepEqual(secondRun, { migrated: false, blocked: false });
});

test("migratePlaintextLlmSecret tightens permissions but keeps the key when secret storage is unavailable", () => {
  const appDataRoot = tempAppDataRoot("kubedeck-llm-migrate-blocked-");
  const configPath = path.join(appDataRoot, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ clusters: [], settings: { llm: { apiKey: "plaintext-secret" } } }));

  const secretStore = new MemorySecretStore(false);
  const result = migratePlaintextLlmSecret(appDataRoot, secretStore);

  assert.deepEqual(result, { migrated: false, blocked: true });
  assert.equal(secretStore.has("llm-api-key"), false);

  const untouched = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(untouched.settings.llm.apiKey, "plaintext-secret");

  if (process.platform !== "win32") {
    const mode = fs.statSync(configPath).mode & 0o777;
    assert.equal(mode, 0o600);
  }

  assert.equal(fs.existsSync(path.join(appDataRoot, "secrets", "migration-v1.json")), false);
});

test("migratePlaintextLlmSecret is a no-op when no plaintext key exists", () => {
  const appDataRoot = tempAppDataRoot("kubedeck-llm-migrate-empty-");
  fs.writeFileSync(path.join(appDataRoot, "config.json"), JSON.stringify({ clusters: [], settings: { llm: { apiKeyConfigured: false } } }));

  const secretStore = new MemorySecretStore();
  const result = migratePlaintextLlmSecret(appDataRoot, secretStore);

  assert.deepEqual(result, { migrated: false, blocked: false });
  assert.equal(secretStore.has("llm-api-key"), false);
});

test("PUT /settings applies apiKeyUpdate and never echoes the raw key", async (t) => {
  const appDataRoot = tempAppDataRoot("kubedeck-settings-apikey-");
  const configStore = new ConfigStore(appDataRoot);
  const auditEvents = [];
  const auditStore = { append: (event) => auditEvents.push(event) };
  const secretStore = new MemorySecretStore();

  const { server, url } = await startSettingsServer(configStore, auditStore, secretStore);
  t.after(() => close(server));

  const base = configStore.load().settings;

  const replaceResponse = await fetch(`${url}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      settings: base,
      apiKeyUpdate: { action: "replace", value: "brand-new-key" },
    }),
  });
  assert.equal(replaceResponse.status, 200);
  const afterReplace = await replaceResponse.json();
  assert.equal(afterReplace.settings.llm.apiKeyConfigured, true);
  assert.equal("apiKey" in afterReplace.settings.llm, false);
  assert.equal(JSON.stringify(afterReplace).includes("brand-new-key"), false);
  assert.equal(secretStore.read("llm-api-key"), "brand-new-key");

  const keepResponse = await fetch(`${url}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: afterReplace.settings }),
  });
  const afterKeep = await keepResponse.json();
  assert.equal(afterKeep.settings.llm.apiKeyConfigured, true);
  assert.equal(secretStore.read("llm-api-key"), "brand-new-key");

  const clearResponse = await fetch(`${url}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: afterKeep.settings, apiKeyUpdate: { action: "clear" } }),
  });
  const afterClear = await clearResponse.json();
  assert.equal(afterClear.settings.llm.apiKeyConfigured, false);
  assert.equal(secretStore.has("llm-api-key"), false);

  const onDisk = JSON.parse(fs.readFileSync(configStore.paths.config, "utf8"));
  assert.equal("apiKey" in onDisk.settings.llm, false);
});

test("PUT /settings rejects a replace when secret storage is unavailable, without persisting", async (t) => {
  const appDataRoot = tempAppDataRoot("kubedeck-settings-apikey-unavailable-");
  const configStore = new ConfigStore(appDataRoot);
  const auditEvents = [];
  const auditStore = { append: (event) => auditEvents.push(event) };
  const secretStore = new MemorySecretStore(false);

  const { server, url } = await startSettingsServer(configStore, auditStore, secretStore);
  t.after(() => close(server));

  const base = configStore.load().settings;
  const response = await fetch(`${url}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      settings: base,
      apiKeyUpdate: { action: "replace", value: "should-not-be-saved" },
    }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.detail.code, "SECRET_STORAGE_UNAVAILABLE");

  const onDisk = JSON.parse(fs.readFileSync(configStore.paths.config, "utf8"));
  assert.equal(onDisk.settings.llm.apiKeyConfigured, false);
  assert.equal(JSON.stringify(onDisk).includes("should-not-be-saved"), false);
});

test("the analysis always answers in Russian and never translates Kubernetes terms", async (t) => {
  const { SYSTEM_PROMPT, DEFAULT_USER_REQUEST } = require("../dist/main/backend/llm/prompts.js");
  const { buildLlmPrompt } = require("../dist/main/backend/routes/llm.js");

  // The answer language is not a request field any more: a UI set to English
  // used to send language "system", which the prompt did not define, so the
  // model fell through to answering in English.
  assert.doesNotMatch(SYSTEM_PROMPT, /when context language is|language is en/i);
  assert.match(SYSTEM_PROMPT, /Write every JSON value in Russian/);
  assert.match(SYSTEM_PROMPT, /Never answer in English/);

  // Russian is the language of the prose around the terms, not of the terms.
  assert.match(SYSTEM_PROMPT, /Keep Kubernetes and infrastructure terminology in its original English form/);
  assert.match(SYSTEM_PROMPT, /Do not translate and do not transliterate/);
  for (const term of ["CrashLoopBackOff", "ImagePullBackOff", "readinessProbe", "imagePullSecrets", "Deployment", "Running"]) {
    assert.ok(SYSTEM_PROMPT.includes(term), `system prompt must name ${term} as a term to keep`);
  }
  assert.match(SYSTEM_PROMPT, /Pod в состоянии CrashLoopBackOff/, "the prompt shows the expected mixed-language style");
  assert.match(SYSTEM_PROMPT, /never do this/i, "the prompt shows what a translated term looks like");
  assert.match(DEFAULT_USER_REQUEST, /оставляй Kubernetes-термины/);

  const settings = { ...llmSettings("http://127.0.0.1:1"), maxContextChars: 60000 };
  const built = buildLlmPrompt(settings, resourceRequest());
  const systemPrompt = built.messages.find((message) => message.role === "system").content;
  const userPrompt = built.messages.find((message) => message.role === "user").content;
  assert.equal(systemPrompt, SYSTEM_PROMPT);
  assert.match(userPrompt, /Write every JSON value in Russian, keeping Kubernetes terms/);

  // A request that still carries a language field must not change the prompt,
  // and must not leak that value into the context.
  for (const language of ["en", "system", "de"]) {
    const withLanguage = buildLlmPrompt(settings, resourceRequest({ language }));
    assert.equal(withLanguage.messages.find((message) => message.role === "system").content, SYSTEM_PROMPT, `language ${language} must not change the prompt`);
    assert.doesNotMatch(withLanguage.context, /^language:/m, `language ${language} must not reach the context`);
  }

  // The backend renders the sections itself, so they stay Russian regardless of
  // what the model returned.
  const server = http.createServer(async (request, response) => {
    await readBody(request);
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        model: "served-model",
        choices: [
          {
            finish_reason: "stop",
            message: { content: '<kubedeck_final>{"conclusion":["Pod в состоянии Running"],"facts":["Phase: Running"],"risks":[],"nextChecks":[],"missing":[]}</kubedeck_final>' },
          },
        ],
      }),
    );
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const completion = await chatCompletion(resolvedSettings(baseUrl), [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(buildResourceContext(resourceRequest({ language: "en" }), 60000).context) },
  ]);
  assert.match(completion.answer, /1\. Короткий вывод\n- Pod в состоянии Running/);
  assert.match(completion.answer, /3\. Проблемы \/ риски\n- Активных проблем не выявлено\./);
  assert.doesNotMatch(completion.answer, /Short conclusion|No active problems/);
});

test("the analysis is asked to judge request and limit against the recorded history", async (t) => {
  const { SYSTEM_PROMPT, DEFAULT_USER_REQUEST } = require("../dist/main/backend/llm/prompts.js");
  const { UsageHistorySampler, samplesFromTopOutput } = require("../dist/main/backend/resources/usageHistorySampler.js");

  // The numbers already reached the prompt; what was missing was the task.
  assert.match(SYSTEM_PROMPT, /Request and limit sizing \(the "resources" key\)/);
  assert.match(SYSTEM_PROMPT, /Judge the request against sustained load \(p50\/p95\)/);
  assert.match(SYSTEM_PROMPT, /Judge the limit against the peak \(max\)/);
  // A request and a limit fail differently, and so must the advice.
  assert.match(SYSTEM_PROMPT, /Memory is incompressible/);
  assert.match(SYSTEM_PROMPT, /OOMKilled/);
  // Guard rails: no numbers invented, none recommended off a thin window.
  assert.match(SYSTEM_PROMPT, /Below it, still give the verdict from the stated comparison, but do not name a target value/);
  assert.match(SYSTEM_PROMPT, /Never invent a number the data does not support/);
  assert.match(SYSTEM_PROMPT, /"resources": \["\.\.\."\]/, "the key has to be in the schema the model is given");
  assert.match(DEFAULT_USER_REQUEST, /оцени, верно ли выставлены request и limit/);

  let now = 1_700_000_000_000;
  const sampler = new UsageHistorySampler({ paths: { metrics: "" } }, {}, () => {}, { now: () => now, purgeOnStart: false });
  for (let index = 0; index < 60; index += 1) {
    sampler.ingest("c1", samplesFromTopOutput("default api-x 120m 400Mi", true, ""));
    now += 30_000;
  }
  const context = buildResourceContext(
    {
      clusterId: "c1",
      resource: "pods",
      name: "api-x",
      namespace: "default",
      resourceObject: { podCpuRequestValue: 500, podCpuLimitValue: 1000 },
      usageHistory: sampler.history("c1", "default", "api-x"),
    },
    60000,
  ).context;
  // The verdict needs both halves in front of it: what was measured, what was
  // configured, and how the two compare.
  assert.match(context, /pod cpu: p50 120m/);
  assert.match(context, /cpu request: 500m; sustained p95 120m is 24% of the request/);
  assert.match(context, /cpu limit: 1 cores; peak 120m is 12% of the limit/);

  let reply;
  const server = http.createServer(async (request, response) => {
    await readBody(request);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ model: "served", choices: [{ finish_reason: "stop", message: { content: `<kubedeck_final>${JSON.stringify(reply)}</kubedeck_final>` } }] }));
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(context) },
  ];

  reply = { conclusion: ["Pod в состоянии Running"], facts: ["Phase: Running"], risks: [], nextChecks: [], missing: [], resources: ["request 500m при p95 120m — зарезервировано вчетверо больше."] };
  const withVerdict = await chatCompletion(resolvedSettings(baseUrl), messages);
  assert.match(withVerdict.answer, /6\. Request \/ limit по истории\n- request 500m при p95 120m/);

  // A resource with no usage history must not carry an empty section saying so.
  reply = { conclusion: ["Service работает"], facts: ["Type: ClusterIP"], risks: [], nextChecks: [], missing: [] };
  const withoutVerdict = await chatCompletion(resolvedSettings(baseUrl), messages);
  assert.doesNotMatch(withoutVerdict.answer, /Request \/ limit/);
  assert.match(withoutVerdict.answer, /5\. Чего не хватает/, "the other five sections still render");
  sampler.close();
});

test("the context does the sizing arithmetic so the answer only has to read it", () => {
  const { SYSTEM_PROMPT } = require("../dist/main/backend/llm/prompts.js");
  const { UsageHistorySampler, samplesFromTopOutput } = require("../dist/main/backend/resources/usageHistorySampler.js");

  let now = 1_700_000_000_000;
  const sampler = new UsageHistorySampler({ paths: { metrics: "" } }, {}, () => {}, { now: () => now, purgeOnStart: false });
  for (let index = 0; index < 80; index += 1) {
    sampler.ingest("c1", samplesFromTopOutput("kube-system metrics-server-x 3m 77Mi", true, ""));
    now += 30_000;
  }
  const history = sampler.history("c1", "kube-system", "metrics-server-x");

  // metrics-server as k3s ships it: requests set, no limits at all.
  const noLimits = buildResourceContext(
    {
      clusterId: "c1",
      resource: "pods",
      name: "metrics-server-x",
      namespace: "kube-system",
      resourceObject: { podCpuRequestValue: 100, podMemoryRequestValue: 70 * 1024 * 1024 },
      usageHistory: history,
    },
    60000,
  ).context;

  // A ratio computed by the model is a ratio it can get wrong: 100m against a
  // p95 of 3m is 33x, and an answer once reported it as fourfold because the
  // prompt's example said so.
  assert.match(noLimits, /cpu request: 100m; sustained p95 3m is 3% of the request/);
  assert.match(noLimits, /memory request: 70Mi; sustained p95 77Mi is 110% of the request/);

  // Usage above a request is not an OOMKill when there is no limit to exceed.
  assert.match(noLimits, /memory limit: not set\. There is no limit to exceed, so a limit-driven OOMKill cannot happen here/);
  assert.match(noLimits, /cpu limit: not set, so this container is not throttled/);

  // A pod with limits gets the peak compared against the limit instead.
  const withLimits = buildResourceContext(
    {
      clusterId: "c1",
      resource: "pods",
      name: "metrics-server-x",
      namespace: "kube-system",
      resourceObject: { podCpuRequestValue: 1, podCpuLimitValue: 10, podMemoryRequestValue: 70 * 1024 * 1024, podMemoryLimitValue: 100 * 1024 * 1024 },
      usageHistory: history,
    },
    60000,
  ).context;
  assert.match(withLimits, /cpu limit: 10m; peak 3m is 30% of the limit/);
  // A large ratio reads as a multiplier rather than an unwieldy percentage.
  assert.match(withLimits, /sustained p95 3m is 3x the request/);

  // A pod with nothing configured is told what that costs.
  const nothingSet = buildResourceContext({ clusterId: "c1", resource: "pods", name: "metrics-server-x", namespace: "kube-system", resourceObject: {}, usageHistory: history }, 60000).context;
  assert.match(nothingSet, /cpu request: not set, so the scheduler places this pod without knowing what it needs/);

  // The prompt must not hand the model a ratio it can copy, and must forbid
  // the OOMKill claim for a container without a memory limit.
  assert.doesNotMatch(SYSTEM_PROMPT, /вчетверо/);
  assert.match(SYSTEM_PROMPT, /never compute a ratio yourself and never carry a ratio over from an example/);
  assert.match(SYSTEM_PROMPT, /usage above the request is not an OOMKill and must never be described as one/);
  assert.match(SYSTEM_PROMPT, /Do not warn about OOMKill for a container that has no memory limit/);
  sampler.close();
});

test("a thin observation window changes the sizing verdict, it does not remove it", () => {
  const { SYSTEM_PROMPT } = require("../dist/main/backend/llm/prompts.js");

  // History covers only the current run, so coverage of the 24h window is
  // usually small. A rule that suppressed the section below a threshold would
  // therefore suppress it almost always, which is how a real answer lost the
  // section entirely while still reporting the same numbers under "facts".
  assert.match(SYSTEM_PROMPT, /this key MUST be non-empty/);
  assert.match(SYSTEM_PROMPT, /Thin coverage is never a reason to leave it empty/);
  assert.match(SYSTEM_PROMPT, /Coverage changes what you may claim, never whether you answer/);
  assert.match(SYSTEM_PROMPT, /The request\/limit comparison belongs in this key and nowhere else/);
  assert.doesNotMatch(SYSTEM_PROMPT, /do not recommend concrete values/, "the wording that read as 'say nothing' must be gone");

  // Low coverage still forbids naming a target, which is the claim the data
  // cannot support.
  assert.match(SYSTEM_PROMPT, /Above roughly 20% of the window you may name a target value/);
  assert.match(SYSTEM_PROMPT, /Below it, still give the verdict from the stated comparison, but do not name a target value/);
});

test("a thin observation window is disclosed by KubeDeck, because four prompt revisions could not make the model disclose it", async (t) => {
  const { SYSTEM_PROMPT, buildUserPrompt } = require("../dist/main/backend/llm/prompts.js");
  const { UsageHistorySampler, samplesFromTopOutput } = require("../dist/main/backend/resources/usageHistorySampler.js");

  const contextFor = (steps) => {
    let now = 1_700_000_000_000;
    const sampler = new UsageHistorySampler({ paths: { metrics: "" } }, {}, () => {}, { now: () => now, purgeOnStart: false });
    for (let index = 0; index < steps; index += 1) {
      sampler.ingest("c1", samplesFromTopOutput("kube-system metrics-server-x 3m 77Mi", true, ""));
      now += 30_000;
    }
    const history = sampler.history("c1", "kube-system", "metrics-server-x");
    sampler.close();
    return buildResourceContext(
      { clusterId: "c1", resource: "pods", name: "metrics-server-x", namespace: "kube-system", resourceObject: { podMemoryRequestValue: 73400320 }, usageHistory: history },
      60000,
    ).context;
  };

  let reply;
  const server = http.createServer(async (request, response) => {
    await readBody(request);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ model: "served", choices: [{ finish_reason: "stop", message: { content: `<kubedeck_final>${JSON.stringify(reply)}</kubedeck_final>` } }] }));
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  reply = { conclusion: ["Pod в состоянии Running"], facts: [], risks: [], nextChecks: [], missing: [], resources: ["Memory: request 70Mi слишком низок для потребления 77Mi."] };

  // Half an hour of samples cannot support a target value, and the answer must
  // say so even though the model did not.
  const thin = await chatCompletion(resolvedSettings(baseUrl), [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(contextFor(60)) },
  ]);
  assert.match(thin.answer, /Memory: request 70Mi слишком низок/, "the model's verdict survives untouched");
  assert.match(thin.answer, /Наблюдения покрывают \d+% окна: этого хватает на направление вердикта, но мало, чтобы называть конкретные целевые значения\./);

  // Five hours clears the threshold, and a caveat there would only be noise.
  const wide = await chatCompletion(resolvedSettings(baseUrl), [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(contextFor(620)) },
  ]);
  assert.match(wide.answer, /Memory: request 70Mi слишком низок/);
  assert.doesNotMatch(wide.answer, /Наблюдения покрывают/);

  // The caveat belongs to the sizing verdict; without one there is no section
  // to attach it to.
  reply = { conclusion: ["Service работает"], facts: [], risks: [], nextChecks: [], missing: [] };
  const noVerdict = await chatCompletion(resolvedSettings(baseUrl), [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(contextFor(60)) },
  ]);
  assert.doesNotMatch(noVerdict.answer, /Наблюдения покрывают/);

  assert.match(SYSTEM_PROMPT, /Do not write the coverage caveat yourself/, "the model must not add a second copy");
});
