from __future__ import annotations

import json
import re
from typing import Any

from kubedeck_backend.core.models import LlmAnalyzeResourceRequest

REDACTED = "<redacted>"
TRUNCATED_MARKER = "[TRUNCATED]"
SENSITIVE_KEY_RE = re.compile(r"(TOKEN|PASSWORD|PASS|SECRET|KEY|CREDENTIAL|AUTH|BEARER|PRIVATE)", re.IGNORECASE)
SECRET_VALUE_RE = re.compile(
    r"(?i)\b(authorization|bearer|token|password|passwd|secret|api[_-]?key|private[_-]?key)\b\s*[:=]\s*([^\s,;]+)"
)
BEARER_TOKEN_RE = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+")
PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
    re.DOTALL,
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
    return sanitized


def build_resource_context(request: LlmAnalyzeResourceRequest, max_chars: int) -> tuple[str, int, bool]:
    sections = [
        ("RESOURCE IDENTITY", _resource_identity(request)),
        ("HEALTH SUMMARY", _health_summary(request)),
        ("STATUS / CONDITIONS", _status_conditions(request.resourceObject)),
        ("CONTAINERS", _containers(request.resourceObject)),
        ("EVENTS", _json_excerpt(request.events)),
        ("DESCRIBE EXCERPT", sanitize_text(request.describe)),
        ("LOGS EXCERPT", _logs_excerpt(request.logs, request.previousLogs)),
        ("YAML EXCERPT", sanitize_text(request.yaml) or _json_excerpt(request.resourceObject)),
        ("RELATED RESOURCES", _json_excerpt(request.relatedResources)),
    ]
    text = "\n\n".join(f"{title}\n{body or 'Not provided.'}" for title, body in sections)
    if len(text) <= max_chars:
        return text, len(text), False
    truncated = text[: max(0, max_chars - len(TRUNCATED_MARKER) - 1)].rstrip()
    truncated = f"{truncated}\n{TRUNCATED_MARKER}"
    return truncated, len(truncated), True


def _resource_identity(request: LlmAnalyzeResourceRequest) -> str:
    return "\n".join(
        [
            f"cluster: {request.clusterId}",
            f"resource: {request.resource}",
            f"kind: {request.kind or request.resource}",
            f"namespace: {request.namespace or '_cluster'}",
            f"name: {request.name}",
            f"language: {request.language or 'ru'}",
        ]
    )


def _health_summary(request: LlmAnalyzeResourceRequest) -> str:
    obj = sanitize(request.resourceObject)
    lines: list[str] = []
    for key in ("phase", "status", "ready", "restarts", "node", "podIP", "age"):
        if isinstance(obj, dict) and obj.get(key) not in (None, ""):
            lines.append(f"{key}: {obj.get(key)}")
    status = obj.get("status") if isinstance(obj, dict) and isinstance(obj.get("status"), dict) else {}
    if isinstance(status, dict):
        for key in ("phase", "podIP", "hostIP", "startTime"):
            if status.get(key):
                lines.append(f"{key}: {status.get(key)}")
    return "\n".join(lines)


def _status_conditions(resource_object: dict[str, Any]) -> str:
    obj = sanitize(resource_object)
    status = obj.get("status") if isinstance(obj, dict) else None
    if isinstance(status, dict):
        conditions = status.get("conditions")
        if conditions:
            return _json_excerpt(conditions)
        return _json_excerpt(status)
    if isinstance(obj, dict) and obj.get("conditions"):
        return _json_excerpt(obj.get("conditions"))
    return ""


def _containers(resource_object: dict[str, Any]) -> str:
    obj = sanitize(resource_object)
    status = obj.get("status") if isinstance(obj, dict) else None
    spec = obj.get("spec") if isinstance(obj, dict) else None
    payload = {
        "containerStatuses": status.get("containerStatuses") if isinstance(status, dict) else None,
        "initContainerStatuses": status.get("initContainerStatuses") if isinstance(status, dict) else None,
        "containers": spec.get("containers") if isinstance(spec, dict) else None,
        "initContainers": spec.get("initContainers") if isinstance(spec, dict) else None,
    }
    compact = {key: value for key, value in payload.items() if value}
    return _json_excerpt(compact)


def _logs_excerpt(logs: str, previous_logs: str) -> str:
    parts = []
    if logs:
        parts.append(f"current logs:\n{sanitize_text(logs)}")
    if previous_logs:
        parts.append(f"previous logs:\n{sanitize_text(previous_logs)}")
    return "\n\n".join(parts)


def _json_excerpt(value: Any) -> str:
    if value in (None, "", [], {}):
        return ""
    return json.dumps(sanitize(value), ensure_ascii=False, indent=2)


def _is_sensitive_key(key: str) -> bool:
    return bool(key and SENSITIVE_KEY_RE.search(key))
