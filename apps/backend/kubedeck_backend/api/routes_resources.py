from __future__ import annotations

from fastapi import APIRouter

from .common import *
from .resource_cache import get_cached_resource_list_response, invalidate_after_resource_action, set_cached_resource_list_response
from .secrets import SecretCopyAuditRequest, SecretRevealRequest, audit_secret_copy, reveal_secret_key, secret_keys_response
from .workload_logs import deployment_log_targets, deployment_logs_text


router = APIRouter()


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
    try:
        return runner.run(cluster_command(cluster_id, args, timeout=30, max_output_bytes=TEXT_MAX_OUTPUT_BYTES)).stdout
    except KubectlError as exc:
        raise kubectl_error(exc)

@router.get("/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/describe", response_class=PlainTextResponse)
def resource_describe(cluster_id: str, resource: str, namespace: str, name: str) -> str:
    resource = validate_identifier(resource, "resource", max_length=128).lower()
    name = validate_identifier(name, "name")
    if namespace != "_cluster":
        namespace = validate_identifier(namespace, "namespace")
    args = ["describe", resource, name]
    if namespace != "_cluster":
        args.extend(["-n", namespace])
    try:
        return runner.run(cluster_command(cluster_id, args, timeout=30, max_output_bytes=TEXT_MAX_OUTPUT_BYTES)).stdout
    except KubectlError as exc:
        raise kubectl_error(exc)

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
    else:
        raise HTTPException(status_code=400, detail={"code": "UNSUPPORTED_ACTION", "message": f"Unsupported action: {request.action}", "rawStderr": "", "commandPreview": ""})
    # Delete keeps the original 1-click confirmation dialog: the backend still
    # verifies cluster/action/resource/namespace/name metadata, but does not
    # require typing the resource name. More destructive YAML apply and pod exec
    # keep typed confirmation.
    expected_typed_name = None if action == "delete" else name
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
