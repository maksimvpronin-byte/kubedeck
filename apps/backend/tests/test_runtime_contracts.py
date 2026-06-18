from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from kubedeck_backend.api import runtime
from kubedeck_backend.core.models import ErrorInfo
from kubedeck_backend.kubectl.command import KubectlError


def test_kubectl_error_preserves_error_info_detail():
    info = ErrorInfo(
        code="FORBIDDEN",
        message="kubectl command failed",
        rawStderr="Error from server (Forbidden)",
        commandPreview="kubectl get pods",
    )

    exc = runtime.kubectl_error(KubectlError(info))

    assert exc.status_code == 502
    assert exc.detail["code"] == "FORBIDDEN"
    assert exc.detail["message"] == "kubectl command failed"
    assert exc.detail["rawStderr"] == "Error from server (Forbidden)"
    assert exc.detail["commandPreview"] == "kubectl get pods"


def test_cluster_command_builds_kubectl_command_without_running_kubectl(monkeypatch):
    runtime.clear_config_cache()
    config = SimpleNamespace(settings=SimpleNamespace(kubectlPath=r"C:\tools\kubectl.exe"))
    cluster = SimpleNamespace(id="cluster-a", kubeconfigPath=r"C:\kube\config.yaml")

    monkeypatch.setattr(runtime.store, "load", lambda: config)
    monkeypatch.setattr(runtime.store, "get_cluster", lambda cluster_id, loaded_config: cluster)

    command = runtime.cluster_command(
        "cluster-a",
        ["get", "pods", "-o", "json"],
        timeout=45,
        max_output_bytes=12345,
    )

    assert command.cluster_id == "cluster-a"
    assert command.kubeconfig_path == r"C:\kube\config.yaml"
    assert command.kubectl_path == r"C:\tools\kubectl.exe"
    assert command.args == ["get", "pods", "-o", "json"]
    assert command.timeout_seconds == 45
    assert command.max_output_bytes == 12345
    runtime.clear_config_cache()


def test_cluster_command_unknown_cluster_returns_404(monkeypatch):
    runtime.clear_config_cache()
    config = SimpleNamespace(settings=SimpleNamespace(kubectlPath="kubectl"))

    def raise_missing_cluster(cluster_id, loaded_config):
        raise KeyError(cluster_id)

    monkeypatch.setattr(runtime.store, "load", lambda: config)
    monkeypatch.setattr(runtime.store, "get_cluster", raise_missing_cluster)

    with pytest.raises(HTTPException) as exc:
        runtime.cluster_command("missing-cluster", ["get", "pods"])

    assert exc.value.status_code == 404
    assert exc.value.detail["code"] == "CLUSTER_NOT_FOUND"
    runtime.clear_config_cache()
