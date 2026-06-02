from __future__ import annotations

import os
import subprocess
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Deque

from kubedeck_backend.kubectl.command import KubectlCommand, kubectl_environment
from kubedeck_backend.api.resource_cache import apply_watch_event_line_to_resource_cache
from kubedeck_backend.api.watch_events import watch_event_hub

WATCH_OUTPUT_TAIL_LINES = 20
WATCH_STOP_TIMEOUT_SECONDS = 3.0

PopenFactory = Callable[..., subprocess.Popen[str]]


def normalize_watch_namespace(namespace: str | None) -> str:
    text = str(namespace or "all").strip()
    return text or "all"


def build_watch_args(resource: str, namespace: str) -> list[str]:
    args = ["get", resource, "-o", "json", "--watch=true", "--output-watch-events=true"]
    if namespace == "all":
        args.append("-A")
    elif namespace != "_cluster":
        args.extend(["-n", namespace])
    return args


@dataclass(frozen=True)
class WatchKey:
    cluster_id: str
    resource: str
    namespace: str

    def label(self) -> str:
        return f"{self.cluster_id}:{self.namespace}:{self.resource}"


@dataclass
class WatchSession:
    id: str
    key: WatchKey
    command_preview: str
    process: Any
    started_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    status: str = "running"
    stdout_lines: int = 0
    stderr_lines: int = 0
    cache_events: int = 0
    cache_invalidations: int = 0
    exit_code: int | None = None
    stopped_by_user: bool = False
    output_tail: Deque[str] = field(default_factory=lambda: deque(maxlen=WATCH_OUTPUT_TAIL_LINES))
    error_tail: Deque[str] = field(default_factory=lambda: deque(maxlen=WATCH_OUTPUT_TAIL_LINES))
    _lock: threading.RLock = field(default_factory=threading.RLock)

    def remember_stdout(self, line: str) -> None:
        with self._lock:
            self.stdout_lines += 1
            self.updated_at = time.time()
            text = (line or "").rstrip()
            if text:
                self.output_tail.append(text[:1000])

    def remember_stderr(self, line: str) -> None:
        with self._lock:
            self.stderr_lines += 1
            self.updated_at = time.time()
            text = (line or "").rstrip()
            if text:
                self.error_tail.append(text[:1000])

    def remember_cache_result(self, result: dict[str, Any]) -> None:
        if not result.get("parsed"):
            return
        with self._lock:
            self.cache_events += 1
            self.cache_invalidations += int(result.get("cleared") or 0)
            self.updated_at = time.time()

    def sync_status(self) -> None:
        poll = getattr(self.process, "poll", None)
        if not callable(poll):
            return
        code = poll()
        if code is None:
            return
        with self._lock:
            self.exit_code = code
            if self.status == "running":
                self.status = "stopped" if self.stopped_by_user or code == 0 else "failed"
            self.updated_at = time.time()

    def view(self) -> dict[str, Any]:
        self.sync_status()
        with self._lock:
            return {
                "id": self.id,
                "clusterId": self.key.cluster_id,
                "resource": self.key.resource,
                "namespace": self.key.namespace,
                "status": self.status,
                "pid": getattr(self.process, "pid", None),
                "startedAt": self.started_at,
                "updatedAt": self.updated_at,
                "ageSeconds": max(0.0, time.time() - self.started_at),
                "stdoutLines": self.stdout_lines,
                "stderrLines": self.stderr_lines,
                "cacheEvents": self.cache_events,
                "cacheInvalidations": self.cache_invalidations,
                "exitCode": self.exit_code,
                "stoppedByUser": self.stopped_by_user,
                "commandPreview": self.command_preview,
                "outputTail": list(self.output_tail),
                "errorTail": list(self.error_tail),
            }


class ResourceWatchManager:
    """Lifecycle foundation for Kubernetes watch -> cache -> WebSocket updates.

    Watch output is connected to ResourceSnapshotCache invalidation and parsed
    events are now published to the WebSocket event hub. HTTP polling remains
    the safe frontend fallback.
    """

    def __init__(self, popen_factory: PopenFactory | None = None) -> None:
        self._popen_factory = popen_factory or subprocess.Popen
        self._sessions_by_id: dict[str, WatchSession] = {}
        self._sessions_by_key: dict[WatchKey, str] = {}
        self._lock = threading.RLock()

    def start(self, command: KubectlCommand, resource: str, namespace: str) -> dict[str, Any]:
        key = WatchKey(cluster_id=command.cluster_id, resource=resource, namespace=normalize_watch_namespace(namespace))
        with self._lock:
            existing_id = self._sessions_by_key.get(key)
            if existing_id:
                existing = self._sessions_by_id.get(existing_id)
                if existing:
                    existing.sync_status()
                    if existing.status == "running":
                        view = existing.view()
                        view["alreadyRunning"] = True
                        return view

            process = self._spawn(command)
            session = WatchSession(
                id=str(uuid.uuid4()),
                key=key,
                command_preview=command.preview,
                process=process,
            )
            self._sessions_by_id[session.id] = session
            self._sessions_by_key[key] = session.id
            self._start_reader_threads(session)
            view = session.view()
            view["alreadyRunning"] = False
            return view

    def stop(self, watch_id: str) -> dict[str, Any]:
        with self._lock:
            session = self._sessions_by_id.get(watch_id)
        if session is None:
            return {"ok": False, "found": False, "id": watch_id}
        self._stop_session(session)
        return {"ok": True, "found": True, "watch": session.view()}

    def stop_all(self) -> dict[str, Any]:
        with self._lock:
            sessions = list(self._sessions_by_id.values())
        stopped = 0
        for session in sessions:
            if session.view()["status"] == "running":
                self._stop_session(session)
                stopped += 1
        return {"ok": True, "stopped": stopped, "watches": [session.view() for session in sessions]}

    def status(self) -> dict[str, Any]:
        with self._lock:
            sessions = list(self._sessions_by_id.values())
        views = [session.view() for session in sessions]
        running = sum(1 for item in views if item.get("status") == "running")
        return {
            "enabled": True,
            "mode": "cache-invalidation+websocket-events",
            "running": running,
            "total": len(views),
            "watches": views,
            "note": "Running watches parse Kubernetes watch events, invalidate affected resource-list cache entries, and publish lightweight WebSocket events. HTTP polling remains the fallback.",
        }

    def _spawn(self, command: KubectlCommand) -> Any:
        creationflags = 0
        if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
            creationflags = subprocess.CREATE_NO_WINDOW
        return self._popen_factory(
            command.argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=False,
            env=kubectl_environment(command.kubeconfig_path),
            creationflags=creationflags,
        )

    def _start_reader_threads(self, session: WatchSession) -> None:
        stdout = getattr(session.process, "stdout", None)
        stderr = getattr(session.process, "stderr", None)
        if stdout is not None:
            thread = threading.Thread(target=self._read_stream, args=(session, stdout, False), daemon=True)
            thread.start()
        if stderr is not None:
            thread = threading.Thread(target=self._read_stream, args=(session, stderr, True), daemon=True)
            thread.start()

    def _read_stream(self, session: WatchSession, stream: Any, is_stderr: bool) -> None:
        try:
            for line in iter(stream.readline, ""):
                if not line:
                    break
                if is_stderr:
                    session.remember_stderr(line)
                else:
                    session.remember_stdout(line)
                    try:
                        result = apply_watch_event_line_to_resource_cache(
                            session.key.cluster_id,
                            session.key.resource,
                            session.key.namespace,
                            line,
                        )
                        session.remember_cache_result(result)
                        if result.get("parsed"):
                            watch_event_hub.publish({
                                "type": "resource.changed",
                                "clusterId": session.key.cluster_id,
                                "watchId": session.id,
                                "resource": result.get("resource") or session.key.resource,
                                "namespace": result.get("namespace") or session.key.namespace,
                                "name": result.get("name") or "",
                                "eventType": result.get("eventType") or "OBJECT",
                                "cacheInvalidations": int(result.get("cleared") or 0),
                            })
                    except Exception as exc:  # pragma: no cover - defensive cache integration guard
                        session.remember_stderr(f"watch cache integration failed: {exc}")
        except Exception as exc:  # pragma: no cover - defensive thread guard
            session.remember_stderr(f"watch reader failed: {exc}")
        finally:
            session.sync_status()

    def _stop_session(self, session: WatchSession) -> None:
        with session._lock:
            session.stopped_by_user = True
            session.status = "stopping"
            session.updated_at = time.time()
        process = session.process
        try:
            if callable(getattr(process, "poll", None)) and process.poll() is None:
                if callable(getattr(process, "terminate", None)):
                    process.terminate()
                if callable(getattr(process, "wait", None)):
                    try:
                        process.wait(timeout=WATCH_STOP_TIMEOUT_SECONDS)
                    except TypeError:
                        process.wait()
                    except subprocess.TimeoutExpired:
                        if callable(getattr(process, "kill", None)):
                            process.kill()
                        process.wait(timeout=WATCH_STOP_TIMEOUT_SECONDS)
        finally:
            with session._lock:
                if callable(getattr(process, "poll", None)):
                    session.exit_code = process.poll()
                session.status = "stopped"
                session.updated_at = time.time()


resource_watch_manager = ResourceWatchManager()


def stop_all_resource_watches() -> dict[str, Any]:
    return resource_watch_manager.stop_all()
