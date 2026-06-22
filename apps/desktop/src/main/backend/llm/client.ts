import { performance } from "node:perf_hooks";
import type { LlmSettings } from "../config/types";
import { sanitizeText } from "./context";
import type { LlmCompletion, LlmMessage } from "./types";

interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export class LlmClientError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "LlmClientError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeBaseUrl(baseUrl: string): string {
  let value = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!value) {
    throw new LlmClientError("LLM_BASE_URL_MISSING", "LLM API base URL is missing.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new LlmClientError(
      "LLM_BASE_URL_INVALID",
      "LLM API base URL must be an http(s) URL.",
    );
  }
  if (!(["http:", "https:"] as string[]).includes(parsed.protocol) || !parsed.hostname) {
    throw new LlmClientError(
      "LLM_BASE_URL_INVALID",
      "LLM API base URL must be an http(s) URL.",
    );
  }
  if (value.endsWith("/chat/completions")) {
    value = value.slice(0, -"/chat/completions".length).replace(/\/+$/, "");
  }
  if (!value.endsWith("/v1")) value = `${value}/v1`;
  return value;
}

export function validateLlmSettings(
  settings: LlmSettings,
  requireEnabled = true,
): void {
  if (requireEnabled && !settings.enabled) {
    throw new LlmClientError("LLM_DISABLED", "LLM integration is disabled.");
  }
  normalizeBaseUrl(settings.baseUrl);
  if (!String(settings.model ?? "").trim()) {
    throw new LlmClientError("LLM_MODEL_MISSING", "LLM model is missing.");
  }
  if (settings.provider !== "openai_compatible") {
    throw new LlmClientError(
      "LLM_PROVIDER_UNSUPPORTED",
      "Only OpenAI-compatible local APIs are supported.",
    );
  }
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        const record = asRecord(item);
        const value = record?.text ?? record?.content;
        return typeof value === "string" ? value : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  const record = asRecord(content);
  const value = record?.text ?? record?.content;
  return typeof value === "string" ? value : "";
}

function firstChoice(body: unknown): Record<string, unknown> | null {
  const record = asRecord(body);
  const choices = record?.choices;
  return Array.isArray(choices) ? asRecord(choices[0]) : null;
}

function extractContent(body: unknown): string {
  const choice = firstChoice(body);
  if (!choice) return "";
  const message = asRecord(choice.message);
  if (message) return contentToText(message.content).trim();
  return typeof choice.text === "string" ? choice.text.trim() : "";
}

function extractReasoning(body: unknown): string {
  const message = asRecord(firstChoice(body)?.message);
  if (!message) return "";
  for (const key of ["reasoning_content", "reasoning", "thinking"]) {
    const value = message[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function extractFinishReason(body: unknown): string {
  const value = firstChoice(body)?.finish_reason;
  return typeof value === "string" ? value : "";
}

function extractModel(body: unknown, fallback: string): string {
  const model = asRecord(body)?.model;
  return typeof model === "string" && model.trim() ? model : fallback;
}

function extractFinalBlock(text: string): string {
  const match = text.match(/<kubedeck_final>\s*([\s\S]*?)\s*<\/kubedeck_final>/i);
  return match?.[1]?.trim() ?? "";
}

function stripThinking(text: string): string {
  let value = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  for (const marker of ["Thinking Process:", "Reasoning:", "Analysis:"]) {
    const index = value.indexOf(marker);
    if (index >= 0) value = value.slice(0, index).trim();
  }
  return value;
}

function parseJsonAnswer(answer: string): Record<string, unknown> | null {
  const trimmed = answer
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function asStringItems(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => sanitizeText(item).trim())
    .filter(Boolean)
    .slice(0, maximum);
}

function extractContext(messages: LlmMessage[]): string {
  const user = [...messages].reverse().find((message) => message.role === "user");
  if (!user) return "";
  const match = user.content.match(
    /KUBEDECK CONTEXT START\s*([\s\S]*?)\s*KUBEDECK CONTEXT END/i,
  );
  return match?.[1] ?? "";
}

function healthyPodContext(context: string): boolean {
  const target = context.split(/\nRELATED RESOURCES SUMMARY/i, 1)[0] ?? context;
  const running = /(?:^|\n)\s*(?:phase|Phase):\s*Running\b/im.test(target);
  const ready = /(?:^|\n)\s*(?:ready|Ready):\s*(?:1\/1|true)\b/im.test(target);
  const zeroRestarts = /(?:^|\n)\s*(?:restarts|restartCount|Restart Count):\s*0\b/im.test(target);
  const noEvents = /Events(?: already provided by describe)?:?\s*<none>/i.test(target) ||
    /events:\s*provided_empty_from_describe/i.test(target);
  return running && ready && zeroRestarts && noEvents;
}

function renderStandardAnswer(answer: string, messages: LlmMessage[]): string {
  const parsed = parseJsonAnswer(answer);
  if (!parsed) return sanitizeText(answer).trim();

  let conclusion = asStringItems(parsed.conclusion, 2);
  const facts = asStringItems(parsed.facts, 7);
  let risks = asStringItems(parsed.risks, 3);
  let nextChecks = asStringItems(parsed.nextChecks, 3);
  let missing = asStringItems(parsed.missing, 3);

  if (healthyPodContext(extractContext(messages))) {
    if (conclusion.length === 0) {
      conclusion = ["Pod работает стабильно: Running, Ready 1/1, рестартов нет."];
    }
    risks = ["Активных проблем не выявлено."];
    nextChecks = ["Ничего срочного."];
    missing = ["Контекст достаточен для диагностики текущего состояния."];
  }

  const sections: Array<[string, string[], string]> = [
    ["1. Короткий вывод", conclusion, "Вывод не предоставлен."],
    ["2. Факты из контекста", facts, "Факты не предоставлены."],
    ["3. Проблемы / риски", risks, "Активных проблем не выявлено."],
    ["4. Что проверить дальше", nextChecks, "Ничего срочного."],
    [
      "5. Чего не хватает",
      missing,
      "Контекст достаточен для диагностики текущего состояния.",
    ],
  ];

  return sections
    .map(([title, items, fallback]) => `${title}\n${(items.length ? items : [fallback])
      .map((item) => `- ${item}`)
      .join("\n")}`)
    .join("\n\n");
}

export async function chatCompletion(
  settings: LlmSettings,
  messages: LlmMessage[],
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<LlmCompletion> {
  validateLlmSettings(settings);
  const endpoint = `${normalizeBaseUrl(settings.baseUrl)}/chat/completions`;
  const maxOutputTokens = Math.max(
    1,
    Math.min(65_536, Math.trunc(Number(settings.maxOutputTokens) || 4096)),
  );
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = String(settings.apiKey ?? "").trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timeoutSeconds = Math.max(1, Math.min(600, Number(settings.timeoutSeconds) || 60));
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  timer.unref?.();
  const started = performance.now();
  let response: FetchResponseLike;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: settings.temperature,
        max_tokens: maxOutputTokens,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new LlmClientError("LLM_TIMEOUT", "LLM request timed out.");
    }
    throw new LlmClientError("LLM_UNREACHABLE", "LLM server is unreachable.");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new LlmClientError(
      "LLM_HTTP_ERROR",
      `LLM server returned HTTP ${response.status}.`,
    );
  }

  const raw = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new LlmClientError(
      "LLM_INVALID_RESPONSE",
      "LLM response is not valid JSON.",
    );
  }

  const rawAnswer = extractContent(body);
  const reasoning = extractReasoning(body);
  const finishReason = extractFinishReason(body);
  if (!rawAnswer && reasoning && finishReason === "length") {
    throw new LlmClientError(
      "LLM_OUTPUT_TOKEN_LIMIT",
      `LLM reached maxOutputTokens (${maxOutputTokens}) before producing final content. Increase max output tokens or reduce input context.`,
    );
  }
  if (!rawAnswer && reasoning) {
    throw new LlmClientError(
      "LLM_EMPTY_FINAL_RESPONSE",
      "LLM returned only reasoning/thinking without a final answer.",
    );
  }
  if (!rawAnswer) {
    throw new LlmClientError("LLM_EMPTY_RESPONSE", "No LLM response content.");
  }

  let answer = extractFinalBlock(rawAnswer);
  if (!answer) answer = stripThinking(rawAnswer);
  if (!answer) {
    throw new LlmClientError(
      "LLM_EMPTY_FINAL_RESPONSE",
      "LLM final answer is empty after removing reasoning/thinking.",
    );
  }

  return {
    answer: renderStandardAnswer(answer, messages),
    model: extractModel(body, settings.model),
    elapsedMs: Math.max(0, Math.trunc(performance.now() - started)),
  };
}
