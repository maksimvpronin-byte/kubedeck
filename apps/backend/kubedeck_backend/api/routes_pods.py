from __future__ import annotations

from fastapi import APIRouter

from .common import *


router = APIRouter()


@router.get("/clusters/{cluster_id}/pods/{namespace}/{name}/yaml", response_class=PlainTextResponse)
def pod_yaml(cluster_id: str, namespace: str, name: str) -> str:
    namespace = validate_identifier(namespace, "namespace")
    name = validate_identifier(name, "name")
    try:
        return runner.run(cluster_command(cluster_id, ["get", "pod", name, "-n", namespace, "-o", "yaml"], timeout=30, max_output_bytes=TEXT_MAX_OUTPUT_BYTES)).stdout
    except KubectlError as exc:
        raise kubectl_error(exc)

@router.get("/clusters/{cluster_id}/pods/{namespace}/{name}/describe", response_class=PlainTextResponse)
def pod_describe(cluster_id: str, namespace: str, name: str) -> str:
    namespace = validate_identifier(namespace, "namespace")
    name = validate_identifier(name, "name")
    try:
        return runner.run(cluster_command(cluster_id, ["describe", "pod", name, "-n", namespace], timeout=30, max_output_bytes=TEXT_MAX_OUTPUT_BYTES)).stdout
    except KubectlError as exc:
        raise kubectl_error(exc)

@router.get("/clusters/{cluster_id}/pods/{namespace}/{name}/logs", response_class=PlainTextResponse)
def pod_logs(
    cluster_id: str,
    namespace: str,
    name: str,
    tail: int = Query(default=500),
    all: bool = Query(default=False),
    follow: bool = Query(default=False),
    previous: bool = Query(default=False),
    timestamps: bool = Query(default=False),
    container: str | None = Query(default=None),
) -> str:
    namespace = validate_identifier(namespace, "namespace")
    name = validate_identifier(name, "name")
    if follow:
        raise api_error(400, "FOLLOW_LOGS_REQUIRES_STREAM", "HTTP logs endpoint is bounded; KubeDeck uses bounded polling for follow mode")
    args = ["--request-timeout=20s", "logs", name, "-n", namespace]
    if all:
        args.append("--tail=-1")
        timeout = 60
        max_output_bytes = LOGS_FULL_MAX_OUTPUT_BYTES
    else:
        tail = normalize_tail_lines(tail)
        args.append(f"--tail={tail}")
        timeout = 35
        max_output_bytes = LOGS_MAX_OUTPUT_BYTES
    if container:
        args.extend(["-c", validate_identifier(container, "container", max_length=253)])
    if previous:
        args.append("--previous")
    if timestamps:
        args.append("--timestamps")
    try:
        return runner.run(cluster_command(cluster_id, args, timeout=timeout, max_output_bytes=max_output_bytes)).stdout
    except KubectlError as exc:
        raise kubectl_error(exc)

@router.post("/clusters/{cluster_id}/pods/{namespace}/{name}/exec")
def pod_exec(cluster_id: str, namespace: str, name: str, request: PodExecRequest) -> dict[str, Any]:
    namespace = validate_identifier(namespace, "namespace")
    name = validate_identifier(name, "name")
    command_text = request.command.strip()
    if not command_text:
        raise HTTPException(status_code=400, detail={"code": "EMPTY_COMMAND", "message": "Command is required", "rawStderr": "", "commandPreview": ""})
    if len(command_text) > MAX_EXEC_COMMAND_CHARS:
        raise api_error(400, "COMMAND_TOO_LONG", f"Command is too long; limit is {MAX_EXEC_COMMAND_CHARS} characters")
    shell = request.shell.strip() or "sh"
    if shell not in {"sh", "bash", "ash"}:
        raise HTTPException(status_code=400, detail={"code": "INVALID_SHELL", "message": "Shell must be sh, bash, or ash", "rawStderr": "", "commandPreview": ""})
    args = ["exec", name, "-n", namespace]
    container = (request.container or "").strip()
    if container:
        args.extend(["-c", container])
    args.extend(["--", shell, "-lc", command_text])
    require_confirmation(request.confirmation, cluster_id, "exec", "pods", namespace, name, name)
    verify_auth_can_i(cluster_id, "create", "pods/exec", namespace)
    command = cluster_command(cluster_id, args, timeout=60, max_output_bytes=TEXT_MAX_OUTPUT_BYTES)
    try:
        result = runner.run(command)
        append_audit_event(action="pod.exec", status="success" if result.returnCode == 0 else "failed", cluster_id=cluster_id, namespace=namespace, resource="pods", name=name, command_preview=command.preview, extra={"returnCode": result.returnCode, "container": container, "shell": shell})
        return {
            "ok": result.returnCode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "commandPreview": command.preview,
            "returnCode": result.returnCode,
        }
    except KubectlError as exc:
        append_audit_event(action="pod.exec", status="failed", cluster_id=cluster_id, namespace=namespace, resource="pods", name=name, command_preview=command.preview, message=exc.info.message, extra={"container": container, "shell": shell})
        raise kubectl_error(exc)

@router.websocket("/clusters/{cluster_id}/pods/{namespace}/{name}/terminal")
async def pod_terminal(cluster_id: str, namespace: str, name: str, websocket: WebSocket, container: str = Query(default=""), shell: str = Query(default="auto"), token: str = Query(default="")) -> None:
    if not websocket_origin_allowed(websocket) or not verify_session_token(websocket_token(websocket, token)):
        await websocket.close(code=1008)
        return
    try:
        namespace = validate_identifier(namespace, "namespace")
        name = validate_identifier(name, "name")
        if container:
            container = validate_identifier(container, "container")
        shell = normalize_terminal_shell(shell)
    except HTTPException:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    use_pty = terminal_pty_available()
    try:
        verify_auth_can_i(cluster_id, "create", "pods/exec", namespace)
    except HTTPException as exc:
        await websocket.send_text(json.dumps({"type": "error", "data": str(exc.detail)}))
        await websocket.close(code=1008)
        return

    command = build_terminal_command(cluster_id, namespace, name, container, shell, use_tty=use_pty)
    append_audit_event(action="pod.terminal", status="opened", cluster_id=cluster_id, namespace=namespace, resource="pods", name=name, command_preview=command.preview, extra={"container": container, "shell": shell, "pty": use_pty})
    log.info("terminal open namespace=%s pod=%s container=%s shell=%s pty=%s preview=%s", namespace, name, container, shell, use_pty, command.preview)
    if use_pty:
        pty_ok = await pod_terminal_pty(websocket, command)
        if pty_ok:
            append_audit_event(action="pod.terminal", status="closed", cluster_id=cluster_id, namespace=namespace, resource="pods", name=name, command_preview=command.preview, extra={"container": container, "shell": shell, "pty": use_pty})
            return
        log.info("terminal pty unavailable, falling back to pipes namespace=%s pod=%s container=%s", namespace, name, container)

    fallback_command = build_terminal_command(cluster_id, namespace, name, container, shell, use_tty=False)
    await pod_terminal_pipes(websocket, fallback_command)
    append_audit_event(action="pod.terminal", status="closed", cluster_id=cluster_id, namespace=namespace, resource="pods", name=name, command_preview=fallback_command.preview, extra={"container": container, "shell": shell, "pty": False})
