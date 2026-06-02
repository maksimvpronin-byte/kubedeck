from __future__ import annotations

from fastapi import APIRouter

from .common import *


router = APIRouter()


@router.get("/clusters/{cluster_id}/problems")
def cluster_problems(cluster_id: str) -> dict[str, Any]:
    config = get_cached_config()
    restart_threshold = max(1, int(config.settings.restartProblemThreshold or 3))
    sources: dict[str, list[dict[str, Any]]] = {}
    errors: list[dict[str, Any]] = []

    problem_sources = [
        ("pods", "all", pod_summary),
        ("deployments", "all", deployment_summary),
        ("events", "all", event_summary),
        ("nodes", "_cluster", node_summary),
        ("persistentvolumeclaims", "all", generic_summary),
    ]

    for resource, namespace, normalizer in problem_sources:
        try:
            sources[resource] = load_problem_resource(cluster_id, resource, namespace, normalizer)
        except KubectlError as exc:
            info = exc.info.model_dump()
            info["resource"] = resource
            info["namespace"] = namespace
            errors.append(info)
            sources[resource] = []

    items = build_problem_rows(
        sources.get("pods", []),
        sources.get("deployments", []),
        sources.get("events", []),
        sources.get("nodes", []),
        sources.get("persistentvolumeclaims", []),
        restart_threshold,
    )
    return {
        "items": items,
        "summary": summarize_problems(items, sources, errors),
        "errors": errors,
    }
