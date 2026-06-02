import time

from kubedeck_backend.api.resource_cache import (
    DISCOVERY_API_RESOURCES_CACHE_RESOURCE,
    DISCOVERY_API_RESOURCES_CACHE_TTL_SECONDS,
    RESOURCE_LIST_CACHE_TTL_SECONDS,
    ResourceSnapshotCache,
    apply_watch_event_line_to_resource_cache,
    get_cached_discovery_resource_definitions,
    get_cached_resource_list_response,
    invalidate_after_resource_action,
    invalidate_after_yaml_apply,
    resource_aliases,
    resource_snapshot_cache,
    resource_snapshot_key,
    set_cached_discovery_resource_definitions,
    set_cached_resource_list_response,
)


def test_resource_snapshot_cache_set_get_and_clear():
    cache = ResourceSnapshotCache(default_ttl_seconds=30)
    key = resource_snapshot_key("cluster-a", "pods", "default")

    cache.set(key, {"items": [{"name": "pod-a"}], "rawCount": 1})

    cached = cache.get(key)
    assert cached is not None
    assert cached["rawCount"] == 1
    assert cached["items"][0]["name"] == "pod-a"

    stats = cache.stats()
    assert stats["enabled"] is True
    assert stats["mode"] == "foundation+discovery+resource-list"
    assert stats["resourcePollingEnabled"] is True
    assert stats["entries"] == 1

    assert cache.clear("cluster-a") == 1
    assert cache.get(key) is None


def test_resource_snapshot_cache_expired_entry_is_removed():
    cache = ResourceSnapshotCache(default_ttl_seconds=0.001)
    key = resource_snapshot_key("cluster-a", "deployments", "default")
    cache.set(key, {"items": [], "rawCount": 0})

    time.sleep(0.01)

    assert cache.get(key) is None
    assert cache.stats()["entries"] == 0


def test_resource_snapshot_cache_clear_matching_by_resource_and_namespace():
    cache = ResourceSnapshotCache(default_ttl_seconds=30)
    cache.set(resource_snapshot_key("cluster-a", "pods", "default"), {"items": [], "rawCount": 0})
    cache.set(resource_snapshot_key("cluster-a", "pods", "all"), {"items": [], "rawCount": 0})
    cache.set(resource_snapshot_key("cluster-a", "deployments", "default"), {"items": [], "rawCount": 0})
    cache.set(resource_snapshot_key("cluster-b", "pods", "default"), {"items": [], "rawCount": 0})

    cleared = cache.clear_matching(cluster_id="cluster-a", resources={"pods"}, namespaces={"default", "all"})

    assert cleared == 2
    assert cache.get(resource_snapshot_key("cluster-a", "pods", "default")) is None
    assert cache.get(resource_snapshot_key("cluster-a", "pods", "all")) is None
    assert cache.get(resource_snapshot_key("cluster-a", "deployments", "default")) is not None
    assert cache.get(resource_snapshot_key("cluster-b", "pods", "default")) is not None


def test_resource_aliases_include_common_plural_and_group_forms():
    assert {"deployment", "deployments", "deployment.apps", "deployments.apps"}.issubset(resource_aliases("deployments"))
    assert {"customresourcedefinition", "customresourcedefinitions", "crd", "crds"}.issubset(resource_aliases("crds"))


def test_invalidate_after_resource_action_clears_resource_and_all_namespace_snapshots():
    resource_snapshot_cache.clear()
    resource_snapshot_cache.set(resource_snapshot_key("cluster-a", "pods", "default"), {"items": [], "rawCount": 0})
    resource_snapshot_cache.set(resource_snapshot_key("cluster-a", "pods", "all"), {"items": [], "rawCount": 0})
    resource_snapshot_cache.set(resource_snapshot_key("cluster-a", "services", "default"), {"items": [], "rawCount": 0})
    resource_snapshot_cache.set(resource_snapshot_key("cluster-b", "pods", "default"), {"items": [], "rawCount": 0})

    result = invalidate_after_resource_action("cluster-a", "pod", "default", "delete")

    assert result["cleared"] == 2
    assert resource_snapshot_cache.get(resource_snapshot_key("cluster-a", "pods", "default")) is None
    assert resource_snapshot_cache.get(resource_snapshot_key("cluster-a", "pods", "all")) is None
    assert resource_snapshot_cache.get(resource_snapshot_key("cluster-a", "services", "default")) is not None
    assert resource_snapshot_cache.get(resource_snapshot_key("cluster-b", "pods", "default")) is not None
    resource_snapshot_cache.clear()


def test_invalidate_after_workload_action_also_clears_pods_and_replicasets():
    resource_snapshot_cache.clear()
    resource_snapshot_cache.set(resource_snapshot_key("cluster-a", "deployments", "default"), {"items": [], "rawCount": 0})
    resource_snapshot_cache.set(resource_snapshot_key("cluster-a", "pods", "default"), {"items": [], "rawCount": 0})
    resource_snapshot_cache.set(resource_snapshot_key("cluster-a", "replicasets", "default"), {"items": [], "rawCount": 0})
    resource_snapshot_cache.set(resource_snapshot_key("cluster-a", "services", "default"), {"items": [], "rawCount": 0})

    result = invalidate_after_resource_action("cluster-a", "deployments", "default", "scale")

    assert result["cleared"] == 3
    assert resource_snapshot_cache.get(resource_snapshot_key("cluster-a", "deployments", "default")) is None
    assert resource_snapshot_cache.get(resource_snapshot_key("cluster-a", "pods", "default")) is None
    assert resource_snapshot_cache.get(resource_snapshot_key("cluster-a", "replicasets", "default")) is None
    assert resource_snapshot_cache.get(resource_snapshot_key("cluster-a", "services", "default")) is not None
    resource_snapshot_cache.clear()


def test_invalidate_after_yaml_apply_unknown_kind_clears_cluster():
    resource_snapshot_cache.clear()
    resource_snapshot_cache.set(resource_snapshot_key("cluster-a", "widgets.example.com", "default"), {"items": [], "rawCount": 0})
    resource_snapshot_cache.set(resource_snapshot_key("cluster-a", "pods", "default"), {"items": [], "rawCount": 0})
    resource_snapshot_cache.set(resource_snapshot_key("cluster-b", "pods", "default"), {"items": [], "rawCount": 0})

    result = invalidate_after_yaml_apply("cluster-a", "Widget", "default")

    assert result["cleared"] == 2
    assert resource_snapshot_cache.get(resource_snapshot_key("cluster-a", "widgets.example.com", "default")) is None
    assert resource_snapshot_cache.get(resource_snapshot_key("cluster-a", "pods", "default")) is None
    assert resource_snapshot_cache.get(resource_snapshot_key("cluster-b", "pods", "default")) is not None
    resource_snapshot_cache.clear()


def test_discovery_resource_definitions_use_resource_snapshot_cache():
    resource_snapshot_cache.clear()
    items = [{"name": "widgets", "apiGroup": "example.com", "kind": "Widget", "namespaced": True}]

    set_cached_discovery_resource_definitions("cluster-a", items)

    cached = get_cached_discovery_resource_definitions("cluster-a")
    assert cached == items

    stats = resource_snapshot_cache.stats()
    assert stats["mode"] == "foundation+discovery+resource-list"
    assert stats["discoveryCacheEnabled"] is True
    assert stats["resourcePollingEnabled"] is True
    assert stats["resourceListCacheEnabled"] is True
    assert stats["entries"] == 1
    assert stats["items"][0]["resource"] == DISCOVERY_API_RESOURCES_CACHE_RESOURCE
    assert stats["items"][0]["ttlSeconds"] == DISCOVERY_API_RESOURCES_CACHE_TTL_SECONDS
    resource_snapshot_cache.clear()


def test_crd_mutations_invalidate_discovery_cache():
    resource_snapshot_cache.clear()
    set_cached_discovery_resource_definitions("cluster-a", [{"name": "widgets", "apiGroup": "example.com"}])
    resource_snapshot_cache.set(resource_snapshot_key("cluster-a", "customresourcedefinitions", "_cluster"), {"items": [], "rawCount": 0})

    result = invalidate_after_resource_action("cluster-a", "customresourcedefinitions", "_cluster", "delete")

    assert result["cleared"] == 2
    assert get_cached_discovery_resource_definitions("cluster-a") is None
    assert resource_snapshot_cache.get(resource_snapshot_key("cluster-a", "customresourcedefinitions", "_cluster")) is None
    resource_snapshot_cache.clear()


def test_resource_list_response_cache_marks_cached_reads():
    resource_snapshot_cache.clear()
    response = {"items": [{"name": "pod-a"}], "rawCount": 1, "cached": False}

    stored = set_cached_resource_list_response("cluster-a", "pods", "default", response)
    cached = get_cached_resource_list_response("cluster-a", "pods", "default")

    assert stored["cached"] is False
    assert cached is not None
    assert cached["cached"] is True
    assert cached["rawCount"] == 1
    assert cached["items"][0]["name"] == "pod-a"
    assert cached["cacheTtlSeconds"] == RESOURCE_LIST_CACHE_TTL_SECONDS
    stats = resource_snapshot_cache.stats()
    assert stats["items"][0]["resource"] == "pods"
    assert stats["items"][0]["namespace"] == "default"
    assert stats["items"][0]["ttlSeconds"] == RESOURCE_LIST_CACHE_TTL_SECONDS
    resource_snapshot_cache.clear()


def test_resource_list_cache_is_cleared_by_existing_invalidation_helpers():
    resource_snapshot_cache.clear()
    set_cached_resource_list_response("cluster-a", "pods", "default", {"items": [], "rawCount": 0})
    set_cached_resource_list_response("cluster-a", "pods", "all", {"items": [], "rawCount": 0})
    set_cached_resource_list_response("cluster-a", "services", "default", {"items": [], "rawCount": 0})

    result = invalidate_after_resource_action("cluster-a", "pods", "default", "delete")

    assert result["cleared"] == 2
    assert get_cached_resource_list_response("cluster-a", "pods", "default") is None
    assert get_cached_resource_list_response("cluster-a", "pods", "all") is None
    assert get_cached_resource_list_response("cluster-a", "services", "default") is not None
    resource_snapshot_cache.clear()



def test_watch_event_line_invalidates_resource_list_cache_for_namespace_and_all():
    resource_snapshot_cache.clear()
    set_cached_resource_list_response("cluster-a", "pods", "default", {"items": [{"name": "pod-a"}], "rawCount": 1})
    set_cached_resource_list_response("cluster-a", "pods", "all", {"items": [{"name": "pod-a"}], "rawCount": 1})
    set_cached_resource_list_response("cluster-a", "services", "default", {"items": [], "rawCount": 0})

    result = apply_watch_event_line_to_resource_cache(
        "cluster-a",
        "pods",
        "all",
        '{"type":"MODIFIED","object":{"metadata":{"name":"pod-a","namespace":"default"}}}',
    )

    assert result["parsed"] is True
    assert result["eventType"] == "MODIFIED"
    assert result["cleared"] == 2
    assert get_cached_resource_list_response("cluster-a", "pods", "default") is None
    assert get_cached_resource_list_response("cluster-a", "pods", "all") is None
    assert get_cached_resource_list_response("cluster-a", "services", "default") is not None
    resource_snapshot_cache.clear()


def test_watch_event_line_ignores_non_json_reader_output():
    resource_snapshot_cache.clear()
    set_cached_resource_list_response("cluster-a", "pods", "default", {"items": [{"name": "pod-a"}], "rawCount": 1})

    result = apply_watch_event_line_to_resource_cache("cluster-a", "pods", "default", "not json")

    assert result["parsed"] is False
    assert result["cleared"] == 0
    assert get_cached_resource_list_response("cluster-a", "pods", "default") is not None
    resource_snapshot_cache.clear()
