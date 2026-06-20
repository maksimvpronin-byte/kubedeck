from __future__ import annotations

import json
import re
from typing import Any

from kubedeck_backend.core.models import LlmAnalyzeResourceRequest

REDACTED = "[REDACTED]"
TRUNCATED_MARKER = "[TRUNCATED]"

SENSITIVE_KEY_RE = re.compile(
    r"(TOKEN|PASSWORD|PASS|SECRET|KEY|CREDENTIAL|AUTH|BEARER|PRIVATE)",
    re.IGNORECASE,
)
SECRET_VALUE_RE = re.compile(
    r"(?i)\b(authorization|bearer|token|password|passwd|secret|api[_-]?key|private[_-]?key)\b\s*[:=]\s*([^\s,;]+)"
)
BEARER_TOKEN_RE = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+")
PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
    re.DOTALL,
)

# Lines that are useful for Kubernetes restart diagnostics.
DIAGNOSTIC_LINE_RE = re.compile(
    r"(?i)(last state|state:|reason:|exit code|signal|oom|killed|evict|restart|back-off|crash|failed|error|warning|unhealthy|liveness|readiness|startup|probe|qos class|limits:|requests:|node:)"
)


def sanitize(value: Any, parent_key: str = "") -> Any:
    if isinstance(value, dict):
        kind = str(value.get("kind") or "")
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            if kind.lower() == "secret" and key_text in {"data", "stringData"}:
                sanitized[key_text] = REDACTED
            elif _is_sensitive_key(key_text) or _is_sensitive_key(parent_key):
                sanitized[key_text] = REDACTED
            else:
                sanitized[key_text] = sanitize(item, key_text)
        return sanitized

    if isinstance(value, list):
        return [sanitize(item, parent_key) for item in value]

    if isinstance(value, str):
        return sanitize_text(value)

    return value


def sanitize_text(text: str) -> str:
    if not text:
        return ""

    sanitized = PRIVATE_KEY_RE.sub(REDACTED, text)
    sanitized = BEARER_TOKEN_RE.sub(REDACTED, sanitized)
    sanitized = SECRET_VALUE_RE.sub(lambda match: f"{match.group(1)}: {REDACTED}", sanitized)

    # Extra safe guard for describe/yaml/env-like lines with sensitive names.
    safe_lines: list[str] = []
    for line in sanitized.splitlines():
        if _line_has_sensitive_assignment(line):
            key = line.split(":", 1)[0] if ":" in line else line.split("=", 1)[0]
            indent = line[: len(line) - len(line.lstrip())]
            safe_lines.append(f"{indent}{key.strip()}: {REDACTED}")
        else:
            safe_lines.append(line)
    return "\n".join(safe_lines)


def build_resource_context(request: LlmAnalyzeResourceRequest, max_chars: int) -> tuple[str, int, bool]:
    """Build the exact sanitized Kubernetes context sent to the local LLM.

    Context policy:
    - Describe is sent in full, because it is the most valuable restart diagnostic source.
    - Logs are intentionally tiny: previous container logs tail -5 only.
    - Current logs are included only as tail -5 fallback when previous logs are absent.
    - YAML is only an excerpt, to avoid duplicating describe/spec/status noise.
    - CONTEXT COVERAGE tells the model what is already provided vs actually missing.
    """

    previous_logs = getattr(request, "previousLogs", "") or ""
    current_logs = getattr(request, "logs", "") or ""
    describe = getattr(request, "describe", "") or ""
    yaml_text = getattr(request, "yaml", "") or ""
    resource_object = getattr(request, "resourceObject", None) or {}
    events = getattr(request, "events", None)
    related = _related_payload(request)

    sections = [
        ("RESOURCE IDENTITY", _resource_identity(request)),
        ("HEALTH SUMMARY", _health_summary(request)),
        ("DIAGNOSTIC SIGNALS", _diagnostic_signals(request, describe, yaml_text, previous_logs, current_logs)),
        ("CONTEXT COVERAGE", _context_coverage(describe, events, previous_logs, current_logs, yaml_text, related)),
        ("STATUS / CONDITIONS", _status_conditions(resource_object)),
        ("CONTAINERS", _containers(resource_object, yaml_text, describe)),
        ("EVENTS (warnings first; if <none>, events are already checked and empty)", _events_excerpt(events) or _events_from_describe(describe)),
        ("LOGS POLICY", "previous container logs: tail -5 only; current logs: tail -5 fallback only if previous logs are absent"),
        ("PREVIOUS CONTAINER LOGS TAIL -5", _logs_tail(previous_logs, 5)),
        ("CURRENT CONTAINER LOGS TAIL -5 FALLBACK", "" if previous_logs else _logs_tail(current_logs, 5)),
        ("DESCRIBE FULL ALREADY PROVIDED", sanitize_text(describe)),
        ("YAML EXCERPT", _yaml_excerpt(yaml_text, resource_object)),
        ("RELATED RESOURCES SUMMARY (not full manifests unless explicitly shown)", _json_excerpt(related)),
    ]

    text = "\n\n".join(f"{title}\n{body or 'Not provided.'}" for title, body in sections)

    if max_chars <= 0 or len(text) <= max_chars:
        return text, len(text), False

    # Keep the beginning where status/signals/previous logs/describe start. If the user wants
    # full describe, increase "Maximum input context" in settings.
    truncated = text[: max(0, max_chars - len(TRUNCATED_MARKER) - 1)].rstrip()
    truncated = f"{truncated}\n{TRUNCATED_MARKER}"
    return truncated, len(truncated), True


def _context_coverage(describe: str, events: Any, previous_logs: str, current_logs: str, yaml_text: str, related: Any) -> str:
    lines: list[str] = []
    lines.append(f"describe: {'provided_full' if describe.strip() else 'missing'}")
    lines.append(f"yaml: {'excerpt_provided' if yaml_text.strip() else 'missing'}")

    if events not in (None, "", [], {}):
        lines.append("events: provided_from_events_api")
    elif _describe_events_none(describe):
        lines.append("events: provided_empty_from_describe")
    elif _describe_has_events_section(describe):
        lines.append("events: provided_from_describe")
    else:
        lines.append("events: missing")

    if previous_logs.strip():
        lines.append("previousLogs: tail_5_provided")
        lines.append("currentLogs: skipped_because_previousLogs_present")
    elif current_logs.strip():
        lines.append("previousLogs: missing")
        lines.append("currentLogs: fallback_tail_5_provided")
    else:
        lines.append("previousLogs: missing")
        lines.append("currentLogs: missing")

    if related not in (None, "", [], {}):
        lines.append("relatedResources: summary_provided_not_full_manifests")
    else:
        lines.append("relatedResources: missing")

    lines.append("rule: do not ask to check a source marked provided; analyze its provided content instead")
    lines.append("rule: if events are provided_empty_from_describe, say warning events are absent, not missing")
    return "\n".join(lines)


def _resource_identity(request: LlmAnalyzeResourceRequest) -> str:
    return "\n".join(
        [
            f"cluster: {getattr(request, 'clusterId', '')}",
            f"resource: {getattr(request, 'resource', '')}",
            f"kind: {getattr(request, 'kind', '') or getattr(request, 'resource', '')}",
            f"namespace: {getattr(request, 'namespace', '') or '_cluster'}",
            f"name: {getattr(request, 'name', '')}",
            f"language: {getattr(request, 'language', '') or 'ru'}",
        ]
    )


def _health_summary(request: LlmAnalyzeResourceRequest) -> str:
    obj = sanitize(getattr(request, "resourceObject", None) or {})
    lines: list[str] = []

    if isinstance(obj, dict):
        for key in ("phase", "status", "ready", "restarts", "node", "podIP", "age"):
            value = obj.get(key)
            if value not in (None, ""):
                lines.append(f"{key}: {value}")

        status = obj.get("status") if isinstance(obj.get("status"), dict) else {}
        if isinstance(status, dict):
            for key in ("phase", "podIP", "hostIP", "startTime", "qosClass"):
                value = status.get(key)
                if value not in (None, ""):
                    lines.append(f"{key}: {value}")

        spec = obj.get("spec") if isinstance(obj.get("spec"), dict) else {}
        if isinstance(spec, dict):
            node_name = spec.get("nodeName")
            if node_name and not any(line.startswith("node:") for line in lines):
                lines.append(f"node: {node_name}")

    return "\n".join(_dedupe(lines))


def _diagnostic_signals(
    request: LlmAnalyzeResourceRequest,
    describe: str,
    yaml_text: str,
    previous_logs: str,
    current_logs: str,
) -> str:
    combined = "\n".join([describe or "", yaml_text or "", _json_excerpt(getattr(request, "resourceObject", None))])
    lines: list[str] = []

    restarts = _first_match(combined, r"(?im)^\s*Restart Count:\s*(.+)$")
    if not restarts:
        restarts = _first_match(combined, r"(?im)^\s*restartCount:\s*(.+)$")
    if restarts:
        lines.append(f"restartCount: {restarts.strip()}")

    last_state = _snippet_around(combined, r"(?im)^\s*Last State:\s*.+$|^\s*lastState:\s*$", before=0, after=8)
    if last_state:
        lines.append("lastState/status snippet:\n" + sanitize_text(last_state))

    exit_code = _first_match(combined, r"(?im)^\s*Exit Code:\s*(.+)$")
    if not exit_code:
        exit_code = _first_match(combined, r"(?im)^\s*exitCode:\s*(.+)$")
    if exit_code:
        lines.append(f"exitCode: {exit_code.strip()}")

    reason = _first_match(combined, r"(?im)^\s*Reason:\s*(.+)$")
    if not reason:
        reason = _first_match(combined, r"(?im)^\s*reason:\s*(.+)$")
    if reason:
        lines.append(f"reason: {reason.strip()}")

    qos = _first_match(combined, r"(?im)^\s*QoS Class:\s*(.+)$")
    if not qos:
        qos = _first_match(combined, r"(?im)^\s*qosClass:\s*(.+)$")
    if qos:
        lines.append(f"qosClass: {qos.strip()}")

    if previous_logs:
        lines.append("previousLogs: provided, tail -5 sent")
    elif current_logs:
        lines.append("previousLogs: absent; current logs tail -5 sent as fallback")
    else:
        lines.append("logs: not provided")

    events = getattr(request, "events", None)
    if events not in (None, "", [], {}):
        lines.append("events: provided")
    elif _describe_events_none(describe):
        lines.append("events: provided_empty_from_describe")
    elif _describe_has_events_section(describe):
        lines.append("events: provided_from_describe")
    else:
        lines.append("events: missing")

    return "\n".join(_dedupe(lines))


def _status_conditions(resource_object: Any) -> str:
    obj = sanitize(resource_object)
    if isinstance(obj, dict):
        status = obj.get("status") if isinstance(obj.get("status"), dict) else None
        if isinstance(status, dict):
            payload = {
                "phase": status.get("phase"),
                "conditions": status.get("conditions"),
                "containerStatuses": status.get("containerStatuses"),
                "initContainerStatuses": status.get("initContainerStatuses"),
                "qosClass": status.get("qosClass"),
            }
            compact = {key: value for key, value in payload.items() if value not in (None, "", [], {})}
            return _json_excerpt(compact)
        if obj.get("conditions"):
            return _json_excerpt(obj.get("conditions"))
    return ""


def _containers(resource_object: Any, yaml_text: str = "", describe: str = "") -> str:
    obj = sanitize(resource_object)
    payload: dict[str, Any] = {}

    if isinstance(obj, dict):
        status = obj.get("status") if isinstance(obj.get("status"), dict) else None
        spec = obj.get("spec") if isinstance(obj.get("spec"), dict) else None
        if isinstance(status, dict):
            for key in ("containerStatuses", "initContainerStatuses"):
                if status.get(key):
                    payload[key] = status.get(key)
        if isinstance(spec, dict):
            for key in ("containers", "initContainers"):
                if spec.get(key):
                    payload[key] = spec.get(key)

    if not payload and (yaml_text or describe):
        snippets = []
        yaml_status = _snippet_around(yaml_text, r"(?im)^\s*(containerStatuses|initContainerStatuses):\s*$", before=0, after=80)
        if yaml_status:
            snippets.append("yaml container status snippet:\n" + sanitize_text(yaml_status))
        describe_containers = _snippet_around(describe, r"(?im)^\s*Containers:\s*$", before=0, after=80)
        if describe_containers:
            snippets.append("describe containers snippet:\n" + sanitize_text(describe_containers))
        return "\n\n".join(snippets)

    return _json_excerpt(payload)


def _events_excerpt(events: Any) -> str:
    if events in (None, "", [], {}):
        return ""

    sanitized = sanitize(events)
    if isinstance(sanitized, list):
        def weight(item: Any) -> int:
            text = json.dumps(item, ensure_ascii=False).lower() if not isinstance(item, str) else item.lower()
            return 0 if ("warning" in text or "failed" in text or "backoff" in text or "unhealthy" in text) else 1

        ordered = sorted(sanitized, key=weight)
        return _json_excerpt(ordered)

    return _json_excerpt(sanitized)


def _events_from_describe(describe: str) -> str:
    if not describe:
        return ""
    lines = describe.splitlines()
    for index, line in enumerate(lines):
        if re.match(r"(?im)^\s*Events:\s*$", line):
            block = "\n".join(lines[index:]).strip()
            if block:
                return sanitize_text(block)
        if re.match(r"(?im)^\s*Events:\s*<none>\s*$", line):
            return "Events already provided by describe: <none>."
    return ""


def _describe_has_events_section(describe: str) -> bool:
    return bool(describe and re.search(r"(?im)^\s*Events:\s*", describe))


def _describe_events_none(describe: str) -> bool:
    if not describe:
        return False
    if re.search(r"(?im)^\s*Events:\s*<none>\s*$", describe):
        return True
    lines = describe.splitlines()
    for index, line in enumerate(lines):
        if re.match(r"(?im)^\s*Events:\s*$", line):
            for next_line in lines[index + 1 : index + 5]:
                if "<none>" in next_line.lower():
                    return True
            return False
    return False


def _logs_tail(logs: str, line_count: int = 5) -> str:
    if not logs:
        return ""
    sanitized = sanitize_text(logs)
    lines = [line for line in sanitized.splitlines() if line.strip()]
    if not lines:
        return ""
    return "\n".join(lines[-line_count:])


def _yaml_excerpt(yaml_text: str, resource_object: Any) -> str:
    if yaml_text:
        sanitized = sanitize_text(yaml_text)
        # Keep YAML intentionally short; describe carries the full human-readable diagnostic data.
        return _compact_text(sanitized, max_chars=4000, keep_tail=False)
    return _compact_text(_json_excerpt(resource_object), max_chars=4000, keep_tail=False)


def _related_payload(request: LlmAnalyzeResourceRequest) -> Any:
    for attr in ("relatedResources", "relatedLinks", "related"):
        if hasattr(request, attr):
            value = getattr(request, attr)
            if value not in (None, "", [], {}):
                return value
    return None


def _json_excerpt(value: Any) -> str:
    if value in (None, "", [], {}):
        return ""
    return json.dumps(sanitize(value), ensure_ascii=False, indent=2)


def _compact_text(text: str, max_chars: int, keep_tail: bool = False) -> str:
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    marker = f"\n{TRUNCATED_MARKER}\n"
    budget = max_chars - len(marker)
    if budget <= 0:
        return TRUNCATED_MARKER
    if keep_tail:
        return marker + text[-budget:].lstrip()
    return text[:budget].rstrip() + marker


def _snippet_around(text: str, pattern: str, before: int = 0, after: int = 12) -> str:
    if not text:
        return ""
    lines = text.splitlines()
    regex = re.compile(pattern)
    for index, line in enumerate(lines):
        if regex.search(line):
            start = max(0, index - before)
            end = min(len(lines), index + after + 1)
            return "\n".join(lines[start:end])
    return ""


def _first_match(text: str, pattern: str) -> str:
    if not text:
        return ""
    match = re.search(pattern, text)
    return match.group(1) if match else ""


def _dedupe(lines: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for line in lines:
        key = line.strip()
        if key and key not in seen:
            seen.add(key)
            result.append(line)
    return result


def _is_sensitive_key(key: str) -> bool:
    return bool(key and SENSITIVE_KEY_RE.search(key))


def _line_has_sensitive_assignment(line: str) -> bool:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return False
    if ":" in stripped:
        key = stripped.split(":", 1)[0]
        return _is_sensitive_key(key)
    if "=" in stripped:
        key = stripped.split("=", 1)[0]
        return _is_sensitive_key(key)
    return False
