import type { IncomingMessage, ServerResponse } from "node:http";
import type { ConfigStore } from "../config/configStore";
import type { LlmSettings } from "../config/types";
import { writeError } from "../errors";
import { writeJson } from "../http";
import { chatCompletion, LlmClientError, validateLlmSettings } from "../llm/client";
import { buildResourceContext } from "../llm/context";
import { buildUserPrompt, SYSTEM_PROMPT } from "../llm/prompts";
import type {
  LlmAnalyzeResourceRequest,
  LlmMessage,
  LlmPromptBuildResult,
  LlmTestRequest,
} from "../llm/types";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_IDENTITY_CHARS = 512;
const MAX_USER_REQUEST_CHARS = 20_000;

class LlmRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function requiredString(
  value: unknown,
  field: string,
  maximum = MAX_IDENTITY_CHARS,
): string {
  const text = asString(value).trim();
  if (!text) {
    throw new LlmRequestError(400, "INVALID_LLM_REQUEST", `${field} is required`);
  }
  if (text.length > maximum) {
    throw new LlmRequestError(
      400,
      "INVALID_LLM_REQUEST",
      `${field} must be at most ${maximum} characters`,
    );
  }
  return text;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new LlmRequestError(
        413,
        "REQUEST_TOO_LARGE",
        `LLM request body exceeds ${MAX_REQUEST_BYTES} bytes`,
      );
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new LlmRequestError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

function normalizeAnalyzeRequest(value: unknown): LlmAnalyzeResourceRequest {
  if (!isRecord(value)) {
    throw new LlmRequestError(400, "INVALID_LLM_REQUEST", "Request body must be an object");
  }
  const userRequest = asString(value.userRequest).trim();
  if (userRequest.length > MAX_USER_REQUEST_CHARS) {
    throw new LlmRequestError(
      400,
      "INVALID_LLM_REQUEST",
      `userRequest must be at most ${MAX_USER_REQUEST_CHARS} characters`,
    );
  }
  return {
    clusterId: requiredString(value.clusterId, "clusterId"),
    resource: requiredString(value.resource, "resource"),
    kind: asString(value.kind).trim() || undefined,
    namespace: asString(value.namespace).trim() || undefined,
    name: requiredString(value.name, "name"),
    resourceObject: isRecord(value.resourceObject) ? value.resourceObject : {},
    yaml: asString(value.yaml),
    events: Array.isArray(value.events) ? value.events : undefined,
    describe: asString(value.describe),
    logs: asString(value.logs),
    previousLogs: asString(value.previousLogs),
    relatedResources: Array.isArray(value.relatedResources)
      ? value.relatedResources
      : undefined,
    relatedLinks: Array.isArray(value.relatedLinks) ? value.relatedLinks : undefined,
    related: Array.isArray(value.related) ? value.related : undefined,
    userRequest: userRequest || undefined,
    language: asString(value.language).trim() || "ru",
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mergeSettings(
  base: LlmSettings,
  candidate: Partial<LlmSettings> | undefined,
): LlmSettings {
  if (!candidate || !isRecord(candidate)) return { ...base };
  return {
    enabled:
      typeof candidate.enabled === "boolean" ? candidate.enabled : base.enabled,
    provider:
      typeof candidate.provider === "string"
        ? (candidate.provider as LlmSettings["provider"])
        : base.provider,
    baseUrl: asString(candidate.baseUrl, base.baseUrl).trim(),
    model: asString(candidate.model, base.model).trim(),
    apiKey: asString(candidate.apiKey, base.apiKey).trim(),
    temperature: Math.min(
      2,
      Math.max(0, finiteNumber(candidate.temperature, base.temperature)),
    ),
    timeoutSeconds: Math.min(
      600,
      Math.max(1, Math.trunc(finiteNumber(candidate.timeoutSeconds, base.timeoutSeconds))),
    ),
    maxContextChars: Math.min(
      250_000,
      Math.max(
        1_000,
        Math.trunc(finiteNumber(candidate.maxContextChars, base.maxContextChars)),
      ),
    ),
    maxOutputTokens: Math.min(
      65_536,
      Math.max(
        1,
        Math.trunc(finiteNumber(candidate.maxOutputTokens, base.maxOutputTokens)),
      ),
    ),
  };
}

export function publicLlmStatus(settings: LlmSettings): {
  enabled: boolean;
  configured: boolean;
  provider: LlmSettings["provider"];
  baseUrl: string;
  model: string;
} {
  return {
    enabled: settings.enabled,
    configured: Boolean(settings.baseUrl.trim() && settings.model.trim()),
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
  };
}

export function buildLlmPrompt(
  settings: LlmSettings,
  request: LlmAnalyzeResourceRequest,
): LlmPromptBuildResult {
  const built = buildResourceContext(request, settings.maxContextChars);
  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(built.context, request.userRequest) },
  ];
  return {
    messages,
    context: built.context,
    contextChars: built.contextChars,
    truncated: built.truncated,
    maxOutputTokens: settings.maxOutputTokens,
  };
}

async function handleStatus(
  response: ServerResponse,
  configStore: ConfigStore,
): Promise<void> {
  writeJson(response, publicLlmStatus(configStore.load().settings.llm));
}

async function handleTest(
  request: IncomingMessage,
  response: ServerResponse,
  configStore: ConfigStore,
): Promise<void> {
  const body = (await readJsonBody(request)) as LlmTestRequest;
  const base = configStore.load().settings.llm;
  const settings = mergeSettings(
    base,
    isRecord(body) && isRecord(body.settings)
      ? (body.settings as Partial<LlmSettings>)
      : undefined,
  );
  try {
    validateLlmSettings(settings, false);
    const completion = await chatCompletion(
      { ...settings, enabled: true },
      [
        { role: "system", content: "You are a health check endpoint. Reply with OK." },
        { role: "user", content: "Reply with OK." },
      ],
    );
    writeJson(response, {
      ok: true,
      message: "Connection successful.",
      model: completion.model,
      elapsedMs: completion.elapsedMs,
      status: publicLlmStatus(settings),
    });
  } catch (error) {
    if (error instanceof LlmClientError) {
      writeJson(response, {
        ok: false,
        code: error.code,
        message: error.publicMessage,
        status: publicLlmStatus(settings),
      });
      return;
    }
    throw error;
  }
}

async function handlePreview(
  request: IncomingMessage,
  response: ServerResponse,
  configStore: ConfigStore,
): Promise<void> {
  const input = normalizeAnalyzeRequest(await readJsonBody(request));
  const settings = configStore.load().settings.llm;
  writeJson(response, buildLlmPrompt(settings, input));
}

async function handleAnalyze(
  request: IncomingMessage,
  response: ServerResponse,
  configStore: ConfigStore,
): Promise<void> {
  const input = normalizeAnalyzeRequest(await readJsonBody(request));
  const settings = configStore.load().settings.llm;
  const prompt = buildLlmPrompt(settings, input);
  const completion = await chatCompletion(settings, prompt.messages);
  writeJson(response, {
    answer: completion.answer,
    model: completion.model,
    elapsedMs: completion.elapsedMs,
    contextChars: prompt.contextChars,
    truncated: prompt.truncated,
    maxOutputTokens: settings.maxOutputTokens,
  });
}

function writeRouteError(
  response: ServerResponse,
  error: unknown,
  log: (message: string) => void,
): void {
  if (error instanceof LlmRequestError) {
    writeError(response, error.statusCode, error.code, error.message);
    return;
  }
  if (error instanceof LlmClientError) {
    log(`gateway llm request failed code=${error.code}`);
    writeError(response, 400, error.code, error.publicMessage);
    return;
  }
  log(
    `gateway llm request failed: ${
      error instanceof Error ? error.name : "unknown error"
    }`,
  );
  writeError(response, 500, "LLM_REQUEST_FAILED", "Unable to process LLM request");
}

export function handleLlmRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  configStore: ConfigStore,
  log: (message: string) => void,
): boolean {
  let operation: Promise<void> | null = null;
  if (request.method === "GET" && pathname === "/llm/status") {
    operation = handleStatus(response, configStore);
  } else if (request.method === "POST" && pathname === "/llm/test") {
    operation = handleTest(request, response, configStore);
  } else if (
    request.method === "POST" &&
    pathname === "/llm/preview-resource-prompt"
  ) {
    operation = handlePreview(request, response, configStore);
  } else if (
    request.method === "POST" &&
    pathname === "/llm/analyze-resource"
  ) {
    operation = handleAnalyze(request, response, configStore);
  } else {
    return false;
  }

  void operation.catch((error) => writeRouteError(response, error, log));
  return true;
}
