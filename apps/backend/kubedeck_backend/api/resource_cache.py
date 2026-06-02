from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from threading import RLock
from typing import Any, Iterable


@dataclass(frozen=True)
class ResourceSnapshotKey:
    cluster_id: str
    resource: str
    namespace: str

    def label(self) -> str:
        return f"{self.cluster_id}:{self.namespace}:{self.resource}"


@dataclass
class ResourceSnapshotEntry:
    key: ResourceSnapshotKey
    value: dict[str, Any]
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    ttl_seconds: float = 0.0
    hits: int = 0

    def expired(self, now: float | None = None) -> bool:
        if self.ttl_seconds <= 0:
            return False
        current = time.time() if now is None else now
        return current - self.updated_at > self.ttl_seconds

    def view(self) -> dict[str, Any]:
        items = self.value.get("items") if isinstance(self.value, dict) else None
        raw_count = self.value.get("rawCount") if isinstance(self.value, dict) else None
        return {
            "clusterId": self.key.cluster_id,
            "resource": self.key.resource,
            "namespace": self.key.namespace,
            "items": len(items) if isinstance(items, list) else raw_count,
            "rawCount": raw_count,
            "ageSeconds": max(0.0, time.time() - self.updated_at),
            "ttlSeconds": self.ttl_seconds,
            "hits": self.hits,
        }


_RESOURCE_ALIAS_GROUPS: tuple[set[str], ...] = (
    {"pod", "pods"},
    {"deployment", "deployments", "deployment.apps", "deployments.apps"},
    {"statefulset", "statefulsets", "statefulset.apps", "statefulsets.apps"},
    {"daemonset", "daemonsets", "daemonset.apps", "daemonsets.apps"},
    {"replicaset", "replicasets", "replicaset.apps", "replicasets.apps"},
    {"job", "jobs", "job.batch", "jobs.batch"},
    {"cronjob", "cronjobs", "cronjob.batch", "cronjobs.batch"},
    {"service", "services", "svc"},
    {"ingress", "ingresses", "ingress.networking.k8s.io", "ingresses.networking.k8s.io"},
    {"configmap", "configmaps", "cm"},
    {"secret", "secrets"},
    {"namespace", "namespaces", "ns"},
    {"node", "nodes"},
    {"serviceaccount", "serviceaccounts", "sa"},
    {"role", "roles", "role.rbac.authorization.k8s.io", "roles.rbac.authorization.k8s.io"},
    {"clusterrole", "clusterroles", "clusterrole.rbac.authorization.k8s.io", "clusterroles.rbac.authorization.k8s.io"},
    {"rolebinding", "rolebindings", "rolebinding.rbac.authorization.k8s.io", "rolebindings.rbac.authorization.k8s.io"},
    {"clusterrolebinding", "clusterrolebindings", "clusterrolebinding.rbac.authorization.k8s.io", "clusterrolebindings.rbac.authorization.k8s.io"},
    {"customresourcedefinition", "customresourcedefinitions", "crd", "crds", "customresourcedefinition.apiextensions.k8s.io", "customresourcedefinitions.apiextensions.k8s.io"},
)

_KIND_RESOURCE_ALIASES: dict[str, set[str]] = {
    "pod": {"pod", "pods"},
    "deployment": {"deployment", "deployments", "deployment.apps", "deployments.apps", "pod", "pods", "replicaset", "replicasets"},
    "statefulset": {"statefulset", "statefulsets", "statefulset.apps", "statefulsets.apps", "pod", "pods"},
    "daemonset": {"daemonset", "daemonsets", "daemonset.apps", "daemonsets.apps", "pod", "pods"},
    "replicaset": {"replicaset", "replicasets", "replicaset.apps", "replicasets.apps", "pod", "pods"},
    "job": {"job", "jobs", "job.batch", "jobs.batch", "pod", "pods"},
    "cronjob": {"cronjob", "cronjobs", "cronjob.batch", "cronjobs.batch", "job", "jobs", "pod", "pods"},
    "service": {"service", "services", "svc"},
    "ingress": {"ingress", "ingresses", "ingress.networking.k8s.io", "ingresses.networking.k8s.io"},
    "configmap": {"configmap", "configmaps", "cm"},
    "secret": {"secret", "secrets"},
    "namespace": {"namespace", "namespaces", "ns"},
    "node": {"node", "nodes"},
    "serviceaccount": {"serviceaccount", "serviceaccounts", "sa"},
    "role": {"role", "roles", "role.rbac.authorization.k8s.io", "roles.rbac.authorization.k8s.io"},
    "clusterrole": {"clusterrole", "clusterroles", "clusterrole.rbac.authorization.k8s.io", "clusterroles.rbac.authorization.k8s.io"},
    "rolebinding": {"rolebinding", "rolebindings", "rolebinding.rbac.authorization.k8s.io", "rolebindings.rbac.authorization.k8s.io"},
    "clusterrolebinding": {"clusterrolebinding", "clusterrolebindings", "clusterrolebinding.rbac.authorization.k8s.io", "clusterrolebindings.rbac.authorization.k8s.io"},
    "customresourcedefinition": {"customresourcedefinition", "customresourcedefinitions", "crd", "crds", "customresourcedefinition.apiextensions.k8s.io", "customresourcedefinitions.apiextensions.k8s.io"},
}

_WORKLOAD_RESOURCES = {
    "deployment",
    "deployments",
    "deployment.apps",
    "deployments.apps",
    "statefulset",
    "statefulsets",
    "statefulset.apps",
    "statefulsets.apps",
    "daemonset",
    "daemonsets",
    "daemonset.apps",
    "daemonsets.apps",
    "replicaset",
    "replicasets",
    "replicaset.apps",
    "replicasets.apps",
    "job",
    "jobs",
    "job.batch",
    "jobs.batch",
    "cronjob",
    "cronjobs",
    "cronjob.batch",
    "cronjobs.batch",
}


def _normalize_resource_name(value: str) -> str:
    return str(value or "").strip().lower()


def resource_aliases(resource: str) -> set[str]:
    normalized = _normalize_resource_name(resource)
    if not normalized:
        return set()
    aliases = {normalized}
    for group in _RESOURCE_ALIAS_GROUPS:
        if normalized in group:
            aliases.update(group)
            break
    return aliases


def kind_resource_aliases(kind: str) -> set[str]:
    normalized = _normalize_resource_name(kind)
    return set(_KIND_RESOURCE_ALIASES.get(normalized, set()))


def affected_snapshot_namespaces(namespace: str) -> set[str]:
    normalized = str(namespace or "").strip() or "_cluster"
    if normalized == "_cluster":
        return {"_cluster", "all"}
    if normalized == "all":
        return {"all"}
    return {normalized, "all"}


DISCOVERY_API_RESOURCES_CACHE_RESOURCE = "_discovery.api-resources"
DISCOVERY_API_RESOURCES_CACHE_NAMESPACE = "_cluster"
DISCOVERY_API_RESOURCES_CACHE_TTL_SECONDS = 60.0
RESOURCE_LIST_CACHE_TTL_SECONDS = 15.0


class ResourceSnapshotCache:
    """Small thread-safe in-memory cache for discovery and resource lists.

    Manual resource loads bypass cached reads by passing forceRefresh=true.
    Silent refreshes may reuse fresh resource-list snapshots, while kubectl
    watch events and mutating actions invalidate affected snapshots before the
    next refresh.
    """

    def __init__(self, default_ttl_seconds: float = 0.0) -> None:
        self._default_ttl_seconds = default_ttl_seconds
        self._entries: dict[ResourceSnapshotKey, ResourceSnapshotEntry] = {}
        self._invalidations: list[dict[str, Any]] = []
        self._lock = RLock()

    def get(self, key: ResourceSnapshotKey) -> dict[str, Any] | None:
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            if entry.expired():
                self._entries.pop(key, None)
                return None
            entry.hits += 1
            return dict(entry.value)

    def set(self, key: ResourceSnapshotKey, value: dict[str, Any], ttl_seconds: float | None = None) -> dict[str, Any]:
        ttl = self._default_ttl_seconds if ttl_seconds is None else ttl_seconds
        with self._lock:
            self._entries[key] = ResourceSnapshotEntry(key=key, value=dict(value), ttl_seconds=ttl)
            return dict(value)

    def clear(self, cluster_id: str | None = None) -> int:
        with self._lock:
            if cluster_id is None:
                cleared = len(self._entries)
                self._entries.clear()
                self._remember_invalidation("manual.clear_all", cleared=cleared)
                return cleared
            keys = [key for key in self._entries if key.cluster_id == cluster_id]
            for key in keys:
                self._entries.pop(key, None)
            self._remember_invalidation("manual.clear_cluster", cluster_id=cluster_id, cleared=len(keys))
            return len(keys)

    def clear_matching(
        self,
        *,
        cluster_id: str | None = None,
        resources: Iterable[str] | None = None,
        namespaces: Iterable[str] | None = None,
        reason: str = "manual.clear_matching",
    ) -> int:
        resource_filter = {_normalize_resource_name(item) for item in resources or [] if _normalize_resource_name(item)}
        namespace_filter = {str(item).strip() for item in namespaces or [] if str(item).strip()}
        with self._lock:
            keys = [
                key
                for key in self._entries
                if (cluster_id is None or key.cluster_id == cluster_id)
                and (not resource_filter or key.resource in resource_filter)
                and (not namespace_filter or key.namespace in namespace_filter)
            ]
            for key in keys:
                self._entries.pop(key, None)
            self._remember_invalidation(
                reason,
                cluster_id=cluster_id,
                resources=sorted(resource_filter),
                namespaces=sorted(namespace_filter),
                cleared=len(keys),
            )
            return len(keys)

    def stats(self) -> dict[str, Any]:
        with self._lock:
            entries = [entry.view() for entry in self._entries.values() if not entry.expired()]
            stale_keys = [key for key, entry in self._entries.items() if entry.expired()]
            for key in stale_keys:
                self._entries.pop(key, None)
            return {
                "enabled": True,
                "mode": "foundation+discovery+resource-list",
                "entries": len(entries),
                "items": entries,
                "resourcePollingEnabled": True,
                "discoveryCacheEnabled": True,
                "resourceListCacheEnabled": True,
                "resourceListTtlSeconds": RESOURCE_LIST_CACHE_TTL_SECONDS,
                "lastInvalidations": list(self._invalidations[-10:]),
                "note": "API resource discovery and silent resource-list refreshes use read-through cache. Manual refresh bypasses cached reads, while resource watches and mutating actions invalidate affected list snapshots before the next refresh.",
            }

    def _remember_invalidation(self, reason: str, **extra: Any) -> None:
        event = {"reason": reason, "at": time.time(), **extra}
        self._invalidations.append(event)
        if len(self._invalidations) > 50:
            self._invalidations = self._invalidations[-50:]


resource_snapshot_cache = ResourceSnapshotCache()


def resource_snapshot_key(cluster_id: str, resource: str, namespace: str) -> ResourceSnapshotKey:
    return ResourceSnapshotKey(cluster_id=cluster_id, resource=resource, namespace=namespace)


def resource_list_key(cluster_id: str, resource: str, namespace: str) -> ResourceSnapshotKey:
    return resource_snapshot_key(cluster_id, _normalize_resource_name(resource), str(namespace or "all").strip() or "all")


def get_cached_resource_list_response(cluster_id: str, resource: str, namespace: str) -> dict[str, Any] | None:
    cached = resource_snapshot_cache.get(resource_list_key(cluster_id, resource, namespace))
    if cached is None:
        return None
    items = cached.get("items")
    if not isinstance(items, list):
        return None
    response = dict(cached)
    response["items"] = list(items)
    response["rawCount"] = int(response.get("rawCount") or len(items))
    response["cached"] = True
    response["cacheTtlSeconds"] = RESOURCE_LIST_CACHE_TTL_SECONDS
    return response


def set_cached_resource_list_response(cluster_id: str, resource: str, namespace: str, response: dict[str, Any]) -> dict[str, Any]:
    items = response.get("items")
    if not isinstance(items, list):
        return response
    value = {
        "items": list(items),
        "rawCount": int(response.get("rawCount") or len(items)),
        "kind": "ResourceList",
        "cached": False,
        "cacheTtlSeconds": RESOURCE_LIST_CACHE_TTL_SECONDS,
    }
    resource_snapshot_cache.set(
        resource_list_key(cluster_id, resource, namespace),
        value,
        ttl_seconds=RESOURCE_LIST_CACHE_TTL_SECONDS,
    )
    result = dict(value)
    result["items"] = list(items)
    return result



def apply_watch_event_line_to_resource_cache(cluster_id: str, resource: str, namespace: str, line: str) -> dict[str, Any]:
    """Invalidate resource-list cache entries affected by one kubectl watch line.

    kubectl is started with --output-watch-events=true, so normal lines are
    newline-delimited JSON objects like {"type":"MODIFIED","object":{...}}.
    If kubectl emits a plain object or a non-JSON progress line, this helper is
    intentionally tolerant: it returns parsed=False instead of raising from the
    reader thread.
    """
    text = (line or "").strip()
    if not text:
        return {"parsed": False, "cleared": 0, "reason": "empty"}
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return {"parsed": False, "cleared": 0, "reason": "not_json"}
    if not isinstance(payload, dict):
        return {"parsed": False, "cleared": 0, "reason": "not_object"}

    event_type = str(payload.get("type") or "OBJECT").strip().upper() or "OBJECT"
    raw_object = payload.get("object")
    if not isinstance(raw_object, dict) and isinstance(payload.get("metadata"), dict):
        raw_object = payload
    if not isinstance(raw_object, dict):
        return {"parsed": False, "cleared": 0, "reason": "missing_object", "eventType": event_type}

    metadata = raw_object.get("metadata") if isinstance(raw_object.get("metadata"), dict) else {}
    object_name = str(metadata.get("name") or "")
    object_namespace = str(metadata.get("namespace") or "").strip()
    watch_namespace = str(namespace or "all").strip() or "all"

    if not object_namespace:
        object_namespace = "_cluster" if watch_namespace == "_cluster" else watch_namespace

    resources = resource_aliases(resource)
    namespaces = affected_snapshot_namespaces(object_namespace)
    cleared = invalidate_resource_snapshot_cache(
        cluster_id,
        resources=resources,
        namespaces=namespaces,
        reason=f"watch.{event_type.lower()}",
    )["cleared"]
    return {
        "parsed": True,
        "cleared": cleared,
        "eventType": event_type,
        "resource": _normalize_resource_name(resource),
        "namespace": object_namespace,
        "name": object_name,
    }

def resource_snapshot_cache_stats() -> dict[str, Any]:
    return resource_snapshot_cache.stats()


def clear_resource_snapshot_cache(cluster_id: str | None = None) -> dict[str, Any]:
    return {"cleared": resource_snapshot_cache.clear(cluster_id)}


def discovery_resource_definitions_key(cluster_id: str) -> ResourceSnapshotKey:
    return resource_snapshot_key(
        cluster_id,
        DISCOVERY_API_RESOURCES_CACHE_RESOURCE,
        DISCOVERY_API_RESOURCES_CACHE_NAMESPACE,
    )


def get_cached_discovery_resource_definitions(cluster_id: str) -> list[dict[str, Any]] | None:
    cached = resource_snapshot_cache.get(discovery_resource_definitions_key(cluster_id))
    if not cached:
        return None
    items = cached.get("items")
    if not isinstance(items, list):
        return None
    return [dict(item) for item in items if isinstance(item, dict)]


def set_cached_discovery_resource_definitions(cluster_id: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized_items = [dict(item) for item in items]
    resource_snapshot_cache.set(
        discovery_resource_definitions_key(cluster_id),
        {
            "items": normalized_items,
            "rawCount": len(normalized_items),
            "kind": "ApiResourceDefinitions",
        },
        ttl_seconds=DISCOVERY_API_RESOURCES_CACHE_TTL_SECONDS,
    )
    return normalized_items


def invalidate_discovery_resource_definitions_cache(cluster_id: str, reason: str = "discovery.invalidate") -> int:
    return resource_snapshot_cache.clear_matching(
        cluster_id=cluster_id,
        resources={DISCOVERY_API_RESOURCES_CACHE_RESOURCE},
        namespaces={DISCOVERY_API_RESOURCES_CACHE_NAMESPACE},
        reason=reason,
    )


def invalidate_resource_snapshot_cache(
    cluster_id: str,
    *,
    resources: Iterable[str] | None = None,
    namespaces: Iterable[str] | None = None,
    reason: str = "resource.mutation",
) -> dict[str, Any]:
    cleared = resource_snapshot_cache.clear_matching(
        cluster_id=cluster_id,
        resources=resources,
        namespaces=namespaces,
        reason=reason,
    )
    return {"cleared": cleared}


def invalidate_after_resource_action(cluster_id: str, resource: str, namespace: str, action: str) -> dict[str, Any]:
    normalized_resource = _normalize_resource_name(resource)
    normalized_action = _normalize_resource_name(action)
    resources = resource_aliases(normalized_resource)
    namespaces = affected_snapshot_namespaces(namespace)

    if normalized_resource in _WORKLOAD_RESOURCES and normalized_action in {"delete", "restart", "redeploy", "scale"}:
        resources.update(resource_aliases("pods"))
        resources.update(resource_aliases("replicasets"))

    if normalized_resource in resource_aliases("namespaces"):
        # Namespace mutations can affect almost every namespaced resource list.
        return {"cleared": resource_snapshot_cache.clear(cluster_id)}

    cleared = invalidate_resource_snapshot_cache(
        cluster_id,
        resources=resources,
        namespaces=namespaces,
        reason=f"resource.{normalized_action}",
    )["cleared"]

    if resources & resource_aliases("customresourcedefinitions"):
        cleared += invalidate_discovery_resource_definitions_cache(cluster_id, reason=f"resource.{normalized_action}.discovery")

    return {"cleared": cleared}


def invalidate_after_yaml_apply(cluster_id: str, kind: str, namespace: str) -> dict[str, Any]:
    resources = kind_resource_aliases(kind)
    if not resources:
        # For custom resources the YAML kind usually cannot be mapped back to the
        # REST resource name without discovery. Use a broad cluster invalidation
        # so future cached lists never mask a successful apply.
        return {"cleared": resource_snapshot_cache.clear(cluster_id)}
    if resource_aliases("namespaces") & resources:
        return {"cleared": resource_snapshot_cache.clear(cluster_id)}

    cleared = invalidate_resource_snapshot_cache(
        cluster_id,
        resources=resources,
        namespaces=affected_snapshot_namespaces(namespace),
        reason="yaml.apply",
    )["cleared"]

    if resources & resource_aliases("customresourcedefinitions"):
        cleared += invalidate_discovery_resource_definitions_cache(cluster_id, reason="yaml.apply.discovery")

    return {"cleared": cleared}
