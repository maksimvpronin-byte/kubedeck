from __future__ import annotations

import re

from fastapi import HTTPException

from kubedeck_backend.core.models import OperationConfirmation

MAX_LOG_TAIL_LINES = 5000
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9._:-]+$")


def api_error(status_code: int, code: str, message: str, raw_stderr: str = "", command_preview: str = "") -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, "rawStderr": raw_stderr, "commandPreview": command_preview},
    )


def validate_identifier(value: str, field: str, *, max_length: int = 253) -> str:
    text = (value or "").strip()
    if not text:
        raise api_error(400, "INVALID_IDENTIFIER", f"{field} must not be empty")
    if len(text) > max_length:
        raise api_error(400, "INVALID_IDENTIFIER", f"{field} is too long")
    if any(char in text for char in ("/", "\\", "\x00")):
        raise api_error(400, "INVALID_IDENTIFIER", f"{field} contains an invalid path separator")
    if not IDENTIFIER_PATTERN.match(text):
        raise api_error(400, "INVALID_IDENTIFIER", f"{field} contains unsupported characters")
    return text


def normalize_tail_lines(value: int) -> int:
    try:
        tail = int(value)
    except Exception:
        return 500
    return max(1, min(MAX_LOG_TAIL_LINES, tail))


def ensure_payload_size(text: str, max_bytes: int, label: str) -> None:
    size = len((text or "").encode("utf-8", "replace"))
    if size > max_bytes:
        raise api_error(413, "PAYLOAD_TOO_LARGE", f"{label} is too large ({size} bytes, limit {max_bytes} bytes)")


def require_confirmation(
    confirmation: OperationConfirmation | None,
    cluster_id: str,
    action: str,
    resource: str,
    namespace: str,
    name: str,
    expected_typed_name: str | None = None,
) -> None:
    if confirmation is None:
        raise HTTPException(status_code=400, detail={"code": "CONFIRMATION_REQUIRED", "message": f"Confirmation is required for {action}", "rawStderr": "", "commandPreview": ""})
    if confirmation.clusterId != cluster_id:
        raise HTTPException(status_code=400, detail={"code": "CONFIRMATION_CLUSTER_MISMATCH", "message": "Confirmation cluster does not match request", "rawStderr": "", "commandPreview": ""})
    if confirmation.action != action:
        raise HTTPException(status_code=400, detail={"code": "CONFIRMATION_ACTION_MISMATCH", "message": "Confirmation action does not match request", "rawStderr": "", "commandPreview": ""})
    if (confirmation.resource or resource) != resource:
        raise HTTPException(status_code=400, detail={"code": "CONFIRMATION_RESOURCE_MISMATCH", "message": "Confirmation resource does not match request", "rawStderr": "", "commandPreview": ""})
    if (confirmation.namespace or namespace) != namespace:
        raise HTTPException(status_code=400, detail={"code": "CONFIRMATION_NAMESPACE_MISMATCH", "message": "Confirmation namespace does not match request", "rawStderr": "", "commandPreview": ""})
    if (confirmation.name or name) != name:
        raise HTTPException(status_code=400, detail={"code": "CONFIRMATION_NAME_MISMATCH", "message": "Confirmation name does not match request", "rawStderr": "", "commandPreview": ""})
    if expected_typed_name is not None and confirmation.typedName != expected_typed_name:
        raise HTTPException(status_code=400, detail={"code": "CONFIRMATION_TYPED_NAME_MISMATCH", "message": "Typed confirmation value is invalid", "rawStderr": "", "commandPreview": ""})
