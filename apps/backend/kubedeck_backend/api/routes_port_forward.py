from __future__ import annotations

from fastapi import APIRouter

from .common import *


router = APIRouter()


@router.get("/port-forwards")
def list_port_forwards() -> dict[str, Any]:
    prune_port_forwards()
    items = [session_view(session_id, session) for session_id, session in port_forwards.items()]
    items.extend(discover_external_port_forwards(items))
    return {"items": items}

@router.post("/clusters/{cluster_id}/port-forwards")
def start_port_forward(cluster_id: str, request: PortForwardStartRequest) -> dict[str, Any]:
    prune_port_forwards()
    config = get_cached_config()
    try:
        cluster = store.get_cluster(cluster_id, config)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"code": "CLUSTER_NOT_FOUND", "message": str(exc), "rawStderr": "", "commandPreview": ""}) from exc

    resource = validate_identifier(request.resource, "resource").lower().rstrip("/")
    namespace = validate_identifier(request.namespace, "namespace")
    name = validate_identifier(request.name, "name")
    if resource not in {"pod", "pods", "service", "services", "deployment", "deployments"}:
        raise api_error(400, "INVALID_RESOURCE", "Port-forward supports pods, services, and deployments")
    if namespace in {"all", "_cluster"}:
        raise api_error(400, "INVALID_NAMESPACE", "Port-forward requires a concrete namespace")
    if not (0 <= request.localPort <= 65535 and 1 <= request.remotePort <= 65535):
        raise api_error(400, "INVALID_PORT", "Local port must be 0..65535 and remote port must be 1..65535")
    if request.localPort == 0:
        local_port = find_available_local_port(normalize_port_forward_local_port(request.localPort, request.remotePort))
    else:
        local_port = request.localPort
        if is_local_port_registered(local_port) or not can_bind_local_port(local_port):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "LOCAL_PORT_IN_USE",
                    "message": f"Local port {local_port} is already in use",
                    "rawStderr": "",
                    "commandPreview": "",
                },
            )

    args = [
        config.settings.kubectlPath,
        "--kubeconfig",
        cluster.kubeconfigPath,
        "port-forward",
        "--address",
        "127.0.0.1",
        "-n",
        namespace,
        f"{resource}/{name}",
        f"{local_port}:{request.remotePort}",
    ]
    preview = " ".join(f'"{arg}"' if " " in arg else arg for arg in args)
    output_buffer: list[str] = []
    output_lock = threading.Lock()
    try:
        process = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=False,
            env=kubectl_environment(cluster.kubeconfigPath),
        )
    except FileNotFoundError as exc:
        append_audit_event(action="port-forward.start", status="failed", cluster_id=cluster_id, namespace=namespace, resource=resource, name=name, command_preview=preview, message=str(exc))
        raise HTTPException(status_code=502, detail={"code": "KUBECTL_NOT_FOUND", "message": f"kubectl not found: {config.settings.kubectlPath}", "rawStderr": str(exc), "commandPreview": preview}) from exc

    start_port_forward_output_readers(process, output_buffer, output_lock)
    startup_error = wait_for_port_forward_ready(process, output_buffer, output_lock, timeout=5.0)
    if startup_error:
        with contextlib.suppress(Exception):
            process.terminate()
        append_audit_event(action="port-forward.start", status="failed", cluster_id=cluster_id, namespace=namespace, resource=resource, name=name, command_preview=preview, message=startup_error)
        raise HTTPException(
            status_code=502,
            detail={
                "code": "PORT_FORWARD_FAILED",
                "message": "kubectl port-forward did not become ready",
                "rawStderr": startup_error,
                "commandPreview": preview,
            },
        )

    session_id = str(uuid.uuid4())
    port_forwards[session_id] = {
        "process": process,
        "_outputBuffer": output_buffer,
        "_outputLock": output_lock,
        "clusterId": cluster_id,
        "namespace": namespace,
        "resource": resource,
        "name": name,
        "localPort": local_port,
        "remotePort": request.remotePort,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "commandPreview": preview,
    }
    save_port_forward_registry()
    append_audit_event(action="port-forward.start", status="success", cluster_id=cluster_id, namespace=namespace, resource=resource, name=name, command_preview=preview, extra={"localPort": local_port, "remotePort": request.remotePort})
    return session_view(session_id, port_forwards[session_id])

@router.delete("/port-forwards/{session_id}")
def stop_port_forward(session_id: str) -> dict[str, Any]:
    prune_port_forwards()
    if session_id.startswith("external:"):
        raise HTTPException(status_code=403, detail={"code": "EXTERNAL_PORT_FORWARD_READ_ONLY", "message": "KubeDeck will not stop external port-forward processes", "rawStderr": "", "commandPreview": ""})
    session = port_forwards.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail={"code": "PORT_FORWARD_NOT_FOUND", "message": "Port-forward session not found", "rawStderr": "", "commandPreview": ""})
    process: subprocess.Popen[str] | None = session.get("process")
    pid = int(session.get("pid") or (process.pid if process else 0))
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
    elif pid:
        stop_kubectl_port_forward_process(pid)
    port_forwards.pop(session_id, None)
    save_port_forward_registry()
    append_audit_event(action="port-forward.stop", status="success", cluster_id=str(session.get("clusterId") or ""), namespace=str(session.get("namespace") or ""), resource=str(session.get("resource") or ""), name=str(session.get("name") or ""), command_preview=str(session.get("commandPreview") or ""))
    return {"ok": True}
