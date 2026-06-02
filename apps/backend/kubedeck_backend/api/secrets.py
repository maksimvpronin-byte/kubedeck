from __future__ import annotations

import base64
import binascii
from typing import Any

from pydantic import BaseModel

from kubedeck_backend.api.runtime import cluster_command, runner, store
from kubedeck_backend.api.validation import api_error, validate_identifier
from kubedeck_backend.core.audit import append_audit_event
from kubedeck_backend.kubectl.command import KubectlError

SECRET_JSON_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
SECRET_VALUE_MAX_BYTES = 2 * 1024 * 1024


class SecretRevealRequest(BaseModel):
    key: str


class SecretCopyAuditRequest(BaseModel):
    key: str


def secret_reveal_timeout_seconds() -> int:
    try:
        return max(1, min(300, int(store.load().settings.secretRevealTimeoutSeconds)))
    except Exception:
        return 30


def load_secret_raw(cluster_id: str, namespace: str, name: str) -> dict[str, Any]:
    command = cluster_command(
        cluster_id,
        ["get", "secret", name, "-n", namespace, "-o", "json"],
        timeout=30,
        max_output_bytes=SECRET_JSON_MAX_OUTPUT_BYTES,
    )
    payload = runner.run_json(command)
    if not isinstance(payload, dict):
        raise api_error(500, "INVALID_SECRET_PAYLOAD", "kubectl returned an invalid Secret payload", command_preview=command.preview)
    return payload


def secret_keys_response(cluster_id: str, namespace: str, name: str) -> dict[str, Any]:
    secret = load_secret_raw(cluster_id, namespace, name)
    data = secret_data_map(secret)
    keys: list[dict[str, Any]] = []
    for key in sorted(data):
        encoded = data.get(key) or ""
        encoded_bytes = len(encoded.encode("utf-8", "replace"))
        decoded_bytes = 0
        valid_base64 = True
        binary = False
        try:
            decoded = base64.b64decode(encoded.encode("utf-8"), validate=True)
            decoded_bytes = len(decoded)
            binary = is_binary_payload(decoded)
        except (binascii.Error, ValueError):
            valid_base64 = False
        keys.append({
            "key": key,
            "encodedBytes": encoded_bytes,
            "decodedBytes": decoded_bytes,
            "validBase64": valid_base64,
            "binary": binary,
        })

    metadata = secret.get("metadata") or {}
    return {
        "type": str(secret.get("type") or "Opaque"),
        "immutable": bool(secret.get("immutable", False)),
        "namespace": str(metadata.get("namespace") or namespace),
        "name": str(metadata.get("name") or name),
        "keys": keys,
        "revealTimeoutSeconds": secret_reveal_timeout_seconds(),
    }


def reveal_secret_key(cluster_id: str, namespace: str, name: str, key: str) -> dict[str, Any]:
    safe_key = validate_secret_key(key)
    secret = load_secret_raw(cluster_id, namespace, name)
    data = secret_data_map(secret)
    if safe_key not in data:
        raise api_error(404, "SECRET_KEY_NOT_FOUND", f"Secret key was not found: {safe_key}")

    encoded = data.get(safe_key) or ""
    try:
        decoded = base64.b64decode(encoded.encode("utf-8"), validate=True)
    except (binascii.Error, ValueError):
        append_audit_event(
            action="secret.reveal",
            status="failed",
            cluster_id=cluster_id,
            namespace=namespace,
            resource="secrets",
            name=name,
            message="invalid base64 data",
            extra={"key": safe_key},
        )
        raise api_error(400, "SECRET_VALUE_INVALID_BASE64", f"Secret key is not valid base64 data: {safe_key}")

    if len(decoded) > SECRET_VALUE_MAX_BYTES:
        append_audit_event(
            action="secret.reveal",
            status="failed",
            cluster_id=cluster_id,
            namespace=namespace,
            resource="secrets",
            name=name,
            message="secret value too large to reveal",
            extra={"key": safe_key, "decodedBytes": len(decoded)},
        )
        raise api_error(413, "SECRET_VALUE_TOO_LARGE", f"Secret value is too large to reveal safely ({len(decoded)} bytes)")

    value = decoded.decode("utf-8", "replace")
    binary = is_binary_payload(decoded)
    append_audit_event(
        action="secret.reveal",
        status="success",
        cluster_id=cluster_id,
        namespace=namespace,
        resource="secrets",
        name=name,
        extra={"key": safe_key, "decodedBytes": len(decoded), "binary": binary},
    )
    return {
        "key": safe_key,
        "value": value,
        "decodedBytes": len(decoded),
        "binary": binary,
        "revealTimeoutSeconds": secret_reveal_timeout_seconds(),
    }


def audit_secret_copy(cluster_id: str, namespace: str, name: str, key: str) -> dict[str, bool]:
    safe_key = validate_secret_key(key)
    append_audit_event(
        action="secret.copy",
        status="success",
        cluster_id=cluster_id,
        namespace=namespace,
        resource="secrets",
        name=name,
        extra={"key": safe_key},
    )
    return {"ok": True}


def secret_data_map(secret: dict[str, Any]) -> dict[str, str]:
    data = secret.get("data") or {}
    if not isinstance(data, dict):
        return {}
    return {str(key): str(value) for key, value in data.items() if key is not None}


def validate_secret_key(value: str) -> str:
    return validate_identifier(value, "secret key", max_length=512)


def is_binary_payload(value: bytes) -> bool:
    if not value:
        return False
    if b"\x00" in value:
        return True
    text_bytes = sum(1 for byte in value if byte in b"\n\r\t" or 32 <= byte <= 126)
    return (text_bytes / len(value)) < 0.85
