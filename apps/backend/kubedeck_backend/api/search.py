from __future__ import annotations

import json
import logging
from typing import Any

from kubedeck_backend.api.resource_cache import (
    get_cached_discovery_resource_definitions,
    set_cached_discovery_resource_definitions,
)
from kubedeck_backend.api.runtime import cluster_command, runner
from kubedeck_backend.api.validation import api_error, validate_identifier
from kubedeck_backend.kubectl.command import KubectlError
from kubedeck_backend.resources.normalizers import (
    crd_summary,
    deployment_summary,
    event_summary,
    ingress_summary,
    meta,
    node_summary,
    pod_summary,
    service_summary,
)

log = logging.getLogger(__name__)

SEARCH_QUERY_MAX_CHARS = 128
SEARCH_TOTAL_TIMEOUT_SECONDS = 12
SEARCH_KUBECTL_TIMEOUT_SECONDS = 10
SEARCH_CONCURRENCY = 3
SEARCH_MAX_OUTPUT_BYTES = 12 * 1024 * 1024
SEARCH_MAX_CRD_INSTANCE_RESOURCES = 12
SEARCH_API_RESOURCES_MAX_OUTPUT_BYTES = 16 * 1024 * 1024

def generic_summary(item: dict[str, Any]) -> dict[str, Any]:
    base = meta(item)
    status = item.get("status") or {}
    spec = item.get("spec") or {}
    conditions = status.get("conditions") if isinstance(status, dict) else []
    last_condition = conditions[-1] if isinstance(conditions, list) and conditions else {}
    base.update({
        "apiVersion": item.get("apiVersion", ""),
        "kind": item.get("kind", ""),
        "status": status.get("phase") or last_condition.get("type", "") if isinstance(status, dict) and status else "",
        "type": spec.get("type", "") if isinstance(spec, dict) else "",
    })
    return base


def parse_api_resources(output: str) -> list[dict[str, Any]]:
    lines = [line for line in output.splitlines() if line.strip()]
    if len(lines) <= 1:
        return []
    items: list[dict[str, Any]] = []
    for line in lines[1:]:
        parts = line.split()
        if len(parts) < 5:
            continue
        namespaced_index = next((index for index, part in enumerate(parts) if part in {"true", "false"}), -1)
        if namespaced_index < 0 or namespaced_index + 2 >= len(parts):
            continue
        name = parts[0]
        shortnames = parts[1] if namespaced_index > 1 else ""
        api_group = parts[namespaced_index - 1] if namespaced_index > 1 else ""
        namespaced = parts[namespaced_index] == "true"
        kind = parts[namespaced_index + 1]
        verbs = " ".join(parts[namespaced_index + 2:])
        items.append({
            "name": name,
            "shortNames": shortnames,
            "apiGroup": api_group,
            "namespaced": namespaced,
            "kind": kind,
            "verbs": verbs,
        })
    return items

def get_cached_resource_definitions(cluster_id: str) -> tuple[list[dict[str, Any]], bool]:
    cached = get_cached_discovery_resource_definitions(cluster_id)
    if cached is not None:
        return cached, True

    output = runner.run(cluster_command(cluster_id, ["api-resources", "--verbs=list", "-o", "wide"], timeout=30, max_output_bytes=SEARCH_API_RESOURCES_MAX_OUTPUT_BYTES)).stdout
    items = parse_api_resources(output)
    return set_cached_discovery_resource_definitions(cluster_id, items), False


def normalize_search_query(value: str) -> str:
    query = " ".join((value or "").strip().split())
    if len(query) < 2:
        raise api_error(400, "SEARCH_QUERY_TOO_SHORT", "Search query must contain at least 2 characters")
    if len(query) > SEARCH_QUERY_MAX_CHARS:
        raise api_error(400, "SEARCH_QUERY_TOO_LONG", f"Search query must be at most {SEARCH_QUERY_MAX_CHARS} characters")
    return query


def normalize_search_namespaces(value: str) -> list[str]:
    raw = [item.strip() for item in (value or "all").split(",") if item.strip()]
    if not raw or "all" in raw:
        return ["all"]
    if "_cluster" in raw:
        return ["_cluster"]
    return [validate_identifier(item, "namespace") for item in raw[:20]]


def build_search_resource_specs(cluster_id: str, query: str, include_crd_instances: bool) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = [
        {"resource": "pods", "kind": "Pod", "scope": "namespaced", "normalizer": pod_summary},
        {"resource": "deployments", "kind": "Deployment", "scope": "namespaced", "normalizer": deployment_summary},
        {"resource": "services", "kind": "Service", "scope": "namespaced", "normalizer": service_summary},
        {"resource": "configmaps", "kind": "ConfigMap", "scope": "namespaced", "normalizer": generic_summary},
        {"resource": "secrets", "kind": "Secret", "scope": "namespaced", "normalizer": generic_summary},
        {"resource": "ingresses", "kind": "Ingress", "scope": "namespaced", "normalizer": ingress_summary},
        {"resource": "persistentvolumeclaims", "kind": "PersistentVolumeClaim", "scope": "namespaced", "normalizer": generic_summary},
        {"resource": "events", "kind": "Event", "scope": "namespaced", "normalizer": event_summary},
        {"resource": "namespaces", "kind": "Namespace", "scope": "cluster", "normalizer": generic_summary},
        {"resource": "nodes", "kind": "Node", "scope": "cluster", "normalizer": node_summary},
    ]

    try:
        definitions, _cached = get_cached_resource_definitions(cluster_id)
    except KubectlError as exc:
        log.info("global search: api-resources unavailable code=%s message=%s", exc.info.code, exc.info.message)
        return specs

    for definition in definitions:
        definition_text = " ".join(str(definition.get(key, "")) for key in ("name", "shortNames", "apiGroup", "kind"))
        if search_matches_text(query, definition_text):
            specs.append({
                "resource": "customresourcedefinitions",
                "kind": "CustomResourceDefinition",
                "scope": "cluster",
                "normalizer": crd_summary,
                "definitionOnly": True,
                "definitionFilter": definition,
            })

    if include_crd_instances:
        crd_defs = [definition for definition in definitions if is_probable_custom_resource(definition) and definition_matches_query(definition, query)]
        for definition in crd_defs[:SEARCH_MAX_CRD_INSTANCE_RESOURCES]:
            resource = fully_qualified_api_resource(definition)
            specs.append({
                "resource": resource,
                "kind": str(definition.get("kind") or "CustomResource"),
                "scope": "namespaced" if bool(definition.get("namespaced")) else "cluster",
                "normalizer": generic_summary,
                "crdInstance": True,
                "apiGroup": str(definition.get("apiGroup") or ""),
            })
    return specs


def is_probable_custom_resource(definition: dict[str, Any]) -> bool:
    name = str(definition.get("name") or "")
    api_group = str(definition.get("apiGroup") or "")
    verbs = str(definition.get("verbs") or "").lower()
    if not name or "/" in name or "list" not in verbs:
        return False
    built_in_groups = {
        "",
        "apps",
        "batch",
        "extensions",
        "networking.k8s.io",
        "rbac.authorization.k8s.io",
        "storage.k8s.io",
        "autoscaling",
        "policy",
        "coordination.k8s.io",
        "apiextensions.k8s.io",
        "admissionregistration.k8s.io",
        "node.k8s.io",
        "scheduling.k8s.io",
        "authentication.k8s.io",
        "authorization.k8s.io",
        "certificates.k8s.io",
        "discovery.k8s.io",
        "flowcontrol.apiserver.k8s.io",
    }
    return api_group not in built_in_groups


def definition_matches_query(definition: dict[str, Any], query: str) -> bool:
    text = " ".join(str(definition.get(key, "")) for key in ("name", "shortNames", "apiGroup", "kind"))
    return search_matches_text(query, text)


def fully_qualified_api_resource(definition: dict[str, Any]) -> str:
    name = str(definition.get("name") or "").strip()
    api_group = str(definition.get("apiGroup") or "").strip()
    return f"{name}.{api_group}" if api_group and not name.endswith(f".{api_group}") else name


def search_resource(cluster_id: str, spec: dict[str, Any], namespaces_to_search: list[str], query: str, limit_per_resource: int) -> dict[str, Any]:
    resource = str(spec["resource"])
    normalizer = spec["normalizer"]
    scope = str(spec.get("scope") or "namespaced")
    namespace_modes = ["_cluster"] if scope == "cluster" else namespaces_to_search
    collected: list[dict[str, Any]] = []
    raw_count = 0

    for namespace_mode in namespace_modes:
        args = ["get", resource]
        if scope == "namespaced":
            if namespace_mode == "all":
                args.append("-A")
            elif namespace_mode and namespace_mode != "_cluster":
                args.extend(["-n", namespace_mode])
        args.extend(["-o", "json"])
        data = runner.run_json(cluster_command(cluster_id, args, timeout=SEARCH_KUBECTL_TIMEOUT_SECONDS, max_output_bytes=SEARCH_MAX_OUTPUT_BYTES))
        items = data.get("items", [])
        raw_count += len(items)
        for raw in items:
            if spec.get("definitionOnly") and not crd_item_matches_definition(raw, spec.get("definitionFilter") or {}):
                continue
            summary = normalizer(raw)
            score, matched_fields = score_search_result(query, resource, raw, summary)
            if score <= 0:
                continue
            collected.append(search_result_row(spec, summary, score, matched_fields))
            if len(collected) >= limit_per_resource:
                break
        if len(collected) >= limit_per_resource:
            break
    return {"items": sorted(collected, key=search_sort_key)[:limit_per_resource], "rawCount": raw_count}


def crd_item_matches_definition(raw: dict[str, Any], definition: dict[str, Any]) -> bool:
    if not definition:
        return True
    spec = raw.get("spec") or {}
    names = spec.get("names") or {}
    expected_name = str(definition.get("name") or "")
    expected_kind = str(definition.get("kind") or "")
    return expected_name in {str(raw.get("metadata", {}).get("name") or ""), str(names.get("plural") or "")} or expected_kind == str(names.get("kind") or "")


def score_search_result(query: str, resource: str, raw: dict[str, Any], summary: dict[str, Any]) -> tuple[int, list[str]]:
    tokens = [token.lower() for token in query.split() if token]
    metadata = raw.get("metadata") or {}
    name = str(summary.get("name") or metadata.get("name") or "")
    namespace = str(summary.get("namespace") or metadata.get("namespace") or "")
    kind = str(summary.get("kind") or raw.get("kind") or "")
    labels = metadata.get("labels") or {}
    annotations = metadata.get("annotations") or {}
    status = raw.get("status") or {}
    spec = raw.get("spec") or {}
    safe_spec = {key: spec.get(key) for key in ("type", "serviceName", "storageClassName", "ingressClassName") if key in spec}
    fields = {
        "name": name,
        "namespace": namespace,
        "kind": kind,
        "resource": resource,
        "labels": json.dumps(labels, ensure_ascii=False),
        "annotations": json.dumps(annotations, ensure_ascii=False),
        "status": json.dumps(status, ensure_ascii=False)[:4000],
        "spec": json.dumps(safe_spec, ensure_ascii=False),
    }
    matched_fields: list[str] = []
    haystack = " ".join(fields.values()).lower()
    if not all(token in haystack for token in tokens):
        return 0, []

    score = 10
    query_lower = query.lower()
    if name.lower() == query_lower:
        score += 1000
        matched_fields.append("name")
    elif query_lower in name.lower():
        score += 500
        matched_fields.append("name")
    if namespace and query_lower in namespace.lower():
        score += 160
        matched_fields.append("namespace")
    if kind and query_lower in kind.lower():
        score += 120
        matched_fields.append("kind")
    if resource and query_lower in resource.lower():
        score += 100
        matched_fields.append("resource")
    for field, value in fields.items():
        if field in matched_fields:
            continue
        if any(token in value.lower() for token in tokens):
            matched_fields.append(field)
    return score, matched_fields[:5]


def search_result_row(spec: dict[str, Any], summary: dict[str, Any], score: int, matched_fields: list[str]) -> dict[str, Any]:
    resource = str(spec["resource"])
    row = dict(summary)
    namespace = str(row.get("namespace") or ("_cluster" if spec.get("scope") == "cluster" else ""))
    row.update({
        "resource": resource,
        "kind": str(row.get("kind") or spec.get("kind") or ""),
        "namespace": namespace,
        "score": score,
        "matchedFields": matched_fields,
        "source": "global-search",
        "title": str(row.get("name") or ""),
        "subtitle": search_result_subtitle(resource, namespace, row, spec),
        "crdInstance": bool(spec.get("crdInstance")),
    })
    if not row.get("uid"):
        row["uid"] = f"search:{resource}:{namespace}:{row.get('name', '')}"
    return row


def search_result_subtitle(resource: str, namespace: str, row: dict[str, Any], spec: dict[str, Any]) -> str:
    kind = str(row.get("kind") or spec.get("kind") or resource)
    parts = [kind, resource]
    if namespace and namespace != "_cluster":
        parts.append(namespace)
    status = str(row.get("status") or row.get("phase") or "")
    if status:
        parts.append(status)
    return " · ".join(parts)


def search_matches_text(query: str, text: str) -> bool:
    haystack = text.lower()
    return all(token.lower() in haystack for token in query.split() if token)


def deduplicate_search_results(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[tuple[str, str, str], dict[str, Any]] = {}
    for item in items:
        key = (str(item.get("resource") or ""), str(item.get("namespace") or ""), str(item.get("name") or item.get("uid") or ""))
        current = by_key.get(key)
        if current is None or int(item.get("score") or 0) > int(current.get("score") or 0):
            by_key[key] = item
    return list(by_key.values())


def search_sort_key(row: dict[str, Any]) -> tuple[int, str, str]:
    return (-int(row.get("score") or 0), str(row.get("resource") or ""), str(row.get("name") or ""))
