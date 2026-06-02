from __future__ import annotations

from typing import Any

import yaml
from fastapi import APIRouter

from .common import *
from .resource_cache import invalidate_after_yaml_apply


router = APIRouter()


def yaml_apply_target(payload: str) -> tuple[str, str, str, int]:
    """Return kind, namespace, name, document_count for a single-object YAML apply payload."""
    try:
        documents = [doc for doc in yaml.safe_load_all(payload) if doc is not None]
    except yaml.YAMLError as exc:
        raise api_error(400, "INVALID_YAML", f"YAML cannot be parsed: {exc}") from exc

    if not documents:
        raise api_error(400, "EMPTY_YAML", "YAML payload must contain one Kubernetes object")
    if len(documents) != 1:
        raise api_error(400, "MULTI_DOCUMENT_APPLY_BLOCKED", "KubeDeck allows YAML apply for one object at a time")

    document = documents[0]
    if not isinstance(document, dict):
        raise api_error(400, "INVALID_YAML_OBJECT", "YAML document must be a Kubernetes object")

    metadata = document.get("metadata") or {}
    if not isinstance(metadata, dict):
        raise api_error(400, "INVALID_YAML_METADATA", "YAML metadata must be an object")

    kind = str(document.get("kind") or "").strip()
    name = str(metadata.get("name") or "").strip()
    namespace = str(metadata.get("namespace") or "_cluster").strip() or "_cluster"

    if not kind:
        raise api_error(400, "INVALID_YAML_KIND", "YAML kind is required")
    name = validate_identifier(name, "metadata.name")
    if namespace != "_cluster":
        namespace = validate_identifier(namespace, "metadata.namespace")

    return kind, namespace, name, len(documents)


@router.post("/clusters/{cluster_id}/yaml/dry-run", response_class=PlainTextResponse)
def dry_run_yaml(cluster_id: str, request: YamlRequest) -> str:
    ensure_payload_size(request.yaml, MAX_APPLY_YAML_BYTES, "YAML payload")
    command = cluster_command(cluster_id, ["apply", "--dry-run=server", "-f", "-", "-o", "yaml"], timeout=45, max_output_bytes=TEXT_MAX_OUTPUT_BYTES)
    try:
        result = runner.run(command, stdin=request.yaml).stdout
        append_audit_event(action="yaml.dry-run", status="success", cluster_id=cluster_id, resource="yaml", command_preview=command.preview, extra={"payloadBytes": len(request.yaml.encode("utf-8", "replace"))})
        return result or "Server dry-run completed successfully."
    except KubectlError as exc:
        append_audit_event(action="yaml.dry-run", status="failed", cluster_id=cluster_id, resource="yaml", command_preview=command.preview, message=exc.info.message)
        raise kubectl_error(exc)

@router.put("/clusters/{cluster_id}/yaml/apply", response_class=PlainTextResponse)
def apply_yaml(cluster_id: str, request: ApplyYamlRequest) -> str:
    ensure_payload_size(request.yaml, MAX_APPLY_YAML_BYTES, "YAML payload")
    kind, namespace, name, document_count = yaml_apply_target(request.yaml)
    require_confirmation(request.confirmation, cluster_id, "apply", "yaml", namespace, name, name)
    command = cluster_command(cluster_id, ["apply", "-f", "-"], timeout=45, max_output_bytes=TEXT_MAX_OUTPUT_BYTES)
    try:
        result = runner.run(command, stdin=request.yaml).stdout
        invalidate_after_yaml_apply(cluster_id, kind, namespace)
        append_audit_event(
            action="yaml.apply",
            status="success",
            cluster_id=cluster_id,
            namespace=namespace,
            resource="yaml",
            name=name,
            command_preview=command.preview,
            extra={"payloadBytes": len(request.yaml.encode("utf-8", "replace")), "kind": kind, "documents": document_count},
        )
        return result
    except KubectlError as exc:
        append_audit_event(action="yaml.apply", status="failed", cluster_id=cluster_id, namespace=namespace, resource="yaml", name=name, command_preview=command.preview, message=exc.info.message, extra={"kind": kind, "documents": document_count})
        raise kubectl_error(exc)
