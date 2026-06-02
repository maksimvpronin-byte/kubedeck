import pytest
from fastapi import HTTPException

from kubedeck_backend.api.validation import require_confirmation
from kubedeck_backend.api.routes_yaml import yaml_apply_target
from kubedeck_backend.core.models import OperationConfirmation
from kubedeck_backend.kubectl.command import merge_no_proxy


def test_require_confirmation_accepts_metadata_only_when_typed_name_not_required():
    confirmation = OperationConfirmation(
        clusterId="cluster-1",
        action="delete",
        resource="pods",
        namespace="default",
        name="nginx-123",
        typedName="",
    )

    require_confirmation(confirmation, "cluster-1", "delete", "pods", "default", "nginx-123", None)


def test_require_confirmation_rejects_wrong_typed_name_when_required():
    confirmation = OperationConfirmation(
        clusterId="cluster-1",
        action="apply",
        resource="yaml",
        namespace="default",
        name="nginx-123",
        typedName="wrong-name",
    )

    with pytest.raises(HTTPException) as exc:
        require_confirmation(confirmation, "cluster-1", "apply", "yaml", "default", "nginx-123", "nginx-123")

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "CONFIRMATION_TYPED_NAME_MISMATCH"


def test_yaml_apply_target_extracts_single_object_identity():
    kind, namespace, name, count = yaml_apply_target(
        """
apiVersion: v1
kind: Pod
metadata:
  name: nginx-123
  namespace: default
spec: {}
"""
    )

    assert kind == "Pod"
    assert namespace == "default"
    assert name == "nginx-123"
    assert count == 1


def test_yaml_apply_target_blocks_multi_document_apply():
    payload = """
apiVersion: v1
kind: ConfigMap
metadata:
  name: one
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: two
"""

    with pytest.raises(HTTPException) as exc:
        yaml_apply_target(payload)

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "MULTI_DOCUMENT_APPLY_BLOCKED"


def test_merge_no_proxy_deduplicates_case_insensitively():
    merged = merge_no_proxy("localhost,Example.com", ["localhost", "example.com", "10.0.0.0/8"])

    assert merged == "localhost,Example.com,10.0.0.0/8"
