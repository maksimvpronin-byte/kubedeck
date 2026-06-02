from __future__ import annotations

import json
import os
import shutil
import uuid
from pathlib import Path

from kubedeck_backend.core.models import AppConfig, Cluster, Settings, utc_now
from kubedeck_backend.core.paths import config_path, ensure_app_dirs


class ConfigStore:
    def __init__(self) -> None:
        ensure_app_dirs()
        self.path = config_path()
        if not self.path.exists():
            self.save(default_config())

    def load(self) -> AppConfig:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return AppConfig.model_validate(data)
        except Exception:
            backup = self.path.with_suffix(".broken.json")
            try:
                shutil.copy2(self.path, backup)
            except Exception:
                pass
            config = default_config()
            self.save(config)
            return config

    def save(self, config: AppConfig) -> AppConfig:
        self.path.write_text(config.model_dump_json(indent=2), encoding="utf-8")
        return config

    def update_settings(self, settings: Settings) -> AppConfig:
        validate_kubectl_path(settings.kubectlPath)
        config = self.load()
        config.settings = settings
        return self.save(config)

    def import_cluster(self, source_path: str, display_name: str | None) -> Cluster:
        source = Path(source_path)
        if not source.exists() or not source.is_file():
            raise FileNotFoundError(f"Kubeconfig file not found: {source_path}")

        config = self.load()
        cluster_id = str(uuid.uuid4())
        target = ensure_app_dirs()["kubeconfigs"] / f"{cluster_id}.yaml"
        shutil.copy2(source, target)
        cluster = Cluster(
            id=cluster_id,
            displayName=display_name or source.stem,
            kubeconfigPath=str(target),
            lastOpened=False,
        )
        config.clusters.append(cluster)
        self.save(config)
        return cluster

    def rename_cluster(self, cluster_id: str, display_name: str) -> Cluster:
        config = self.load()
        cluster = self.get_cluster(cluster_id, config)
        cluster.displayName = display_name.strip() or cluster.displayName
        cluster.updatedAt = utc_now()
        self.save(config)
        return cluster

    def remove_cluster(self, cluster_id: str) -> None:
        config = self.load()
        cluster = self.get_cluster(cluster_id, config)
        config.clusters = [item for item in config.clusters if item.id != cluster_id]
        self.save(config)
        path = Path(cluster.kubeconfigPath)
        kubeconfigs_dir = ensure_app_dirs()["kubeconfigs"]
        if is_relative_to(path, kubeconfigs_dir) and path.exists() and path.is_file():
            path.unlink()

    def mark_opened(self, cluster_id: str) -> Cluster:
        config = self.load()
        selected = self.get_cluster(cluster_id, config)
        for cluster in config.clusters:
            cluster.lastOpened = cluster.id == cluster_id
            if cluster.id == cluster_id:
                cluster.updatedAt = utc_now()
        self.save(config)
        return selected

    def last_opened(self) -> Cluster | None:
        config = self.load()
        return next((cluster for cluster in config.clusters if cluster.lastOpened), None)

    def get_cluster(self, cluster_id: str, config: AppConfig | None = None) -> Cluster:
        cfg = config or self.load()
        for cluster in cfg.clusters:
            if cluster.id == cluster_id:
                return cluster
        raise KeyError(f"Cluster not found: {cluster_id}")


def default_config() -> AppConfig:
    kubectl_path = os.environ.get("KUBEDECK_KUBECTL_PATH", "").strip()
    if kubectl_path:
        return AppConfig(settings=Settings(kubectlPath=kubectl_path))
    return AppConfig()


def is_relative_to(path: Path, base: Path) -> bool:
    try:
        path.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False


def validate_kubectl_path(value: str) -> None:
    text = (value or "").strip()
    if not text:
        raise ValueError("kubectlPath must not be empty")
    if text in {"kubectl", "kubectl.exe"}:
        return
    path = Path(text)
    if path.name.lower() not in {"kubectl", "kubectl.exe"}:
        raise ValueError("kubectlPath must point to kubectl or kubectl.exe")
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"kubectlPath does not exist: {text}")
