from __future__ import annotations

from fastapi import APIRouter

from .common import *
from .resource_cache import clear_resource_snapshot_cache


router = APIRouter()


@router.get("/clusters")
def list_clusters() -> dict[str, Any]:
    return {"clusters": [cluster.model_dump() for cluster in get_cached_config().clusters]}

@router.post("/clusters/import")
def import_cluster(request: ImportClusterRequest) -> dict[str, Any]:
    try:
        cluster = store.import_cluster(request.sourcePath, request.displayName)
        clear_config_cache()
        log.info("cluster imported id=%s name=%s", cluster.id, cluster.displayName)
        append_audit_event(action="cluster.import", status="success", cluster_id=cluster.id, name=cluster.displayName)
        return cluster.model_dump()
    except Exception as exc:
        append_audit_event(action="cluster.import", status="failed", message=str(exc))
        log.exception("cluster import failed")
        raise HTTPException(status_code=400, detail={"code": "IMPORT_FAILED", "message": str(exc), "rawStderr": "", "commandPreview": ""})

@router.patch("/clusters/{cluster_id}")
def rename_cluster(cluster_id: str, request: RenameClusterRequest) -> dict[str, Any]:
    try:
        clear_config_cache()
        renamed = store.rename_cluster(cluster_id, request.displayName)
        append_audit_event(action="cluster.rename", status="success", cluster_id=cluster_id, name=renamed.displayName)
        return renamed.model_dump()
    except KeyError as exc:
        append_audit_event(action="cluster.rename", status="failed", cluster_id=cluster_id, message=str(exc))
        raise HTTPException(status_code=404, detail={"code": "CLUSTER_NOT_FOUND", "message": str(exc), "rawStderr": "", "commandPreview": ""})

@router.delete("/clusters/{cluster_id}")
def remove_cluster(cluster_id: str) -> dict[str, Any]:
    try:
        store.remove_cluster(cluster_id)
        clear_config_cache()
        clear_resource_snapshot_cache(cluster_id)
        append_audit_event(action="cluster.remove", status="success", cluster_id=cluster_id)
        return {"ok": True}
    except KeyError as exc:
        append_audit_event(action="cluster.remove", status="failed", cluster_id=cluster_id, message=str(exc))
        raise HTTPException(status_code=404, detail={"code": "CLUSTER_NOT_FOUND", "message": str(exc), "rawStderr": "", "commandPreview": ""})

@router.post("/clusters/last/open")
def open_last_cluster() -> dict[str, Any]:
    cluster = store.last_opened()
    if not cluster:
        return {"cluster": None}
    return open_cluster(cluster.id)

@router.post("/clusters/{cluster_id}/open")
def open_cluster(cluster_id: str) -> dict[str, Any]:
    try:
        cluster = store.get_cluster(cluster_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"code": "CLUSTER_NOT_FOUND", "message": str(exc), "rawStderr": "", "commandPreview": ""}) from exc
    try:
        if not Path(cluster.kubeconfigPath).exists():
            raise HTTPException(status_code=400, detail={"code": "CLUSTER_UNAVAILABLE", "message": "kubeconfig file is missing", "rawStderr": "", "commandPreview": ""})
        runner.run(cluster_command(cluster_id, ["cluster-info"], timeout=30))
        namespaces = runner.run_json(cluster_command(cluster_id, ["get", "namespaces", "-o", "json"], timeout=30))
        store.mark_opened(cluster_id)
        return {"cluster": cluster.model_dump(), "namespaces": namespaces.get("items", [])}
    except KubectlError as exc:
        raise kubectl_error(exc)

@router.get("/clusters/{cluster_id}/namespaces")
def namespaces(cluster_id: str) -> dict[str, Any]:
    try:
        data = runner.run_json(cluster_command(cluster_id, ["get", "namespaces", "-o", "json"], timeout=30))
        return {"items": data.get("items", [])}
    except KubectlError as exc:
        raise kubectl_error(exc)
