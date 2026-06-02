from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

from kubedeck_backend.core.paths import ensure_app_dirs


SENSITIVE_MARKERS = (
    "token",
    "password",
    "passwd",
    "secret",
    "client-key-data",
    "client-certificate-data",
    "certificate-authority-data",
    "authorization",
    "bearer",
    "api-key",
    "apikey",
    "private-key",
)


def sanitize_log_text(value: str) -> str:
    text = value or ""
    lines: list[str] = []
    for line in text.splitlines():
        lowered = line.lower()
        if any(marker in lowered for marker in SENSITIVE_MARKERS):
            lines.append("[redacted sensitive line]")
        else:
            lines.append(line)
    return "\n".join(lines)


def configure_logging() -> None:
    logs = ensure_app_dirs()["logs"]
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()

    backend_handler = log_handler(logs / "backend.log")
    backend_handler.setFormatter(formatter)
    kubectl_handler = log_handler(logs / "kubectl.log")
    kubectl_handler.setFormatter(formatter)

    root.addHandler(backend_handler)
    logging.getLogger("kubedeck.kubectl").addHandler(kubectl_handler)


def log_handler(path: Path) -> logging.Handler:
    try:
        return RotatingFileHandler(path, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    except PermissionError:
        fallback = path.with_name(f"{path.stem}-{os.getpid()}{path.suffix}")
        try:
            return RotatingFileHandler(fallback, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
        except PermissionError:
            return logging.StreamHandler()
