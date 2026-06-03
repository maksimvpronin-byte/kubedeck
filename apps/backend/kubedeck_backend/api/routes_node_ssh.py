from __future__ import annotations

import asyncio
import json
import re
import threading
import time
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from .common import append_audit_event, validate_identifier, verify_session_token, websocket_origin_allowed, websocket_token

try:
    import paramiko
except ModuleNotFoundError:  # The backend can still start and return a clear SSH error.
    paramiko = None  # type: ignore[assignment]

router = APIRouter()


@dataclass
class SshSession:
    client: Any
    channel: Any
    jump_client: Any | None
    command_preview: str


def _safe_text(value: Any, max_length: int = 256) -> str:
    text = str(value or "").strip()
    if len(text) > max_length:
        text = text[:max_length]
    return text


def _normalize_host(value: Any, field: str = "host") -> str:
    text = _safe_text(value, 253)
    if not text:
        raise ValueError(f"{field} is required")
    if re.search(r"\s", text):
        raise ValueError(f"{field} must not contain whitespace")
    if not re.fullmatch(r"[A-Za-z0-9_.:-]+", text):
        raise ValueError(f"{field} contains unsupported characters")
    return text


def _normalize_port(value: Any, field: str = "port") -> int:
    try:
        port = int(value or 22)
    except Exception as exc:
        raise ValueError(f"{field} must be a number") from exc
    if port < 1 or port > 65535:
        raise ValueError(f"{field} must be between 1 and 65535")
    return port


def _normalize_username(value: Any, field: str = "username") -> str:
    text = _safe_text(value, 128)
    if not text:
        raise ValueError(f"{field} is required")
    if re.search(r"\s", text):
        raise ValueError(f"{field} must not contain whitespace")
    if not re.fullmatch(r"[A-Za-z0-9_.@\\-]+", text):
        raise ValueError(f"{field} contains unsupported characters")
    return text


def _load_private_key(key_path: str, passphrase: str | None) -> Any:
    if paramiko is None:
        raise RuntimeError("Paramiko is not installed")
    if not key_path:
        raise ValueError("private key path is required for private key authentication")
    last_error: Exception | None = None
    for key_class_name in ("RSAKey", "ECDSAKey", "Ed25519Key", "DSSKey"):
        key_class = getattr(paramiko, key_class_name, None)
        if key_class is None:
            continue
        try:
            return key_class.from_private_key_file(key_path, password=passphrase or None)
        except Exception as exc:
            last_error = exc
    raise ValueError(f"Could not load private key: {last_error}")


def _connect_client(payload: dict[str, Any], *, sock: Any | None = None, prefix: str = "") -> Any:
    if paramiko is None:
        raise RuntimeError("Paramiko is not installed. Rebuild/package KubeDeck after applying Patch 4, or install backend requirements.")

    host = _normalize_host(payload.get(f"{prefix}host") or payload.get(f"{prefix}Host"), f"{prefix}host")
    port = _normalize_port(payload.get(f"{prefix}port") or payload.get(f"{prefix}Port") or 22, f"{prefix}port")
    username = _normalize_username(payload.get(f"{prefix}username") or payload.get(f"{prefix}Username"), f"{prefix}username")
    auth_method = _safe_text(payload.get(f"{prefix}authMethod") or payload.get(f"{prefix}AuthMethod") or "agent", 32)
    password = str(payload.get(f"{prefix}password") or payload.get(f"{prefix}Password") or "")
    key_path = _safe_text(payload.get(f"{prefix}keyPath") or payload.get(f"{prefix}KeyPath"), 1024)
    key_passphrase = str(payload.get(f"{prefix}keyPassphrase") or payload.get(f"{prefix}KeyPassphrase") or "")

    pkey = None
    allow_agent = auth_method in {"agent", "default"}
    look_for_keys = auth_method in {"agent", "default"}
    if auth_method == "password":
        if not password:
            raise ValueError(f"{prefix}password is required")
        allow_agent = False
        look_for_keys = False
    elif auth_method == "privateKey":
        pkey = _load_private_key(key_path, key_passphrase or None)
        allow_agent = False
        look_for_keys = False
    elif auth_method not in {"agent", "default"}:
        raise ValueError(f"Unsupported {prefix}authMethod: {auth_method}")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=host,
        port=port,
        username=username,
        password=password if auth_method == "password" else None,
        pkey=pkey,
        sock=sock,
        timeout=20,
        banner_timeout=20,
        auth_timeout=20,
        allow_agent=allow_agent,
        look_for_keys=look_for_keys,
    )
    return client


def _command_preview(payload: dict[str, Any]) -> str:
    host = _normalize_host(payload.get("host"))
    port = _normalize_port(payload.get("port") or 22)
    username = _normalize_username(payload.get("username"))
    auth_method = _safe_text(payload.get("authMethod") or "agent", 32)
    key_path = _safe_text(payload.get("keyPath"), 1024)
    parts = ["ssh"]
    if port != 22:
        parts.extend(["-p", str(port)])
    if auth_method == "privateKey" and key_path:
        parts.extend(["-i", key_path])
    if bool(payload.get("useJumpHost")):
        jump_host = _normalize_host(payload.get("jumpHost"), "jumpHost")
        jump_port = _normalize_port(payload.get("jumpPort") or 22, "jumpPort")
        jump_username = _normalize_username(payload.get("jumpUsername") or username, "jumpUsername")
        jump = f"{jump_username}@{jump_host}"
        if jump_port != 22:
            jump = f"{jump}:{jump_port}"
        parts.extend(["-J", jump])
    parts.append(f"{username}@{host}")
    return " ".join(parts)


def _open_ssh_session(payload: dict[str, Any], cols: int, rows: int) -> SshSession:
    command_preview = _command_preview(payload)
    jump_client = None
    sock = None
    if bool(payload.get("useJumpHost")):
        jump_payload = dict(payload)
        jump_payload["jumpAuthMethod"] = payload.get("jumpAuthMethod") or payload.get("authMethod") or "agent"
        if not jump_payload.get("jumpUsername"):
            jump_payload["jumpUsername"] = payload.get("username")
        jump_client = _connect_client(jump_payload, prefix="jump")
        transport = jump_client.get_transport()
        if transport is None:
            raise RuntimeError("Jump host transport is not available")
        target_host = _normalize_host(payload.get("host"))
        target_port = _normalize_port(payload.get("port") or 22)
        sock = transport.open_channel("direct-tcpip", (target_host, target_port), ("127.0.0.1", 0))

    client = _connect_client(payload, sock=sock)
    channel = client.invoke_shell(term="xterm-256color", width=max(int(cols or 100), 20), height=max(int(rows or 30), 8))
    channel.settimeout(0.2)
    return SshSession(client=client, channel=channel, jump_client=jump_client, command_preview=command_preview)


async def _send_json(websocket: WebSocket, message: dict[str, Any]) -> None:
    await websocket.send_text(json.dumps(message, ensure_ascii=False))


@router.websocket("/clusters/{cluster_id}/nodes/{name}/ssh")
async def node_ssh_terminal(cluster_id: str, name: str, websocket: WebSocket, token: str = Query(default="")) -> None:
    if not websocket_origin_allowed(websocket) or not verify_session_token(websocket_token(websocket, token)):
        await websocket.close(code=1008)
        return
    try:
        name = validate_identifier(name, "name")
    except Exception:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    session: SshSession | None = None
    output_queue: asyncio.Queue[str] = asyncio.Queue()
    closed = threading.Event()
    loop = asyncio.get_running_loop()

    async def sender() -> None:
        while not closed.is_set():
            message = await output_queue.get()
            await websocket.send_text(message)

    def emit(message: dict[str, Any]) -> None:
        if closed.is_set():
            return
        loop.call_soon_threadsafe(output_queue.put_nowait, json.dumps(message, ensure_ascii=False))

    def reader() -> None:
        assert session is not None
        channel = session.channel
        try:
            while not closed.is_set():
                try:
                    if channel.recv_ready():
                        data = channel.recv(4096)
                        if data:
                            emit({"type": "output", "data": data.decode("utf-8", errors="replace")})
                    if hasattr(channel, "recv_stderr_ready") and channel.recv_stderr_ready():
                        data = channel.recv_stderr(4096)
                        if data:
                            emit({"type": "output", "data": data.decode("utf-8", errors="replace")})
                    if channel.closed or channel.exit_status_ready():
                        break
                    time.sleep(0.03)
                except TimeoutError:
                    continue
                except Exception as exc:
                    emit({"type": "error", "data": str(exc)})
                    break
        finally:
            emit({"type": "status", "data": "SSH session closed"})

    sender_task = asyncio.create_task(sender())
    reader_thread: threading.Thread | None = None
    command_preview = ""

    try:
        await _send_json(websocket, {"type": "status", "data": "Waiting for SSH connection settings"})
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=90)
        payload = json.loads(raw)
        if payload.get("type") != "connect":
            raise ValueError("First SSH websocket message must be type=connect")
        cols = int(payload.get("cols") or 100)
        rows = int(payload.get("rows") or 30)
        await _send_json(websocket, {"type": "status", "data": "Connecting to SSH..."})
        session = await asyncio.to_thread(_open_ssh_session, payload, cols, rows)
        command_preview = session.command_preview
        append_audit_event(
            action="node.ssh",
            status="opened",
            cluster_id=cluster_id,
            namespace="_cluster",
            resource="nodes",
            name=name,
            command_preview=command_preview,
            extra={"host": payload.get("host"), "jumpHost": payload.get("jumpHost") if payload.get("useJumpHost") else ""},
        )
        await _send_json(websocket, {"type": "status", "data": "Connected"})
        reader_thread = threading.Thread(target=reader, name=f"kubedeck-node-ssh-{name}", daemon=True)
        reader_thread.start()
        while not closed.is_set():
            try:
                message = await websocket.receive_text()
            except WebSocketDisconnect:
                break
            try:
                event = json.loads(message)
            except Exception:
                continue
            event_type = event.get("type")
            if event_type == "input":
                data = str(event.get("data") or "")
                if data and session and not session.channel.closed:
                    await asyncio.to_thread(session.channel.send, data)
            elif event_type == "resize" and session and not session.channel.closed:
                try:
                    await asyncio.to_thread(session.channel.resize_pty, width=int(event.get("cols") or 100), height=int(event.get("rows") or 30))
                except Exception:
                    pass
            elif event_type == "close":
                break
    except Exception as exc:
        await _send_json(websocket, {"type": "error", "data": str(exc)})
        append_audit_event(action="node.ssh", status="failed", cluster_id=cluster_id, namespace="_cluster", resource="nodes", name=name, command_preview=command_preview, message=str(exc))
    finally:
        closed.set()
        try:
            if session:
                try:
                    session.channel.close()
                except Exception:
                    pass
                try:
                    session.client.close()
                except Exception:
                    pass
                if session.jump_client:
                    try:
                        session.jump_client.close()
                    except Exception:
                        pass
        finally:
            sender_task.cancel()
            if reader_thread and reader_thread.is_alive():
                reader_thread.join(timeout=0.5)
        if command_preview:
            append_audit_event(action="node.ssh", status="closed", cluster_id=cluster_id, namespace="_cluster", resource="nodes", name=name, command_preview=command_preview)
        try:
            await websocket.close()
        except Exception:
            pass
