from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from kubedeck_backend.core.paths import ensure_app_dirs
from kubedeck_backend.logging_config import sanitize_log_text

log = logging.getLogger(__name__)
_LOCK = threading.Lock()
MAX_AUDIT_LINE_BYTES = 32 * 1024
DEFAULT_AUDIT_LIMIT = 200
MAX_AUDIT_LIMIT = 1000


def audit_path() -> Path:
    return ensure_app_dirs()["logs"] / "audit.jsonl"


def append_audit_event(
    *,
    action: str,
    status: str,
    cluster_id: str = "",
    namespace: str = "",
    resource: str = "",
    name: str = "",
    command_preview: str = "",
    message: str = "",
    extra: dict[str, Any] | None = None,
) -> None:
    """Append a bounded JSONL audit event.

    The audit log intentionally stores command previews and metadata only. It must
    never store resource YAML, exec output, secret values, or terminal payloads.
    """
    event: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "action": sanitize_log_text(action)[:128],
        "status": sanitize_log_text(status)[:32],
        "clusterId": sanitize_log_text(cluster_id)[:256],
        "namespace": sanitize_log_text(namespace)[:256],
        "resource": sanitize_log_text(resource)[:256],
        "name": sanitize_log_text(name)[:512],
        "commandPreview": sanitize_log_text(command_preview)[:4000],
        "message": sanitize_log_text(message)[:1000],
        "extra": sanitize_extra(extra or {}),
    }
    line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    encoded = line.encode("utf-8", "replace")
    if len(encoded) > MAX_AUDIT_LINE_BYTES:
        event["commandPreview"] = "[truncated]"
        event["message"] = "[truncated]"
        event["extra"] = {"truncated": True}
        line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))

    try:
        path = audit_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with _LOCK:
            with path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
    except Exception as exc:
        # Audit logging must not break Kubernetes operations.
        log.warning("failed to write audit event action=%s status=%s: %s", action, status, exc)


def read_audit_events(limit: int = DEFAULT_AUDIT_LIMIT) -> list[dict[str, Any]]:
    safe_limit = max(1, min(MAX_AUDIT_LIMIT, int(limit or DEFAULT_AUDIT_LIMIT)))
    path = audit_path()
    if not path.exists():
        return []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()[-safe_limit:]
    except Exception as exc:
        log.warning("failed to read audit log: %s", exc)
        return []
    events: list[dict[str, Any]] = []
    for line in reversed(lines):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            events.append(payload)
    return events


def sanitize_extra(extra: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for key, value in extra.items():
        key_text = sanitize_log_text(str(key))[:128]
        if isinstance(value, (str, int, float, bool)) or value is None:
            clean[key_text] = sanitize_log_text(str(value))[:1000] if isinstance(value, str) else value
        elif isinstance(value, list):
            clean[key_text] = [sanitize_log_text(str(item))[:300] for item in value[:20]]
        else:
            clean[key_text] = sanitize_log_text(str(value))[:1000]
    return clean
