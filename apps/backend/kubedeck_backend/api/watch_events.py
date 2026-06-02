from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from threading import RLock
from dataclasses import dataclass, field
from typing import Any


WATCH_EVENT_QUEUE_SIZE = 200


@dataclass
class WatchEventSubscriber:
    id: str
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue[dict[str, Any]]
    created_at: float = field(default_factory=time.time)


class WatchEventHub:
    """Thread-safe fan-out hub for resource watch events.

    kubectl watch reader threads publish parsed Kubernetes watch events here.
    FastAPI WebSocket handlers subscribe with an asyncio.Queue bound to their
    current event loop. Slow clients are protected by a small bounded queue; if
    the queue is full we drop the oldest event and enqueue the newest one.
    """

    def __init__(self, queue_size: int = WATCH_EVENT_QUEUE_SIZE) -> None:
        self._queue_size = queue_size
        self._subscribers: dict[str, WatchEventSubscriber] = {}
        self._lock = RLock()

    async def subscribe(self) -> WatchEventSubscriber:
        subscriber = WatchEventSubscriber(
            id=str(uuid.uuid4()),
            loop=asyncio.get_running_loop(),
            queue=asyncio.Queue(maxsize=self._queue_size),
        )
        with self._lock:
            self._subscribers[subscriber.id] = subscriber
        return subscriber

    async def unsubscribe(self, subscriber_id: str) -> None:
        with self._lock:
            self._subscribers.pop(subscriber_id, None)

    def publish(self, event: dict[str, Any]) -> None:
        payload = dict(event)
        payload.setdefault("at", time.time())
        payload.setdefault("type", "resource.changed")
        with self._lock:
            subscribers = list(self._subscribers.values())
        for subscriber in subscribers:
            subscriber.loop.call_soon_threadsafe(self._put_nowait_drop_oldest, subscriber, payload)

    @staticmethod
    def _put_nowait_drop_oldest(subscriber: WatchEventSubscriber, event: dict[str, Any]) -> None:
        queue = subscriber.queue
        if queue.full():
            with contextlib.suppress(asyncio.QueueEmpty):
                queue.get_nowait()
                queue.task_done()
        with contextlib.suppress(asyncio.QueueFull):
            queue.put_nowait(dict(event))


watch_event_hub = WatchEventHub()


def event_matches_subscription(event: dict[str, Any], *, cluster_id: str, resource: str, namespace: str) -> bool:
    if str(event.get("clusterId") or "") != cluster_id:
        return False
    if str(event.get("resource") or "").lower() != resource.lower():
        return False
    if namespace == "all":
        return True
    event_namespace = str(event.get("namespace") or "_cluster")
    if namespace == "_cluster":
        return event_namespace == "_cluster"
    return event_namespace == namespace
