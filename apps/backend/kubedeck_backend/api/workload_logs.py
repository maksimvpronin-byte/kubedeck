from __future__ import annotations

from typing import Any

from kubedeck_backend.api.runtime import cluster_command, kubectl_error, runner
from kubedeck_backend.api.validation import api_error, normalize_tail_lines, validate_identifier
from kubedeck_backend.kubectl.command import KubectlError


def deployment_log_targets(cluster_id: str, namespace: str, name: str) -> dict[str, Any]:
    deployment = load_deployment(cluster_id, namespace, name)
    pods = matching_deployment_pods(cluster_id, namespace, deployment)
    containers = sorted({container for pod in pods for container in pod.get("containers", [])})
    return {
        "namespace": namespace,
        "name": name,
        "pods": [
            {
                "name": str(pod.get("name") or ""),
                "phase": str(pod.get("phase") or ""),
                "containers": pod.get("containers", []),
            }
            for pod in pods
        ],
        "containers": containers,
    }


def deployment_logs_text(
    cluster_id: str,
    namespace: str,
    name: str,
    *,
    tail: int = 500,
    all_logs: bool = False,
    previous: bool = False,
    timestamps: bool = False,
    container: str | None = None,
    pod: str | None = None,
    logs_max_output_bytes: int,
    logs_full_max_output_bytes: int,
) -> str:
    deployment = load_deployment(cluster_id, namespace, name)
    pods = matching_deployment_pods(cluster_id, namespace, deployment)
    if pod:
        selected_pod = validate_identifier(pod, "pod", max_length=253)
        pods = [item for item in pods if item.get("name") == selected_pod]
    if not pods:
        return f"No pods matched deployment/{name} in namespace {namespace}."

    selected_container = validate_identifier(container, "container", max_length=253) if container else ""
    if all_logs:
        timeout = 60
        max_output_bytes = logs_full_max_output_bytes
    else:
        tail = normalize_tail_lines(tail)
        timeout = 35
        max_output_bytes = logs_max_output_bytes

    blocks: list[str] = []
    for pod_item in pods:
        pod_name = str(pod_item.get("name") or "")
        if not pod_name:
            continue
        pod_containers = [str(item) for item in pod_item.get("containers", []) if item]
        args = ["--request-timeout=20s", "logs", pod_name, "-n", namespace, "--prefix=true"]
        if all_logs:
            args.append("--tail=-1")
        else:
            args.append(f"--tail={tail}")
        if selected_container:
            args.extend(["-c", selected_container])
        elif len(pod_containers) > 1:
            args.append("--all-containers=true")
        if previous:
            args.append("--previous")
        if timestamps:
            args.append("--timestamps")

        header_container = selected_container or ("all containers" if len(pod_containers) > 1 else (pod_containers[0] if pod_containers else "default"))
        blocks.append(f"===== pod/{pod_name} · {header_container} =====")
        try:
            output = runner.run(cluster_command(cluster_id, args, timeout=timeout, max_output_bytes=max_output_bytes)).stdout.rstrip()
            blocks.append(output or "<no log lines>")
        except KubectlError as exc:
            blocks.append(f"<failed to load logs: {exc.info.message}>")
    return "\n".join(blocks).rstrip() + "\n"


def load_deployment(cluster_id: str, namespace: str, name: str) -> dict[str, Any]:
    try:
        return runner.run_json(cluster_command(cluster_id, ["get", "deployment", name, "-n", namespace, "-o", "json"], timeout=30, max_output_bytes=4 * 1024 * 1024))
    except KubectlError as exc:
        raise kubectl_error(exc)


def matching_deployment_pods(cluster_id: str, namespace: str, deployment: dict[str, Any]) -> list[dict[str, Any]]:
    selector = ((deployment.get("spec") or {}).get("selector") or {})
    if not selector:
        raise api_error(400, "DEPLOYMENT_SELECTOR_MISSING", "Deployment selector is missing")
    try:
        data = runner.run_json(cluster_command(cluster_id, ["get", "pods", "-n", namespace, "-o", "json"], timeout=30, max_output_bytes=16 * 1024 * 1024))
    except KubectlError as exc:
        raise kubectl_error(exc)

    result: list[dict[str, Any]] = []
    for item in data.get("items") or []:
        metadata = item.get("metadata") or {}
        labels = metadata.get("labels") or {}
        if not selector_matches(labels, selector):
            continue
        spec = item.get("spec") or {}
        status = item.get("status") or {}
        containers = [str(container.get("name") or "") for container in spec.get("containers") or [] if container.get("name")]
        result.append({
            "name": str(metadata.get("name") or ""),
            "phase": str(status.get("phase") or ""),
            "containers": containers,
            "createdAt": str(metadata.get("creationTimestamp") or ""),
        })
    return sorted(result, key=lambda item: (str(item.get("createdAt") or ""), str(item.get("name") or "")))


def selector_matches(labels: dict[str, Any], selector: dict[str, Any]) -> bool:
    match_labels = selector.get("matchLabels") or {}
    for key, expected in match_labels.items():
        if str(labels.get(key, "")) != str(expected):
            return False

    for expression in selector.get("matchExpressions") or []:
        key = str(expression.get("key") or "")
        operator = str(expression.get("operator") or "")
        values = {str(value) for value in expression.get("values") or []}
        has_key = key in labels
        actual = str(labels.get(key, ""))
        if operator == "In" and (not has_key or actual not in values):
            return False
        if operator == "NotIn" and has_key and actual in values:
            return False
        if operator == "Exists" and not has_key:
            return False
        if operator == "DoesNotExist" and has_key:
            return False
    return True
