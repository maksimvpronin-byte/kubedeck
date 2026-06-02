from __future__ import annotations

from fastapi import APIRouter

from .common import *


router = APIRouter()


@router.get("/clusters/{cluster_id}/search")
def cluster_search(
    cluster_id: str,
    q: str = Query(min_length=2, max_length=SEARCH_QUERY_MAX_CHARS),
    namespace: str = Query(default="all"),
    limit: int = Query(default=200, ge=1, le=500),
    includeCrdInstances: bool = Query(default=True),
) -> dict[str, Any]:
    query = normalize_search_query(q)
    namespaces_to_search = normalize_search_namespaces(namespace)
    resource_specs = build_search_resource_specs(cluster_id, query, includeCrdInstances)

    results: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    sources: dict[str, int] = {}

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=SEARCH_CONCURRENCY)
    futures = {
        executor.submit(search_resource, cluster_id, spec, namespaces_to_search, query, max(10, limit // 3)): spec
        for spec in resource_specs
    }
    try:
        for future in concurrent.futures.as_completed(futures, timeout=SEARCH_TOTAL_TIMEOUT_SECONDS):
            spec = futures[future]
            try:
                response = future.result()
            except KubectlError as exc:
                info = exc.info.model_dump()
                info["resource"] = spec["resource"]
                info["namespace"] = ",".join(namespaces_to_search)
                errors.append(info)
                sources[spec["resource"]] = 0
                continue
            except Exception as exc:  # defensive: search must never break the whole app
                errors.append({
                    "code": "SEARCH_SOURCE_FAILED",
                    "message": str(exc),
                    "rawStderr": "",
                    "commandPreview": "",
                    "resource": spec["resource"],
                    "namespace": ",".join(namespaces_to_search),
                })
                sources[spec["resource"]] = 0
                continue

            items = response.get("items", [])
            sources[spec["resource"]] = int(response.get("rawCount", len(items)))
            results.extend(items)
            if len(results) >= limit * 2:
                break
    except concurrent.futures.TimeoutError:
        errors.append({
            "code": "SEARCH_TIMEOUT",
            "message": f"Global search stopped after {SEARCH_TOTAL_TIMEOUT_SECONDS}s. Narrow the query or namespace.",
            "rawStderr": "",
            "commandPreview": "",
        })
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    ranked = sorted(deduplicate_search_results(results), key=search_sort_key)[:limit]
    return {
        "items": ranked,
        "summary": {
            "query": query,
            "total": len(ranked),
            "sources": sources,
            "errors": len(errors),
            "limited": len(results) > len(ranked),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        },
        "errors": errors,
    }
