from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from .common import *
from .watch_manager import build_watch_args, resource_watch_manager
from .watch_events import event_matches_subscription, watch_event_hub


router = APIRouter()


class WatchStartRequest(BaseModel):
    resource: str
    namespace: str = "all"


@router.get("/watches/status")
def watch_status() -> dict[str, Any]:
    return resource_watch_manager.status()


@router.post("/clusters/{cluster_id}/watches")
def watch_start(cluster_id: str, request: WatchStartRequest) -> dict[str, Any]:
    resource = validate_identifier(request.resource, "resource", max_length=128).lower()
    namespace = (request.namespace or "all").strip() or "all"
    if namespace not in {"all", "_cluster"}:
        namespace = validate_identifier(namespace, "namespace")
    args = build_watch_args(resource, namespace)
    command = cluster_command(cluster_id, args, timeout=0, max_output_bytes=0)
    try:
        return resource_watch_manager.start(command, resource, namespace)
    except FileNotFoundError as exc:
        raise api_error(502, "KUBECTL_NOT_FOUND", str(exc), command_preview=command.preview) from exc
    except Exception as exc:
        raise api_error(502, "WATCH_START_FAILED", str(exc), command_preview=command.preview) from exc


@router.delete("/watches/{watch_id}")
def watch_stop(watch_id: str) -> dict[str, Any]:
    watch_id = validate_identifier(watch_id, "watch_id", max_length=64)
    return resource_watch_manager.stop(watch_id)


@router.post("/watches/stop-all")
def watch_stop_all() -> dict[str, Any]:
    return resource_watch_manager.stop_all()


@router.websocket("/clusters/{cluster_id}/resources/{resource}/watch-events")
async def resource_watch_events(
    cluster_id: str,
    resource: str,
    websocket: WebSocket,
    namespace: str = Query(default="all"),
    token: str = Query(default=""),
) -> None:
    if not websocket_origin_allowed(websocket) or not verify_session_token(websocket_token(websocket, token)):
        await websocket.close(code=1008)
        return
    try:
        resource = validate_identifier(resource, "resource", max_length=128).lower()
        namespace = (namespace or "all").strip() or "all"
        if namespace not in {"all", "_cluster"}:
            namespace = validate_identifier(namespace, "namespace")
    except HTTPException:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    subscriber = await watch_event_hub.subscribe()
    try:
        await websocket.send_json({
            "type": "status",
            "data": "connected",
            "clusterId": cluster_id,
            "resource": resource,
            "namespace": namespace,
        })
        while True:
            queue_task = asyncio.create_task(subscriber.queue.get())
            receive_task = asyncio.create_task(websocket.receive_text())
            done, pending = await asyncio.wait(
                {queue_task, receive_task},
                timeout=30.0,
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            if not done:
                await websocket.send_json({"type": "heartbeat", "at": time.time()})
                continue
            if receive_task in done:
                try:
                    message = receive_task.result()
                except WebSocketDisconnect:
                    return
                if message.strip().lower() == "ping":
                    await websocket.send_json({"type": "pong", "at": time.time()})
            if queue_task in done:
                event = queue_task.result()
                if event_matches_subscription(event, cluster_id=cluster_id, resource=resource, namespace=namespace):
                    await websocket.send_json(event)
    except WebSocketDisconnect:
        return
    finally:
        await watch_event_hub.unsubscribe(subscriber.id)
