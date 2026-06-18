from __future__ import annotations

import time
from typing import Any

from fastapi import HTTPException

from kubedeck_backend.core.config import ConfigStore
from kubedeck_backend.kubectl.command import KubectlCommand, KubectlError, KubectlRunner

RESOURCE_JSON_MAX_OUTPUT_BYTES = 64 * 1024 * 1024

store = ConfigStore()
runner = KubectlRunner()
_config_cache: tuple[float, Any] | None = None
_config_cache_ttl = 1.0


def get_cached_config() -> Any:
    global _config_cache
    now = time.time()
    if _config_cache and now - _config_cache[0] < _config_cache_ttl:
        return _config_cache[1]
    config = store.load()
    _config_cache = (now, config)
    return config


def clear_config_cache() -> None:
    global _config_cache
    _config_cache = None


def cluster_command(
    cluster_id: str,
    args: list[str],
    timeout: int = 30,
    max_output_bytes: int = RESOURCE_JSON_MAX_OUTPUT_BYTES,
) -> KubectlCommand:
    config = get_cached_config()
    cluster = _cluster_or_404(cluster_id, config)
    return _kubectl_command_for_cluster(cluster, config, args, timeout, max_output_bytes)


def _cluster_or_404(cluster_id: str, config: Any) -> Any:
    try:
        return store.get_cluster(cluster_id, config)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "CLUSTER_NOT_FOUND",
                "message": str(exc),
                "rawStderr": "",
                "commandPreview": "",
            },
        ) from exc


def _kubectl_command_for_cluster(
    cluster: Any,
    config: Any,
    args: list[str],
    timeout: int,
    max_output_bytes: int,
) -> KubectlCommand:
    return KubectlCommand(
        cluster_id=cluster.id,
        kubeconfig_path=cluster.kubeconfigPath,
        kubectl_path=config.settings.kubectlPath,
        args=args,
        timeout_seconds=timeout,
        max_output_bytes=max_output_bytes,
    )


def kubectl_error(exc: KubectlError) -> HTTPException:
    return HTTPException(status_code=502, detail=exc.info.model_dump())
