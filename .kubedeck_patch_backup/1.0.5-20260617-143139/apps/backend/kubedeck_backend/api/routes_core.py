from __future__ import annotations

from fastapi import APIRouter

from .common import *
from .resource_cache import clear_resource_snapshot_cache, resource_snapshot_cache_stats


router = APIRouter()


@router.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "kubedeck-backend"}

@router.get("/app/info")
def app_info() -> dict[str, Any]:
    dirs = ensure_app_dirs()
    config = get_cached_config()
    return {
        "service": "kubedeck-backend",
        "backendVersion": "1.0.3",
        "pythonVersion": sys.version.split()[0],
        "platform": platform.platform(),
        "processId": os.getpid(),
        "paths": {
            "root": str(dirs["root"]),
            "config": str(config_path()),
            "kubeconfigs": str(dirs["kubeconfigs"]),
            "logs": str(dirs["logs"]),
        },
        "settings": {
            "kubectlPath": config.settings.kubectlPath,
            "refreshIntervalSeconds": config.settings.refreshIntervalSeconds,
            "logsTailLines": config.settings.logsTailLines,
            "language": config.settings.language,
            "theme": config.settings.theme,
            "ssh": config.settings.ssh.model_dump(),
        },
        "clusters": len(config.clusters),
    }

@router.get("/config")
def get_config() -> dict[str, Any]:
    return get_cached_config().model_dump()

@router.put("/settings")
def put_settings(request: SettingsUpdateRequest) -> dict[str, Any]:
    try:
        updated = store.update_settings(request.settings)
        clear_config_cache()
        append_audit_event(action="settings.update", status="success", message="Application settings updated")
        return updated.model_dump()
    except Exception as exc:
        append_audit_event(action="settings.update", status="failed", message=str(exc))
        raise HTTPException(status_code=400, detail={"code": "INVALID_SETTINGS", "message": str(exc), "rawStderr": "", "commandPreview": ""}) from exc

@router.get("/resource-cache/status")
def resource_cache_status() -> dict[str, Any]:
    return resource_snapshot_cache_stats()


@router.post("/resource-cache/clear")
def resource_cache_clear(cluster_id: str | None = None) -> dict[str, Any]:
    return clear_resource_snapshot_cache(cluster_id)


@router.get("/kubectl/status")
def kubectl_status() -> dict[str, Any]:
    config = get_cached_config()
    command = KubectlCommand(cluster_id="", kubeconfig_path=None, kubectl_path=config.settings.kubectlPath, args=["version", "--client", "-o", "json"], timeout_seconds=15)
    try:
        result = runner.run_json(command)
    except KubectlError as exc:
        raise kubectl_error(exc)
    return {"ok": True, "version": result.get("clientVersion", result), "commandPreview": command.preview}
