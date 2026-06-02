from __future__ import annotations

import json
import random
import re
import socket
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from kubedeck_backend.core.paths import appdata_dir

try:
    import psutil
except ImportError:
    psutil = None


port_forwards: dict[str, dict[str, Any]] = {}


def stop_kubectl_port_forward_process(pid: int) -> None:
    if psutil is None:
        raise HTTPException(status_code=400, detail={"code": "PROCESS_DISCOVERY_UNAVAILABLE", "message": "psutil is not installed", "rawStderr": "", "commandPreview": ""})
    try:
        proc = psutil.Process(pid)
        if not is_kubectl_port_forward_process(proc):
            raise HTTPException(status_code=403, detail={"code": "REFUSE_TO_STOP_PROCESS", "message": f"Refusing to stop pid {pid}: it is not a kubectl port-forward process", "rawStderr": "", "commandPreview": ""})
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except psutil.TimeoutExpired:
            proc.kill()
    except psutil.NoSuchProcess:
        return
    except psutil.AccessDenied as exc:
        raise HTTPException(status_code=403, detail={"code": "PROCESS_ACCESS_DENIED", "message": f"Access denied when stopping pid {pid}", "rawStderr": str(exc), "commandPreview": ""}) from exc


def is_kubectl_port_forward_process(proc: Any) -> bool:
    try:
        name = str(proc.name() or "").lower()
        cmdline = [str(arg) for arg in (proc.cmdline() or [])]
    except Exception:
        return False
    executable = Path(cmdline[0]).name.lower() if cmdline else name
    if executable not in {"kubectl", "kubectl.exe"} and name not in {"kubectl", "kubectl.exe"}:
        return False
    if "port-forward" not in cmdline:
        return False
    if "--kubeconfig" not in cmdline:
        return False
    return parse_port_forward_cmdline(cmdline) is not None


def prune_port_forwards() -> None:
    load_port_forward_registry()
    changed = False
    for session_id, session in list(port_forwards.items()):
        process: subprocess.Popen[str] | None = session.get("process")
        pid = int(session.get("pid") or (process.pid if process else 0))
        if process is not None and process.poll() is None:
            continue
        if pid and is_process_running(pid):
            continue
        changed = True
        port_forwards.pop(session_id, None)
    if changed:
        save_port_forward_registry()


def port_forward_registry_path() -> Path:
    return appdata_dir() / "port-forwards.json"


def load_port_forward_registry() -> None:
    path = port_forward_registry_path()
    if not path.exists():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return
    for item in data.get("items", []):
        session_id = str(item.get("id") or "")
        pid = int(item.get("pid") or 0)
        if not session_id or session_id in port_forwards or not pid or not is_process_running(pid):
            continue
        port_forwards[session_id] = {
            "process": None,
            "pid": pid,
            "clusterId": str(item.get("clusterId") or ""),
            "namespace": str(item.get("namespace") or ""),
            "resource": str(item.get("resource") or ""),
            "name": str(item.get("name") or ""),
            "localPort": int(item.get("localPort") or 0),
            "remotePort": int(item.get("remotePort") or 0),
            "startedAt": str(item.get("startedAt") or ""),
            "commandPreview": str(item.get("commandPreview") or ""),
        }


def save_port_forward_registry() -> None:
    path = port_forward_registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    items = [session_view(session_id, session) for session_id, session in port_forwards.items()]
    path.write_text(json.dumps({"items": items}, ensure_ascii=False, indent=2), encoding="utf-8")


def is_process_running(pid: int) -> bool:
    if pid <= 0:
        return False
    if psutil is None:
        return False
    try:
        proc = psutil.Process(pid)
        return proc.is_running() and proc.status() != psutil.STATUS_ZOMBIE
    except Exception:
        return False


def discover_external_port_forwards(managed_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if psutil is None:
        return []
    managed_pids = {int(item.get("pid") or 0) for item in managed_items}
    discovered: list[dict[str, Any]] = []
    for proc in psutil.process_iter(["pid", "name", "cmdline", "create_time"]):
        try:
            pid = int(proc.info.get("pid") or 0)
            if pid in managed_pids:
                continue
            if not is_kubectl_port_forward_process(proc):
                continue
            cmdline = proc.info.get("cmdline") or []
            parsed = parse_port_forward_cmdline(cmdline)
            if not parsed:
                continue
            created = datetime.fromtimestamp(float(proc.info.get("create_time") or time.time()), timezone.utc).isoformat()
            discovered.append({
                "id": f"external:{pid}",
                "clusterId": "",
                "namespace": parsed["namespace"],
                "resource": parsed["resource"],
                "name": parsed["name"],
                "localPort": parsed["localPort"],
                "remotePort": parsed["remotePort"],
                "status": "running",
                "pid": pid,
                "startedAt": created,
                "commandPreview": " ".join(f'"{arg}"' if " " in arg else arg for arg in cmdline),
                "url": f"http://127.0.0.1:{parsed['localPort']}",
                "source": "external",
                "stoppable": False,
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
        except Exception:
            continue
    return discovered


def parse_port_forward_cmdline(cmdline: list[str]) -> dict[str, Any] | None:
    if not cmdline or "port-forward" not in cmdline:
        return None
    try:
        index = cmdline.index("port-forward")
    except ValueError:
        return None
    namespace = "default"
    resource_ref = ""
    port_ref = ""
    i = index + 1
    while i < len(cmdline):
        arg = cmdline[i]
        if arg in {"-n", "--namespace"} and i + 1 < len(cmdline):
            namespace = cmdline[i + 1]
            i += 2
            continue
        if arg.startswith("--namespace="):
            namespace = arg.split("=", 1)[1]
            i += 1
            continue
        if arg.startswith("-") or arg in {"--address"}:
            i += 2 if arg in {"--address"} and i + 1 < len(cmdline) else 1
            continue
        if not resource_ref:
            resource_ref = arg
        elif not port_ref and re.match(r"^\d+:\d+$", arg):
            port_ref = arg
            break
        i += 1
    if not resource_ref or not port_ref:
        return None
    resource, name = parse_port_forward_resource_ref(resource_ref)
    local, remote = port_ref.split(":", 1)
    return {"namespace": namespace, "resource": resource, "name": name, "localPort": int(local), "remotePort": int(remote)}


def parse_port_forward_resource_ref(value: str) -> tuple[str, str]:
    if "/" in value:
        resource, name = value.split("/", 1)
        return resource.rstrip("s"), name
    return "pod", value


def start_port_forward_output_readers(process: subprocess.Popen[str], output_buffer: list[str], output_lock: threading.Lock) -> None:
    def read_stream(stream: Any) -> None:
        if stream is None:
            return
        try:
            for line in iter(stream.readline, ""):
                if not line:
                    break
                with output_lock:
                    output_buffer.append(line)
                    if len(output_buffer) > 250:
                        del output_buffer[: len(output_buffer) - 250]
        except Exception:
            return

    for stream in (process.stdout, process.stderr):
        threading.Thread(target=read_stream, args=(stream,), daemon=True).start()


def port_forward_output(output_buffer: list[str], output_lock: threading.Lock) -> str:
    with output_lock:
        return "".join(output_buffer).strip()


def wait_for_port_forward_ready(process: subprocess.Popen[str], output_buffer: list[str], output_lock: threading.Lock, timeout: float) -> str | None:
    deadline = time.monotonic() + timeout
    ready_markers = ("Forwarding from 127.0.0.1:", "Forwarding from [::1]:", "Forwarding from localhost:", "Handling connection for")
    error_markers = ("unable to listen", "address already in use", "error forwarding", "lost connection to pod", "pod is not running", "not found", "connection refused")

    while time.monotonic() < deadline:
        output = port_forward_output(output_buffer, output_lock)
        lowered = output.lower()
        if any(marker.lower() in lowered for marker in ready_markers):
            return None
        if process.poll() is not None:
            time.sleep(0.1)
            output = port_forward_output(output_buffer, output_lock)
            return output or f"kubectl port-forward exited with code {process.returncode}"
        if output and any(marker in lowered for marker in error_markers):
            return output
        time.sleep(0.1)

    if process.poll() is None:
        # Some kubectl builds can be quiet for a moment, but a port-forward that
        # is still alive after the readiness window is usually usable. Keep it
        # instead of killing a valid session.
        return None
    return port_forward_output(output_buffer, output_lock) or f"kubectl port-forward exited with code {process.returncode}"


def find_available_local_port(preferred: int) -> int:
    prune_port_forwards()
    for port in range(preferred, min(65535, preferred + 200) + 1):
        if is_local_port_registered(port):
            continue
        if can_bind_local_port(port):
            return port
    raise HTTPException(
        status_code=409,
        detail={
            "code": "LOCAL_PORT_UNAVAILABLE",
            "message": f"No free local port found near {preferred}",
            "rawStderr": "",
            "commandPreview": "",
        },
    )


def is_local_port_registered(port: int) -> bool:
    return any(
        int(session.get("localPort", 0)) == port
        for session in port_forwards.values()
        if session.get("process") is not None and session["process"].poll() is None
    )


def normalize_port_forward_local_port(port: int, remote_port: int = 0) -> int:
    # 0 means "auto". Always prefer a high local port instead of mirroring
    # the remote port. Mirroring :80/:443 is surprising on Windows, may require
    # elevation, and can make a short-lived test look like the forward closed
    # unexpectedly when the target pod does not actually expose that port.
    if port == 0:
        return random.randint(62000, 65535)
    return port


def can_bind_local_port(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def session_view(session_id: str, session: dict[str, Any]) -> dict[str, Any]:
    process: subprocess.Popen[str] | None = session.get("process")
    pid = int(session.get("pid") or (process.pid if process else 0))
    status = "running" if (process is not None and process.poll() is None) or (process is None and is_process_running(pid)) else "stopped"
    return {
        "id": session_id,
        "clusterId": session["clusterId"],
        "namespace": session["namespace"],
        "resource": session["resource"],
        "name": session["name"],
        "localPort": session["localPort"],
        "remotePort": session["remotePort"],
        "status": status,
        "pid": pid,
        "startedAt": session["startedAt"],
        "commandPreview": session["commandPreview"],
        "url": f"http://127.0.0.1:{session['localPort']}",
        "source": "kubedeck",
        "stoppable": True,
    }
