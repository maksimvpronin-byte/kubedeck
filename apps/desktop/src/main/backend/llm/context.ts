import type { LlmAnalyzeResourceRequest } from "./types";

export const REDACTED = "[REDACTED]";
export const TRUNCATED_MARKER = "[TRUNCATED]";

const SENSITIVE_KEY_RE = /(token|password|passwd|pass|secret|key|credential|auth|bearer|private|certificate)/i;
const SECRET_ASSIGNMENT_RE = /\b(authorization|bearer|token|password|passwd|secret|api[_-]?key|private[_-]?key|client[_-]?secret|certificate)\b\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_TOKEN_RE = /\bbearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PRIVATE_KEY_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi;
const CERTIFICATE_RE = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gi;
const DIAGNOSTIC_LINE_RE = /(last state|state:|reason:|exit code|signal|oom|killed|evict|restart|back-off|crash|failed|error|warning|unhealthy|liveness|readiness|startup|probe|qos class|limits:|requests:|node:)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sensitiveKey(key: string): boolean {
  return Boolean(key && SENSITIVE_KEY_RE.test(key));
}

function lineHasSensitiveAssignment(line: string): boolean {
  const stripped = line.trim();
  if (!stripped || stripped.startsWith("#")) return false;
  const separator = stripped.includes(":") ? ":" : stripped.includes("=") ? "=" : "";
  if (!separator) return false;
  return sensitiveKey(stripped.split(separator, 1)[0] ?? "");
}

export function sanitizeText(text: string): string {
  if (!text) return "";
  let sanitized = String(text)
    .replace(PRIVATE_KEY_RE, REDACTED)
    .replace(CERTIFICATE_RE, REDACTED)
    .replace(BEARER_TOKEN_RE, REDACTED)
    .replace(SECRET_ASSIGNMENT_RE, (_match, key: string) => `${key}: ${REDACTED}`);

  sanitized = sanitized
    .split(/\r?\n/)
    .map((line) => {
      if (!lineHasSensitiveAssignment(line)) return line;
      const separatorIndex = (() => {
        const colon = line.indexOf(":");
        const equal = line.indexOf("=");
        if (colon < 0) return equal;
        if (equal < 0) return colon;
        return Math.min(colon, equal);
      })();
      if (separatorIndex < 0) return REDACTED;
      const indent = line.slice(0, line.length - line.trimStart().length);
      const key = line.slice(0, separatorIndex).trim();
      return `${indent}${key}: ${REDACTED}`;
    })
    .join("\n");

  return sanitized;
}

export function sanitizeValue(value: unknown, parentKey = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, parentKey));
  }
  if (isRecord(value)) {
    const kind = String(value.kind ?? "").toLocaleLowerCase();
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (
        (kind === "secret" && (key === "data" || key === "stringData")) ||
        sensitiveKey(key) ||
        sensitiveKey(parentKey)
      ) {
        sanitized[key] = REDACTED;
      } else {
        sanitized[key] = sanitizeValue(item, key);
      }
    }
    return sanitized;
  }
  return typeof value === "string" ? sanitizeText(value) : value;
}

function jsonExcerpt(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value) && value.length === 0) return "";
  if (isRecord(value) && Object.keys(value).length === 0) return "";
  try {
    return JSON.stringify(sanitizeValue(value), null, 2);
  } catch {
    return "";
  }
}

function compactText(text: string, maxChars: number, keepTail = false): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const marker = `\n${TRUNCATED_MARKER}\n`;
  const budget = maxChars - marker.length;
  if (budget <= 0) return TRUNCATED_MARKER;
  return keepTail
    ? `${marker}${text.slice(-budget).trimStart()}`
    : `${text.slice(0, budget).trimEnd()}${marker}`;
}

function logsTail(logs: string, count = 5): string {
  const lines = sanitizeText(logs)
    .split(/\r?\n/)
    .filter((line) => line.trim());
  return lines.slice(-count).join("\n");
}

function dedupe(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = line.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstMatch(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  return match?.[1]?.trim() ?? "";
}

function snippetAround(text: string, pattern: RegExp, before = 0, after = 8): string {
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    pattern.lastIndex = 0;
    if (!pattern.test(lines[index])) continue;
    return lines
      .slice(Math.max(0, index - before), Math.min(lines.length, index + after + 1))
      .join("\n");
  }
  return "";
}

function resourceIdentity(request: LlmAnalyzeResourceRequest): string {
  return [
    `cluster: ${request.clusterId ?? ""}`,
    `resource: ${request.resource ?? ""}`,
    `kind: ${request.kind || request.resource || ""}`,
    `namespace: ${request.namespace || "_cluster"}`,
    `name: ${request.name ?? ""}`,
    `language: ${request.language || "ru"}`,
  ].join("\n");
}

function healthSummary(request: LlmAnalyzeResourceRequest): string {
  const value = sanitizeValue(request.resourceObject ?? {});
  const object = isRecord(value) ? value : {};
  const lines: string[] = [];
  for (const key of ["phase", "status", "ready", "restarts", "node", "podIP", "age"]) {
    const item = object[key];
    if (item !== undefined && item !== null && item !== "" && typeof item !== "object") {
      lines.push(`${key}: ${String(item)}`);
    }
  }
  const status = isRecord(object.status) ? object.status : {};
  for (const key of ["phase", "podIP", "hostIP", "startTime", "qosClass"]) {
    const item = status[key];
    if (item !== undefined && item !== null && item !== "") {
      lines.push(`${key}: ${String(item)}`);
    }
  }
  const spec = isRecord(object.spec) ? object.spec : {};
  if (spec.nodeName && !lines.some((line) => line.startsWith("node:"))) {
    lines.push(`node: ${String(spec.nodeName)}`);
  }
  return dedupe(lines).join("\n");
}

function diagnosticSignals(request: LlmAnalyzeResourceRequest): string {
  const describe = request.describe ?? "";
  const yaml = request.yaml ?? "";
  const combined = [describe, yaml, jsonExcerpt(request.resourceObject)].join("\n");
  const lines: string[] = [];

  const restarts =
    firstMatch(combined, /^\s*Restart Count:\s*(.+)$/im) ||
    firstMatch(combined, /^\s*restartCount:\s*(.+)$/im);
  if (restarts) lines.push(`restartCount: ${restarts}`);

  const lastState = snippetAround(
    combined,
    /^\s*(Last State:\s*.+|lastState:\s*)$/im,
    0,
    8,
  );
  if (lastState) lines.push(`lastState/status snippet:\n${sanitizeText(lastState)}`);

  const exitCode =
    firstMatch(combined, /^\s*Exit Code:\s*(.+)$/im) ||
    firstMatch(combined, /^\s*exitCode:\s*(.+)$/im);
  if (exitCode) lines.push(`exitCode: ${exitCode}`);

  const reason =
    firstMatch(combined, /^\s*Reason:\s*(.+)$/im) ||
    firstMatch(combined, /^\s*reason:\s*(.+)$/im);
  if (reason) lines.push(`reason: ${reason}`);

  const qos =
    firstMatch(combined, /^\s*QoS Class:\s*(.+)$/im) ||
    firstMatch(combined, /^\s*qosClass:\s*(.+)$/im);
  if (qos) lines.push(`qosClass: ${qos}`);

  const diagnosticLines = combined
    .split(/\r?\n/)
    .filter((line) => DIAGNOSTIC_LINE_RE.test(line))
    .slice(0, 24)
    .map((line) => sanitizeText(line.trim()));
  lines.push(...diagnosticLines);

  if (request.previousLogs?.trim()) {
    lines.push("previousLogs: provided, tail -5 sent");
  } else if (request.logs?.trim()) {
    lines.push("previousLogs: absent; current logs tail -5 sent as fallback");
  } else {
    lines.push("logs: not provided");
  }

  if (request.events && request.events.length > 0) {
    lines.push("events: provided");
  } else if (describeEventsNone(describe)) {
    lines.push("events: provided_empty_from_describe");
  } else if (describeHasEvents(describe)) {
    lines.push("events: provided_from_describe");
  } else {
    lines.push("events: missing");
  }

  return dedupe(lines).join("\n");
}

function relatedPayload(request: LlmAnalyzeResourceRequest): unknown {
  for (const value of [request.relatedResources, request.relatedLinks, request.related]) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return undefined;
}

function contextCoverage(request: LlmAnalyzeResourceRequest): string {
  const describe = request.describe ?? "";
  const previousLogs = request.previousLogs ?? "";
  const logs = request.logs ?? "";
  const related = relatedPayload(request);
  const lines = [
    `describe: ${describe.trim() ? "provided_full" : "missing"}`,
    `yaml: ${request.yaml?.trim() ? "excerpt_provided" : "missing"}`,
  ];

  if (request.events && request.events.length > 0) {
    lines.push("events: provided_from_events_api");
  } else if (describeEventsNone(describe)) {
    lines.push("events: provided_empty_from_describe");
  } else if (describeHasEvents(describe)) {
    lines.push("events: provided_from_describe");
  } else {
    lines.push("events: missing");
  }

  if (previousLogs.trim()) {
    lines.push("previousLogs: tail_5_provided");
    lines.push("currentLogs: skipped_because_previousLogs_present");
  } else if (logs.trim()) {
    lines.push("previousLogs: missing");
    lines.push("currentLogs: fallback_tail_5_provided");
  } else {
    lines.push("previousLogs: missing");
    lines.push("currentLogs: missing");
  }

  lines.push(
    related ? "relatedResources: summary_provided_not_full_manifests" : "relatedResources: missing",
  );
  lines.push("rule: do not ask to check a source marked provided; analyze its provided content instead");
  lines.push("rule: if events are provided_empty_from_describe, say warning events are absent, not missing");
  return lines.join("\n");
}

function statusConditions(resourceObject: Record<string, unknown>): string {
  const object = sanitizeValue(resourceObject);
  if (!isRecord(object)) return "";
  const status = isRecord(object.status) ? object.status : undefined;
  if (status) {
    const payload: Record<string, unknown> = {};
    for (const key of [
      "phase",
      "conditions",
      "containerStatuses",
      "initContainerStatuses",
      "qosClass",
    ]) {
      const value = status[key];
      if (value !== undefined && value !== null && value !== "") payload[key] = value;
    }
    return jsonExcerpt(payload);
  }
  return jsonExcerpt(object.conditions);
}

function containers(request: LlmAnalyzeResourceRequest): string {
  const object = sanitizeValue(request.resourceObject);
  const payload: Record<string, unknown> = {};
  if (isRecord(object)) {
    const status = isRecord(object.status) ? object.status : {};
    const spec = isRecord(object.spec) ? object.spec : {};
    for (const key of ["containerStatuses", "initContainerStatuses"]) {
      if (status[key]) payload[key] = status[key];
    }
    for (const key of ["containers", "initContainers"]) {
      if (spec[key]) payload[key] = spec[key];
    }
  }
  if (Object.keys(payload).length > 0) return jsonExcerpt(payload);

  const snippets: string[] = [];
  const yamlStatus = snippetAround(
    request.yaml ?? "",
    /^\s*(containerStatuses|initContainerStatuses):\s*$/im,
    0,
    80,
  );
  if (yamlStatus) snippets.push(`yaml container status snippet:\n${sanitizeText(yamlStatus)}`);
  const describeContainers = snippetAround(
    request.describe ?? "",
    /^\s*Containers:\s*$/im,
    0,
    80,
  );
  if (describeContainers) {
    snippets.push(`describe containers snippet:\n${sanitizeText(describeContainers)}`);
  }
  return snippets.join("\n\n");
}

function eventWeight(item: unknown): number {
  const text = typeof item === "string" ? item : jsonExcerpt(item);
  return /(warning|failed|backoff|unhealthy)/i.test(text) ? 0 : 1;
}

function eventsExcerpt(events: unknown[] | undefined): string {
  if (!events?.length) return "";
  return jsonExcerpt([...events].sort((left, right) => eventWeight(left) - eventWeight(right)));
}

function describeHasEvents(describe: string): boolean {
  return Boolean(describe && /^\s*Events:\s*/im.test(describe));
}

function describeEventsNone(describe: string): boolean {
  if (!describe) return false;
  if (/^\s*Events:\s*<none>\s*$/im.test(describe)) return true;
  const lines = describe.split(/\r?\n/);
  const index = lines.findIndex((line) => /^\s*Events:\s*$/i.test(line));
  if (index < 0) return false;
  return lines.slice(index + 1, index + 5).some((line) => line.toLocaleLowerCase().includes("<none>"));
}

function eventsFromDescribe(describe: string): string {
  if (!describe) return "";
  const lines = describe.split(/\r?\n/);
  const index = lines.findIndex((line) => /^\s*Events:\s*/i.test(line));
  if (index < 0) return "";
  if (/^\s*Events:\s*<none>\s*$/i.test(lines[index])) {
    return "Events already provided by describe: <none>.";
  }
  return sanitizeText(lines.slice(index).join("\n").trim());
}

function yamlExcerpt(request: LlmAnalyzeResourceRequest): string {
  if (request.yaml) return compactText(sanitizeText(request.yaml), 4000);
  return compactText(jsonExcerpt(request.resourceObject), 4000);
}

export interface ResourceContextResult {
  context: string;
  contextChars: number;
  truncated: boolean;
}

export function buildResourceContext(
  request: LlmAnalyzeResourceRequest,
  maxChars: number,
): ResourceContextResult {
  const previousLogs = request.previousLogs ?? "";
  const currentLogs = request.logs ?? "";
  const describe = request.describe ?? "";
  const related = relatedPayload(request);
  const sections: Array<[string, string]> = [
    ["RESOURCE IDENTITY", resourceIdentity(request)],
    ["HEALTH SUMMARY", healthSummary(request)],
    ["DIAGNOSTIC SIGNALS", diagnosticSignals(request)],
    ["CONTEXT COVERAGE", contextCoverage(request)],
    ["STATUS / CONDITIONS", statusConditions(request.resourceObject ?? {})],
    ["CONTAINERS", containers(request)],
    [
      "EVENTS (warnings first; if <none>, events are already checked and empty)",
      eventsExcerpt(request.events) || eventsFromDescribe(describe),
    ],
    [
      "LOGS POLICY",
      "previous container logs: tail -5 only; current logs: tail -5 fallback only if previous logs are absent",
    ],
    ["PREVIOUS CONTAINER LOGS TAIL -5", logsTail(previousLogs, 5)],
    ["CURRENT CONTAINER LOGS TAIL -5 FALLBACK", previousLogs ? "" : logsTail(currentLogs, 5)],
    ["DESCRIBE FULL ALREADY PROVIDED", sanitizeText(describe)],
    ["YAML EXCERPT", yamlExcerpt(request)],
    [
      "RELATED RESOURCES SUMMARY (not full manifests unless explicitly shown)",
      jsonExcerpt(related),
    ],
  ];

  const context = sections
    .map(([title, body]) => `${title}\n${body || "Not provided."}`)
    .join("\n\n");
  const limit = Number.isFinite(maxChars) ? Math.trunc(maxChars) : 60_000;
  if (limit <= 0 || context.length <= limit) {
    return { context, contextChars: context.length, truncated: false };
  }
  const truncated = `${context.slice(0, Math.max(0, limit - TRUNCATED_MARKER.length - 1)).trimEnd()}\n${TRUNCATED_MARKER}`;
  return { context: truncated, contextChars: truncated.length, truncated: true };
}
