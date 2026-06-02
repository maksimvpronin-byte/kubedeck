from __future__ import annotations

import os
from pathlib import Path


APP_NAME = "KubeDeck"


def appdata_dir() -> Path:
    base = os.environ.get("APPDATA")
    if base:
        return Path(base) / APP_NAME
    return Path.home() / ".kubedeck"


def ensure_app_dirs() -> dict[str, Path]:
    root = appdata_dir()
    kubeconfigs = root / "kubeconfigs"
    logs = root / "logs"
    for path in (root, kubeconfigs, logs):
        path.mkdir(parents=True, exist_ok=True)
    return {"root": root, "kubeconfigs": kubeconfigs, "logs": logs}


def config_path() -> Path:
    return appdata_dir() / "config.json"
