from __future__ import annotations

from fastapi import APIRouter

from .common import *
from .resource_cache import get_cached_resource_list_response, invalidate_after_resource_action, set_cached_resource_list_response
from .secrets import SecretCopyAuditRequest, SecretRevealRequest, audit_secret_copy, reveal_secret_key, secret_keys_response
from .workload_logs import deployment_log_targets, deployment_logs_text


router = APIRouter()

# KubeDeck 1.1.1 namespace CPU/RAM usage enrichment.
def _kubedeck_cpu_to_millicores(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        if text.endswith("m"):
            return int(float(text[:-1]))
        if text.endswith("u"):
            return int(float(text[:-1]) / 1000)
        if text.endswith("n"):
            return int(float(text[:-1]) / 1000000)
        return int(float(text) * 1000)
    except (TypeError, ValueError):
        return None


def _kubedeck_memory_to_bytes(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    units = {
        "Ki": 1024,
        "Mi": 1024 ** 2,
        "Gi": 1024 ** 3,
        "Ti": 1024 ** 4,
        "Pi": 1024 ** 5,
        "Ei": 1024 ** 6,
        "K": 1000,
        "M": 1000 ** 2,
        "G": 1000 ** 3,
        "T": 1000 ** 4,
        "P": 1000 ** 5,
        "E": 1000 ** 6,
    }
    try:
        for suffix, multiplier in units.items():
            if text.endswith(suffix):
                return int(float(text[: -len(suffix)]) * multiplier)
        return int(float(text))
    except (TypeError, ValueError):
        return None


def _kubedeck_format_cpu(millicores: int | None) -> str:
    if millicores is None:
        return "N/A"
    if millicores == 0:
        return "0m"
    if millicores % 1000 == 0:
        return str(millicores // 1000)
    return f"{millicores}m"


def _kubedeck_format_memory(bytes_value: int | None) -> str:
    if bytes_value is None:
        return "N/A"
    if bytes_value == 0:
        return "0Mi"
    for suffix, multiplier in (("Gi", 1024 ** 3), ("Mi", 1024 ** 2), ("Ki", 1024)):
        if bytes_value >= multiplier and bytes_value % multiplier == 0:
            return f"{bytes_value // multiplier}{suffix}"
    if bytes_value >= 1024 ** 2:
        return f"{round(bytes_value / (1024 ** 2), 1)}Mi"
    if bytes_value >= 1024:
        return f"{round(bytes_value / 1024, 1)}Ki"
    return f"{bytes_value}B"


def _kubedeck_namespace_top_pod_usage(cluster_id: str) -> tuple[dict[str, dict[str, int]], bool]:
    usage: dict[str, dict[str, int]] = {}
    try:
        stdout = runner.run(
            cluster_command(
                cluster_id,
                ["top", "pods", "-A", "--no-headers"],
                timeout=30,
                max_output_bytes=TEXT_MAX_OUTPUT_BYTES,
            )
        ).stdout
    except KubectlError:
        return usage, False
    for line in stdout.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        namespace = parts[0]
        cpu = _kubedeck_cpu_to_millicores(parts[-2])
        memory = _kubedeck_memory_to_bytes(parts[-1])
        bucket = usage.setdefault(namespace, {"cpu": 0, "memory": 0})
        if cpu is not None:
            bucket["cpu"] += cpu
        if memory is not None:
            bucket["memory"] += memory
    return usage, True


def _kubedeck_namespace_quota_hard(cluster_id: str) -> dict[str, dict[str, int | None]]:
    quota: dict[str, dict[str, int | None]] = {}
    try:
        data = runner.run_json(
            cluster_command(
                cluster_id,
                ["get", "resourcequota", "-A", "-o", "json"],
                timeout=30,
                max_output_bytes=RESOURCE_JSON_MAX_OUTPUT_BYTES,
            )
        )
    except KubectlError:
        return quota
    for item in data.get("items", []):
        namespace = ((item.get("metadata") or {}).get("namespace") or "").strip()
        if not namespace:
            continue
        hard = (item.get("status") or {}).get("hard") or {}
        cpu_value = None
        memory_value = None
        for key in ("limits.cpu", "requests.cpu", "cpu"):
            cpu_value = _kubedeck_cpu_to_millicores(hard.get(key))
            if cpu_value is not None:
                break
        for key in ("limits.memory", "requests.memory", "memory"):
            memory_value = _kubedeck_memory_to_bytes(hard.get(key))
            if memory_value is not None:
                break
        bucket = quota.setdefault(namespace, {"cpu": None, "memory": None})
        if cpu_value is not None:
            bucket["cpu"] = cpu_value if bucket["cpu"] is None else int(bucket["cpu"] or 0) + cpu_value
        if memory_value is not None:
            bucket["memory"] = memory_value if bucket["memory"] is None else int(bucket["memory"] or 0) + memory_value
    return quota


def apply_namespace_resource_usage(cluster_id: str, summaries: list[dict[str, Any]]) -> None:
    usage, metrics_available = _kubedeck_namespace_top_pod_usage(cluster_id)
    quota = _kubedeck_namespace_quota_hard(cluster_id)
    for row in summaries:
        namespace = str(row.get("name") or row.get("namespace") or "")
        used = usage.get(namespace, {"cpu": 0, "memory": 0})
        hard = quota.get(namespace, {"cpu": None, "memory": None})
        used_cpu = used.get("cpu") if metrics_available else None
        used_memory = used.get("memory") if metrics_available else None
        hard_cpu = hard.get("cpu")
        hard_memory = hard.get("memory")
        cpu_quota = _kubedeck_format_cpu(hard_cpu) if hard_cpu is not None else "no quota"
        memory_quota = _kubedeck_format_memory(hard_memory) if hard_memory is not None else "no quota"
        metrics_suffix = "" if metrics_available else " (metrics N/A)"
        row["namespaceCpuUsed"] = _kubedeck_format_cpu(used_cpu)
        row["namespaceMemoryUsed"] = _kubedeck_format_memory(used_memory)
        row["namespaceCpuQuota"] = cpu_quota
        row["namespaceMemoryQuota"] = memory_quota
        row["namespaceResources"] = (
            f"CPU {_kubedeck_format_cpu(used_cpu)} / {cpu_quota}; "
            f"RAM {_kubedeck_format_memory(used_memory)} / {memory_quota}{metrics_suffix}"
        )



def _run_resource_text_command(command: KubectlCommand) -> str:
    try:
        return runner.run(command).stdout
    except KubectlError as exc:
        raise kubectl_error(exc)


@router.get("/clusters/{cluster_id}/resources/{resource}")
def resources(
    cluster_id: str,
    resource: str,
    namespace: str = Query(default="all"),
    use_cache: bool = Query(default=False, alias="useCache"),
    force_refresh: bool = Query(default=False, alias="forceRefresh"),
) -> dict[str, Any]:
    resource = validate_identifier(resource, "resource", max_length=128).lower()
    if namespace not in {"all", "_cluster"}:
        namespace = validate_identifier(namespace, "namespace")
    if use_cache and not force_refresh:
        cached_response = get_cached_resource_list_response(cluster_id, resource, namespace)
        if cached_response is not None:
            return cached_response
    args = ["get", resource]
    if resource in {"namespaces", "customresourcedefinitions", "customresourcedefinitions.apiextensions.k8s.io"}:
        pass
    elif namespace == "all":
        args.append("-A")
    elif namespace and namespace != "_cluster":
        args.extend(["-n", namespace])
    args.extend(["-o", "json"])
    try:
        data = runner.run_json(cluster_command(cluster_id, args, timeout=45, max_output_bytes=RESOURCE_JSON_MAX_OUTPUT_BYTES))
    except KubectlError as exc:
        raise kubectl_error(exc)
    items = data.get("items", [])
    normalizers = {
        "pods": pod_summary,
        "deployments": deployment_summary,
        "deployments.apps": deployment_summary,
        "services": service_summary,
        "ingresses": ingress_summary,
        "ingresses.networking.k8s.io": ingress_summary,
        "customresourcedefinitions": crd_summary,
        "customresourcedefinitions.apiextensions.k8s.io": crd_summary,
        "events": event_summary,
        "nodes": node_summary,
        "serviceaccounts": service_account_summary,
        "roles": role_summary,
        "clusterroles": role_summary,
        "rolebindings": role_binding_summary,
        "clusterrolebindings": role_binding_summary,
    }
    normalizer = normalizers.get(resource, generic_summary)
    summaries = [normalizer(item) for item in items]
    if resource not in normalizers and "." in resource:
        for summary in summaries:
            summary["crdInstance"] = True
            summary["resource"] = resource
            summary.setdefault("apiVersion", "")
    if resource == "pods":
        apply_pod_metrics(cluster_id, namespace, summaries)
    if resource == "namespaces":
        apply_namespace_resource_usage(cluster_id, summaries)
    response = {"items": summaries, "rawCount": len(items), "cached": False}
    return set_cached_resource_list_response(cluster_id, resource, namespace, response)

@router.get("/clusters/{cluster_id}/secrets/{namespace}/{name}/keys")
def secret_keys(cluster_id: str, namespace: str, name: str) -> dict[str, Any]:
    namespace = validate_identifier(namespace, "namespace")
    name = validate_identifier(name, "name")
    try:
        return secret_keys_response(cluster_id, namespace, name)
    except KubectlError as exc:
        raise kubectl_error(exc)

@router.post("/clusters/{cluster_id}/secrets/{namespace}/{name}/reveal")
def secret_reveal(cluster_id: str, namespace: str, name: str, request: SecretRevealRequest) -> dict[str, Any]:
    namespace = validate_identifier(namespace, "namespace")
    name = validate_identifier(name, "name")
    try:
        return reveal_secret_key(cluster_id, namespace, name, request.key)
    except KubectlError as exc:
        raise kubectl_error(exc)

@router.post("/clusters/{cluster_id}/secrets/{namespace}/{name}/copy")
def secret_copy_audit(cluster_id: str, namespace: str, name: str, request: SecretCopyAuditRequest) -> dict[str, bool]:
    namespace = validate_identifier(namespace, "namespace")
    name = validate_identifier(name, "name")
    return audit_secret_copy(cluster_id, namespace, name, request.key)


@router.get("/clusters/{cluster_id}/deployments/{namespace}/{name}/log-targets")
def deployment_log_target_list(cluster_id: str, namespace: str, name: str) -> dict[str, Any]:
    namespace = validate_identifier(namespace, "namespace")
    name = validate_identifier(name, "name")
    return deployment_log_targets(cluster_id, namespace, name)

@router.get("/clusters/{cluster_id}/deployments/{namespace}/{name}/logs", response_class=PlainTextResponse)
def deployment_logs(
    cluster_id: str,
    namespace: str,
    name: str,
    tail: int = Query(default=500),
    all: bool = Query(default=False),
    previous: bool = Query(default=False),
    timestamps: bool = Query(default=False),
    container: str | None = Query(default=None),
    pod: str | None = Query(default=None),
) -> str:
    namespace = validate_identifier(namespace, "namespace")
    name = validate_identifier(name, "name")
    return deployment_logs_text(
        cluster_id,
        namespace,
        name,
        tail=tail,
        all_logs=all,
        previous=previous,
        timestamps=timestamps,
        container=container,
        pod=pod,
        logs_max_output_bytes=LOGS_MAX_OUTPUT_BYTES,
        logs_full_max_output_bytes=LOGS_FULL_MAX_OUTPUT_BYTES,
    )

@router.get("/clusters/{cluster_id}/resource-definitions")
def resource_definitions(cluster_id: str) -> dict[str, Any]:
    try:
        items, cached = get_cached_resource_definitions(cluster_id)
    except KubectlError as exc:
        raise kubectl_error(exc)
    return {"items": items, "cached": cached}

@router.get("/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/yaml", response_class=PlainTextResponse)
def resource_yaml(cluster_id: str, resource: str, namespace: str, name: str) -> str:
    resource = validate_identifier(resource, "resource", max_length=128).lower()
    name = validate_identifier(name, "name")
    if namespace != "_cluster":
        namespace = validate_identifier(namespace, "namespace")
    args = ["get", resource, name]
    if namespace != "_cluster":
        args.extend(["-n", namespace])
    args.extend(["-o", "yaml"])
    return _run_resource_text_command(cluster_command(cluster_id, args, timeout=30, max_output_bytes=TEXT_MAX_OUTPUT_BYTES))

@router.get("/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/describe", response_class=PlainTextResponse)
def resource_describe(cluster_id: str, resource: str, namespace: str, name: str) -> str:
    resource = validate_identifier(resource, "resource", max_length=128).lower()
    name = validate_identifier(name, "name")
    if namespace != "_cluster":
        namespace = validate_identifier(namespace, "namespace")
    args = ["describe", resource, name]
    if namespace != "_cluster":
        args.extend(["-n", namespace])
    return _run_resource_text_command(cluster_command(cluster_id, args, timeout=30, max_output_bytes=TEXT_MAX_OUTPUT_BYTES))

@router.get("/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/events")
def resource_events(cluster_id: str, resource: str, namespace: str, name: str) -> dict[str, Any]:
    normalized_resource = validate_identifier(resource, "resource", max_length=128).lower()
    name = validate_identifier(name, "name")
    if namespace != "_cluster":
        namespace = validate_identifier(namespace, "namespace")
    try:
        target_raw = load_target_raw(cluster_id, normalized_resource, namespace, name)
        event_namespace = "all" if namespace == "_cluster" else namespace
        event_items = load_raw_items(cluster_id, "events", event_namespace, timeout=30, max_output_bytes=TEXT_MAX_OUTPUT_BYTES)
    except KubectlError as exc:
        raise kubectl_error(exc)
    filtered = filter_events_for_target(event_items, normalized_resource, namespace, name, target_raw)
    return {"items": [event_summary(item) for item in filtered[:200]], "rawCount": len(filtered)}

@router.get("/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/related")
def resource_related(cluster_id: str, resource: str, namespace: str, name: str) -> dict[str, Any]:
    normalized_resource = validate_identifier(resource, "resource", max_length=128).lower()
    name = validate_identifier(name, "name")
    if namespace != "_cluster":
        namespace = validate_identifier(namespace, "namespace")
    try:
        target_raw = load_target_raw(cluster_id, normalized_resource, namespace, name)
        target_summary = normalizer_for_resource(normalized_resource)(target_raw)
        links, sources, errors = build_related_links(cluster_id, normalized_resource, namespace, target_raw, target_summary)
    except KubectlError as exc:
        raise kubectl_error(exc)
    return {"items": links[:200], "sources": sources, "errors": errors}

@router.post("/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/action", response_class=PlainTextResponse)
def resource_action(cluster_id: str, resource: str, namespace: str, name: str, request: ResourceActionRequest) -> str:
    action = request.action.strip().lower()
    normalized_resource = validate_identifier(resource, "resource", max_length=128).lower()
    name = validate_identifier(name, "name")
    if namespace != "_cluster":
        namespace = validate_identifier(namespace, "namespace")
    namespaced = namespace != "_cluster"
    if action == "delete":
        args = ["delete", normalized_resource, name, "--wait=false"]
        if namespaced:
            args.extend(["-n", namespace])
    elif action in {"restart", "redeploy"}:
        if normalized_resource in {"pod", "pods"}:
            args = ["delete", "pod", name, "--wait=false"]
            if namespaced:
                args.extend(["-n", namespace])
        elif normalized_resource in {"deployment", "deployments", "statefulset", "statefulsets", "daemonset", "daemonsets"}:
            args = ["rollout", "restart", f"{normalized_resource}/{name}"]
            if namespaced:
                args.extend(["-n", namespace])
        else:
            raise HTTPException(status_code=400, detail={"code": "UNSUPPORTED_ACTION", "message": f"{action} is not supported for {resource}", "rawStderr": "", "commandPreview": ""})
    elif action == "scale":
        if request.replicas is None or request.replicas < 0:
            raise HTTPException(status_code=400, detail={"code": "INVALID_REPLICAS", "message": "replicas must be a non-negative number", "rawStderr": "", "commandPreview": ""})
        if normalized_resource not in {"deployment", "deployments", "statefulset", "statefulsets", "replicaset", "replicasets"}:
            raise HTTPException(status_code=400, detail={"code": "UNSUPPORTED_ACTION", "message": f"scale is not supported for {resource}", "rawStderr": "", "commandPreview": ""})
        args = ["scale", f"{normalized_resource}/{name}", f"--replicas={request.replicas}"]
        if namespaced:
            args.extend(["-n", namespace])
    elif action in {"cordon", "uncordon", "drain"}:
        if normalized_resource not in {"node", "nodes"}:
            raise HTTPException(status_code=400, detail={"code": "UNSUPPORTED_ACTION", "message": f"{action} is not supported for {resource}", "rawStderr": "", "commandPreview": ""})
        namespace = "_cluster"
        namespaced = False
        if action == "drain":
            args = ["drain", name, "--ignore-daemonsets", "--delete-emptydir-data", "--timeout=300s"]
        else:
            args = [action, name]

    else:
        raise HTTPException(status_code=400, detail={"code": "UNSUPPORTED_ACTION", "message": f"Unsupported action: {request.action}", "rawStderr": "", "commandPreview": ""})
    # Delete keeps the original 1-click confirmation dialog: the backend still
    # verifies cluster/action/resource/namespace/name metadata, but does not
    # require typing the resource name. More destructive YAML apply and pod exec
    # keep typed confirmation.
    expected_typed_name = None if action in {"delete", "cordon", "uncordon", "drain"} else name
    require_confirmation(request.confirmation, cluster_id, action, normalized_resource, namespace, name, expected_typed_name)
    auth_check_for_action(cluster_id, action, normalized_resource, namespace)
    command = cluster_command(cluster_id, args, timeout=45, max_output_bytes=TEXT_MAX_OUTPUT_BYTES)
    try:
        result = runner.run(command).stdout
        invalidate_after_resource_action(cluster_id, normalized_resource, namespace, action)
        append_audit_event(action=f"resource.{action}", status="success", cluster_id=cluster_id, namespace=namespace, resource=normalized_resource, name=name, command_preview=command.preview, extra={"replicas": request.replicas} if action == "scale" else {})
        return result
    except KubectlError as exc:
        append_audit_event(action=f"resource.{action}", status="failed", cluster_id=cluster_id, namespace=namespace, resource=normalized_resource, name=name, command_preview=command.preview, message=exc.info.message)
        raise kubectl_error(exc)
