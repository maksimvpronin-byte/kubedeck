from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import re
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from kubedeck_backend.api.runtime import cluster_command
from kubedeck_backend.api.validation import api_error
from kubedeck_backend.kubectl.command import KubectlCommand, kubectl_environment

try:
    import winpty
except ImportError:
    winpty = None


log = logging.getLogger(__name__)


def terminal_pty_available() -> bool:
    return os.name == "nt" and winpty is not None


def normalize_terminal_shell(value: str) -> str:
    shell = (value or "auto").strip().lower()
    if shell not in {"auto", "sh", "bash", "ash"}:
        raise api_error(400, "INVALID_SHELL", "Shell must be auto, sh, bash, or ash")
    return shell


def build_terminal_command(cluster_id: str, namespace: str, name: str, container: str, shell: str, use_tty: bool) -> KubectlCommand:
    args = ["exec", "-i"]
    if use_tty:
        args.append("-t")
    args.extend([name, "-n", namespace])
    if container.strip():
        args.extend(["-c", container.strip()])
    shell_command = terminal_shell_command(shell)
    args.extend(["--", "sh", "-c", shell_command])
    return cluster_command(cluster_id, args, timeout=0)


def terminal_shell_command(shell: str) -> str:
    prefix = "TERM=xterm; export TERM; clear; "
    if shell == "auto":
        return (
            prefix
            + "if command -v bash >/dev/null 2>&1; then exec bash -i; "
            + "elif command -v sh >/dev/null 2>&1; then exec sh -i; "
            + "elif command -v ash >/dev/null 2>&1; then exec ash -i; "
            + "else echo 'KubeDeck: no supported shell found. Try sh, bash, or ash.' >&2; exit 127; fi"
        )
    safe_shell = shell if shell in {"sh", "bash", "ash"} else "sh"
    return (
        prefix
        + f"if command -v {safe_shell} >/dev/null 2>&1; then exec {safe_shell} -i; "
        + f"else echo 'KubeDeck: selected shell {safe_shell} was not found in this container. Try Auto or another shell.' >&2; exit 127; fi"
    )


async def pod_terminal_pty(websocket: WebSocket, command: KubectlCommand) -> bool:
    process: Any = None
    read_error = ""
    read_started = asyncio.Event()
    read_failed = asyncio.Event()

    async def read_pty() -> None:
        nonlocal read_error
        while process and process.isalive():
            try:
                chunk = await asyncio.to_thread(process.read, 4096)
            except Exception as exc:
                read_error = str(exc)
                log.info("terminal pty read stopped: %s", read_error)
                read_failed.set()
                break
            if chunk:
                if has_terminal_payload(chunk):
                    read_started.set()
                await websocket.send_text(json.dumps({"type": "output", "stream": "pty", "data": chunk}))

    try:
        process = winpty.PtyProcess.spawn(command.argv, env=kubectl_environment(command.kubeconfig_path), dimensions=(24, 100))
        read_task = asyncio.create_task(read_pty())

        await websocket.send_text(json.dumps({"type": "status", "data": "connected", "commandPreview": command.preview}))
        while process.isalive():
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=0.1)
            except asyncio.TimeoutError:
                if read_failed.is_set() and not read_started.is_set():
                    read_task.cancel()
                    with contextlib.suppress(Exception):
                        await read_task
                    return False
                continue
            except WebSocketDisconnect:
                break
            payload = json.loads(message)
            if payload.get("type") == "input":
                await asyncio.to_thread(process.write, str(payload.get("data", "")))
            elif payload.get("type") == "resize":
                rows = int(payload.get("rows") or 24)
                cols = int(payload.get("cols") or 100)
                await asyncio.to_thread(process.setwinsize, rows, cols)
            elif payload.get("type") == "close":
                break
        if read_failed.is_set() and not read_started.is_set():
            read_task.cancel()
            with contextlib.suppress(Exception):
                await read_task
            return False
        if process and process.isalive():
            process.terminate(force=True)
        read_task.cancel()
        with contextlib.suppress(Exception):
            await read_task
        with contextlib.suppress(RuntimeError):
            await websocket.send_text(json.dumps({"type": "status", "data": "closed"}))
        return True
    except FileNotFoundError as exc:
        await websocket.send_text(json.dumps({"type": "error", "data": f"kubectl not found: {command.kubectl_path}", "detail": str(exc)}))
    except Exception as exc:
        log.info("terminal pty failed: %s", exc)
        with contextlib.suppress(RuntimeError):
            await websocket.send_text(json.dumps({"type": "error", "data": f"PTY unavailable: {exc}. Retrying without TTY..."}))
        return False
    finally:
        if process and process.isalive():
            with contextlib.suppress(Exception):
                process.terminate(force=True)
    return False


def has_terminal_payload(chunk: str) -> bool:
    text = re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)", "", chunk)
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    text = "".join(char for char in text if char >= " " or char in "\r\n\t")
    return bool(text.strip())


async def pod_terminal_pipes(websocket: WebSocket, command: KubectlCommand) -> None:
    process: asyncio.subprocess.Process | None = None
    input_buffer: list[str] = []

    async def send_stream(stream: asyncio.StreamReader | None, stream_name: str) -> None:
        if stream is None:
            return
        try:
            while True:
                chunk = await stream.read(2048)
                if not chunk:
                    break
                data = filter_terminal_pipe_output(chunk.decode("utf-8", "replace"))
                if data:
                    await websocket.send_text(json.dumps({"type": "output", "stream": stream_name, "data": data}))
        except RuntimeError:
            return

    try:
        log.info("terminal pipes open preview=%s", command.preview)
        process = await asyncio.create_subprocess_exec(
            *command.argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=kubectl_environment(command.kubeconfig_path),
        )
        await websocket.send_text(json.dumps({"type": "status", "data": "connected", "commandPreview": command.preview}))
        stdout_task = asyncio.create_task(send_stream(process.stdout, "stdout"))
        stderr_task = asyncio.create_task(send_stream(process.stderr, "stderr"))
        wait_task = asyncio.create_task(process.wait())
        receive_task = asyncio.create_task(websocket.receive_text())

        while True:
            done, _pending = await asyncio.wait({wait_task, receive_task}, return_when=asyncio.FIRST_COMPLETED)
            if wait_task in done:
                break
            try:
                message = receive_task.result()
            except WebSocketDisconnect:
                break
            payload = json.loads(message)
            if payload.get("type") == "input" and process.stdin is not None:
                raw_input = str(payload.get("data", ""))
                echo, stdin_data = handle_pipe_input(raw_input, input_buffer)
                if echo:
                    await websocket.send_text(json.dumps({"type": "output", "stream": "stdin", "data": echo}))
                if stdin_data:
                    process.stdin.write(stdin_data.encode("utf-8", "replace"))
                    await process.stdin.drain()
            elif payload.get("type") == "close":
                break
            receive_task = asyncio.create_task(websocket.receive_text())

        if process.returncode is None:
            process.terminate()
        await asyncio.wait_for(process.wait(), timeout=5)
        log.info("terminal pipes closed returnCode=%s preview=%s", process.returncode, command.preview)
        receive_task.cancel()
        await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
        with contextlib.suppress(RuntimeError):
            await websocket.send_text(json.dumps({"type": "status", "data": "closed", "returnCode": process.returncode}))
    except FileNotFoundError as exc:
        await websocket.send_text(json.dumps({"type": "error", "data": f"kubectl not found: {command.kubectl_path}", "detail": str(exc)}))
    except Exception as exc:
        with contextlib.suppress(RuntimeError):
            await websocket.send_text(json.dumps({"type": "error", "data": str(exc)}))
    finally:
        if process and process.returncode is None:
            process.kill()
            with contextlib.suppress(Exception):
                await process.wait()


def filter_terminal_pipe_output(data: str) -> str:
    return re.sub(r"(?m)^(?:ash|sh): can't access tty; job control turned off\r?\n?", "", data)


def handle_pipe_input(data: str, input_buffer: list[str]) -> tuple[str, str]:
    echo: list[str] = []
    stdin_chunks: list[str] = []
    index = 0
    while index < len(data):
        char = data[index]
        if char == "\x1b":
            index = consume_escape_input(data, index)
        elif char == "\r":
            if index + 1 < len(data) and data[index + 1] == "\n":
                index += 1
            stdin_chunks.append("".join(input_buffer) + "\n")
            input_buffer.clear()
            echo.append("\r\n")
        elif char == "\n":
            stdin_chunks.append("".join(input_buffer) + "\n")
            input_buffer.clear()
            echo.append("\r\n")
        elif char in ("\b", "\x7f"):
            if input_buffer:
                input_buffer.pop()
                echo.append("\b \b")
        elif char == "\x15":
            if input_buffer:
                echo.append("\b \b" * len(input_buffer))
                input_buffer.clear()
        elif char == "\x03":
            input_buffer.clear()
            stdin_chunks.append("\x03")
            echo.append("^C\r\n")
        elif char >= " " or char == "\t":
            input_buffer.append(char)
            echo.append(char)
        index += 1
    return "".join(echo), "".join(stdin_chunks)


def consume_escape_input(data: str, index: int) -> int:
    if index + 1 >= len(data):
        return index
    next_char = data[index + 1]
    if next_char == "[":
        cursor = index + 2
        while cursor < len(data):
            char = data[cursor]
            if "@" <= char <= "~":
                return cursor
            cursor += 1
        return len(data) - 1
    if next_char == "O":
        return min(index + 2, len(data) - 1)
    if next_char == "]":
        cursor = index + 2
        while cursor < len(data):
            if data[cursor] == "\x07":
                return cursor
            if data[cursor] == "\x1b" and cursor + 1 < len(data) and data[cursor + 1] == "\\":
                return cursor + 1
            cursor += 1
        return len(data) - 1
    return index + 1
