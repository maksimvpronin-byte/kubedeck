from __future__ import annotations

import asyncio

from kubedeck_backend.api.watch_events import WatchEventHub, event_matches_subscription


def test_event_matches_subscription_filters_cluster_resource_and_namespace():
    event = {
        "type": "resource.changed",
        "clusterId": "cluster-a",
        "resource": "pods",
        "namespace": "default",
        "name": "pod-a",
    }

    assert event_matches_subscription(event, cluster_id="cluster-a", resource="pods", namespace="default") is True
    assert event_matches_subscription(event, cluster_id="cluster-a", resource="pods", namespace="all") is True
    assert event_matches_subscription(event, cluster_id="cluster-a", resource="deployments", namespace="all") is False
    assert event_matches_subscription(event, cluster_id="cluster-b", resource="pods", namespace="all") is False
    assert event_matches_subscription(event, cluster_id="cluster-a", resource="pods", namespace="kube-system") is False


def test_event_matches_subscription_handles_cluster_scoped_events():
    event = {
        "type": "resource.changed",
        "clusterId": "cluster-a",
        "resource": "nodes",
        "namespace": "_cluster",
        "name": "node-a",
    }

    assert event_matches_subscription(event, cluster_id="cluster-a", resource="nodes", namespace="_cluster") is True
    assert event_matches_subscription(event, cluster_id="cluster-a", resource="nodes", namespace="all") is True
    assert event_matches_subscription(event, cluster_id="cluster-a", resource="nodes", namespace="default") is False


def test_watch_event_hub_publishes_to_async_subscriber_queue():
    async def run_case() -> None:
        hub = WatchEventHub(queue_size=5)
        subscriber = await hub.subscribe()
        try:
            hub.publish({"clusterId": "cluster-a", "resource": "pods", "namespace": "default"})
            event = await asyncio.wait_for(subscriber.queue.get(), timeout=1.0)
            assert event["type"] == "resource.changed"
            assert event["clusterId"] == "cluster-a"
            assert event["resource"] == "pods"
            assert event["namespace"] == "default"
            assert isinstance(event["at"], float)
        finally:
            await hub.unsubscribe(subscriber.id)

    asyncio.run(run_case())
