const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  chatCompletion,
  LlmClientError,
  normalizeBaseUrl,
  validateLlmSettings,
} = require("../dist/main/backend/llm/client.js");
const {
  buildResourceContext,
  sanitizeText,
  sanitizeValue,
} = require("../dist/main/backend/llm/context.js");
const { buildUserPrompt } = require("../dist/main/backend/llm/prompts.js");
const {
  handleLlmRequest,
  publicLlmStatus,
} = require("../dist/main/backend/routes/llm.js");

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

function settings(baseUrl, overrides = {}) {
  return {
    enabled: true,
    provider: "openai_compatible",
    baseUrl,
    model: "test-model",
    apiKey: "test-api-key",
    temperature: 0.2,
    timeoutSeconds: 5,
    maxContextChars: 60000,
    maxOutputTokens: 4096,
    ...overrides,
  };
}

function resourceRequest(overrides = {}) {
  return {
    clusterId: "cluster-1",
    resource: "pods",
    kind: "Pod",
    namespace: "default",
    name: "api-0",
    language: "ru",
    resourceObject: {
      kind: "Pod",
      metadata: { name: "api-0", namespace: "default" },
      status: {
        phase: "Running",
        qosClass: "Burstable",
        containerStatuses: [
          { name: "api", ready: true, restartCount: 0 },
        ],
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

test("LLM sanitizer removes structured and textual secrets", () => {
  const sanitized = sanitizeValue({
    kind: "Secret",
    metadata: { name: "registry" },
    data: { password: "c2VjcmV0" },
    stringData: { token: "token-value" },
  });
  assert.equal(sanitized.data, "[REDACTED]");
  assert.equal(sanitized.stringData, "[REDACTED]");

  const text = sanitizeText(
    "Authorization: Bearer abc.def\nPASSWORD=super-secret\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
  );
  assert.doesNotMatch(text, /abc\.def|super-secret|BEGIN PRIVATE KEY/);
  assert.match(text, /\[REDACTED\]/);
});

test("resource context excludes Kubernetes log streams and preserves truncation", () => {
  const sentinel = "forbidden-log-sentinel";
  const built = buildResourceContext(
    resourceRequest({ logs: sentinel, previousLogs: `previous-${sentinel}` }),
    60000,
  );
  assert.equal(built.truncated, false);
  assert.match(built.context, /RESOURCE IDENTITY/);
  assert.match(built.context, /LOG CONTEXT POLICY/);
  assert.match(built.context, /not collected or sent to LLM providers/);
  assert.doesNotMatch(built.context, new RegExp(sentinel));
  assert.doesNotMatch(built.context, /CONTAINER LOGS|previousLogs|currentLogs/);
  assert.match(built.context, /Events already provided by describe: <none>/);

  const truncated = buildResourceContext(
    resourceRequest({ describe: "x".repeat(10000) }),
    1200,
  );
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
  const completion = await chatCompletion(settings(baseUrl), messages);

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
  const base = settings("http://127.0.0.1:12345");
  const response = (body) => async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body);
    },
  });

  await assert.rejects(
    chatCompletion(base, [], response({ choices: [{ message: { content: "" } }] })),
    (error) => error instanceof LlmClientError && error.code === "LLM_EMPTY_RESPONSE",
  );
  await assert.rejects(
    chatCompletion(
      base,
      [],
      response({ choices: [{ finish_reason: "stop", message: { reasoning_content: "thinking" } }] }),
    ),
    (error) =>
      error instanceof LlmClientError && error.code === "LLM_EMPTY_FINAL_RESPONSE",
  );
  await assert.rejects(
    chatCompletion(
      base,
      [],
      response({ choices: [{ finish_reason: "length", message: { reasoning_content: "thinking" } }] }),
    ),
    (error) =>
      error instanceof LlmClientError && error.code === "LLM_OUTPUT_TOKEN_LIMIT",
  );
});

test("LLM settings validation and public status do not expose API key", () => {
  assert.equal(normalizeBaseUrl("http://127.0.0.1:1234/chat/completions"), "http://127.0.0.1:1234/v1");
  assert.throws(
    () => validateLlmSettings(settings("file:///tmp/model")),
    (error) => error.code === "LLM_BASE_URL_INVALID",
  );
  assert.throws(
    () => validateLlmSettings(settings("http://127.0.0.1:1234", { enabled: false })),
    (error) => error.code === "LLM_DISABLED",
  );
  const status = publicLlmStatus(settings("http://127.0.0.1:1234"));
  assert.deepEqual(status, {
    enabled: true,
    configured: true,
    provider: "openai_compatible",
    baseUrl: "http://127.0.0.1:1234",
    model: "test-model",
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
              content:
                '<kubedeck_final>{"conclusion":["Ответ"],"facts":["Факт"],"risks":[],"nextChecks":[],"missing":[]}</kubedeck_final>',
            },
          },
        ],
      }),
    );
  });
  const llmUrl = await listen(llm);
  t.after(() => close(llm));

  const configStore = {
    load() {
      return { settings: { llm: settings(llmUrl) } };
    },
  };
  const logs = [];
  const api = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (!handleLlmRequest(request, response, pathname, configStore, (line) => logs.push(line))) {
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
  assert.equal("apiKey" in status, false);

  const testResponse = await fetch(`${apiUrl}/llm/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const tested = await testResponse.json();
  assert.equal(tested.ok, true);
  assert.equal(tested.model, "test-model");

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
  const configStore = {
    load() {
      return {
        settings: {
          llm: settings("http://127.0.0.1:1", {
            apiKey: secret,
            timeoutSeconds: 1,
          }),
        },
      };
    },
  };
  const logs = [];
  const api = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    handleLlmRequest(request, response, pathname, configStore, (line) => logs.push(line));
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
