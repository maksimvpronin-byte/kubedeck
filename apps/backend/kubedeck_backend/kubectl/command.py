from __future__ import annotations

import json
import logging
import os
import shlex
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import yaml

from kubedeck_backend.core.models import CommandResult, ErrorInfo
from kubedeck_backend.logging_config import sanitize_log_text


logger = logging.getLogger("kubedeck.kubectl")

DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024
ERROR_SNIPPET_CHARS = 12_000


@dataclass
class KubectlCommand:
    cluster_id: str
    kubeconfig_path: str | None
    args: list[str]
    kubectl_path: str = "kubectl"
    namespace: str | None = None
    dangerous_level: int = 0
    timeout_seconds: int = 30
    stream: bool = False
    cancellable: bool = True
    max_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES
    id: str = ""

    def __post_init__(self) -> None:
        if not self.id:
            self.id = str(uuid.uuid4())

    @property
    def argv(self) -> list[str]:
        base = [self.kubectl_path]
        if self.kubeconfig_path:
            base.extend(["--kubeconfig", self.kubeconfig_path])
        if self.timeout_seconds > 0 and not has_request_timeout(self.args):
            request_timeout = max(5, min(self.timeout_seconds, max(5, self.timeout_seconds - 5)))
            base.append(f"--request-timeout={request_timeout}s")
        return base + self.args

    @property
    def preview(self) -> str:
        return " ".join(quote_preview_arg(arg) for arg in self.argv)


class KubectlError(Exception):
    def __init__(self, info: ErrorInfo):
        super().__init__(info.message)
        self.info = info


class KubectlRunner:
    def run(self, command: KubectlCommand, stdin: str | None = None, allowed_return_codes: tuple[int, ...] = (0,)) -> CommandResult:
        logger.info("kubectl preview=%s timeout=%ss maxOutput=%s", sanitize_log_text(command.preview), command.timeout_seconds, command.max_output_bytes)
        try:
            completed = subprocess.run(
                command.argv,
                input=stdin,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=None if command.timeout_seconds <= 0 else command.timeout_seconds,
                shell=False,
                env=kubectl_environment(command.kubeconfig_path),
            )
        except FileNotFoundError as exc:
            raise KubectlError(ErrorInfo(
                code="KUBECTL_NOT_FOUND",
                message=f"kubectl not found: {command.kubectl_path}",
                rawStderr=sanitize_log_text(str(exc)),
                commandPreview=command.preview,
            )) from exc
        except subprocess.TimeoutExpired as exc:
            stderr = decode_timeout_stream(exc.stderr)
            stdout = decode_timeout_stream(exc.stdout)
            raw = stderr or stdout
            raise KubectlError(ErrorInfo(
                code="TIMEOUT",
                message=f"kubectl command timed out after {command.timeout_seconds}s",
                rawStderr=truncate_text(sanitize_log_text(raw), ERROR_SNIPPET_CHARS),
                commandPreview=command.preview,
            )) from exc

        stdout = completed.stdout or ""
        stderr = completed.stderr or ""
        enforce_output_limit(command, stdout, stderr)

        safe_stderr = sanitize_log_text(stderr)
        if safe_stderr:
            logger.info("kubectl stderr summary=%s", truncate_text(safe_stderr, 800))
        result = CommandResult(
            ok=completed.returncode == 0,
            stdout=stdout,
            stderr=stderr,
            commandPreview=command.preview,
            returnCode=completed.returncode,
        )
        if completed.returncode not in allowed_return_codes:
            raise KubectlError(ErrorInfo(
                code=self.classify_error(stderr),
                message="kubectl command failed",
                rawStderr=truncate_text(safe_stderr, ERROR_SNIPPET_CHARS),
                commandPreview=command.preview,
            ))
        return result

    def run_json(self, command: KubectlCommand) -> dict:
        result = self.run(command)
        if not result.stdout.strip():
            raise KubectlError(ErrorInfo(
                code="KUBECTL_EMPTY_RESPONSE",
                message="kubectl returned an empty response instead of JSON",
                rawStderr="",
                commandPreview=command.preview,
            ))
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise KubectlError(ErrorInfo(
                code="KUBECTL_INVALID_JSON",
                message="kubectl returned invalid JSON",
                rawStderr=truncate_text(sanitize_log_text(str(exc)), ERROR_SNIPPET_CHARS),
                commandPreview=command.preview,
            )) from exc

    @staticmethod
    def classify_error(stderr: str) -> str:
        lowered = (stderr or "").lower()
        if "forbidden" in lowered:
            return "FORBIDDEN"
        if "unauthorized" in lowered or "the server has asked for the client to provide credentials" in lowered:
            return "UNAUTHORIZED"
        if "not found" in lowered:
            return "NOT_FOUND"
        if "timed out" in lowered or "deadline exceeded" in lowered or "context deadline exceeded" in lowered:
            return "TIMEOUT"
        if "connection refused" in lowered or "no route to host" in lowered or "i/o timeout" in lowered:
            return "CLUSTER_UNAVAILABLE"
        if "certificate" in lowered and ("unknown authority" in lowered or "expired" in lowered):
            return "TLS_ERROR"
        return "KUBECTL_COMMAND_FAILED"


def kubeconfig_exists(path: str) -> bool:
    return Path(path).exists()


def kubectl_environment(kubeconfig_path: str | None) -> dict[str, str]:
    env = os.environ.copy()
    additions = ["localhost", "127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
    server_host = kubeconfig_server_host(kubeconfig_path)
    if server_host:
        additions.append(server_host)

    existing = env.get("NO_PROXY") or env.get("no_proxy") or ""
    merged = merge_no_proxy(existing, additions)
    env["NO_PROXY"] = merged
    env["no_proxy"] = merged
    return env


def merge_no_proxy(existing: str, additions: list[str]) -> str:
    values: list[str] = []
    seen: set[str] = set()
    for item in [*existing.split(","), *additions]:
        value = item.strip()
        key = value.lower()
        if value and key not in seen:
            values.append(value)
            seen.add(key)
    return ",".join(values)


def kubeconfig_server_host(kubeconfig_path: str | None) -> str:
    if not kubeconfig_path:
        return ""
    try:
        data = yaml.safe_load(Path(kubeconfig_path).read_text(encoding="utf-8")) or {}
        current_context = data.get("current-context", "")
        context = next((item for item in data.get("contexts", []) if item.get("name") == current_context), None)
        cluster_name = ((context or {}).get("context") or {}).get("cluster")
        cluster = next((item for item in data.get("clusters", []) if item.get("name") == cluster_name), None)
        server = ((cluster or {}).get("cluster") or {}).get("server", "")
        return urlparse(server).hostname or ""
    except Exception:
        return ""


def has_request_timeout(args: list[str]) -> bool:
    return any(arg == "--request-timeout" or arg.startswith("--request-timeout=") for arg in args)


def quote_preview_arg(arg: str) -> str:
    if os.name == "nt":
        if not arg or any(char.isspace() for char in arg) or any(char in arg for char in ['"', "'", "&", "|", "<", ">"]):
            return '"' + arg.replace('"', '\\"') + '"'
        return arg
    return shlex.quote(arg)


def decode_timeout_stream(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value


def output_size(value: str) -> int:
    return len(value.encode("utf-8", "replace"))


def enforce_output_limit(command: KubectlCommand, stdout: str, stderr: str) -> None:
    if command.max_output_bytes <= 0:
        return
    total = output_size(stdout) + output_size(stderr)
    if total <= command.max_output_bytes:
        return
    raise KubectlError(ErrorInfo(
        code="OUTPUT_TOO_LARGE",
        message=f"kubectl output is too large ({total} bytes, limit {command.max_output_bytes} bytes). Narrow the namespace/resource or reduce logs tail.",
        rawStderr=truncate_text(sanitize_log_text(stderr or stdout), ERROR_SNIPPET_CHARS),
        commandPreview=command.preview,
    ))


def truncate_text(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + f"\n... truncated, {len(value) - limit} more characters ..."
