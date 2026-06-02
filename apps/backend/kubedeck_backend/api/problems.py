from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from kubedeck_backend.kubectl.command import KubectlError
from kubedeck_backend.api.runtime import cluster_command, runner

log = logging.getLogger(__name__)
RESOURCE_JSON_MAX_OUTPUT_BYTES = 64 * 1024 * 1024

CATEGORY_LABELS = {
    "crashLoop": "CrashLoopBackOff",
    "imagePull": "ImagePull",
    "scheduling": "Scheduling",
    "node": "Node health",
    "storage": "Storage / volume",
    "restarts": "Restart loop",
    "probe": "Probe failure",
    "deployment": "Deployment availability",
    "event": "Warning event",
    "podPhase": "Pod phase",
    "generic": "Generic",
}

KIND_TO_RESOURCE = {
    "pod": "pods",
    "deployment": "deployments",
    "replicaset": "replicasets",
    "statefulset": "statefulsets",
    "daemonset": "daemonsets",
    "job": "jobs",
    "cronjob": "cronjobs",
    "service": "services",
    "ingress": "ingresses",
    "node": "nodes",
    "persistentvolumeclaim": "persistentvolumeclaims",
    "persistentvolume": "persistentvolumes",
    "configmap": "configmaps",
    "secret": "secrets",
}


def apply_pod_metrics(cluster_id: str, namespace: str, summaries: list[dict[str, Any]]) -> None:
    args = ["top", "pods", "--no-headers"]
    if namespace == "all":
        args.append("-A")
    elif namespace and namespace != "_cluster":
        args.extend(["-n", namespace])
    try:
        output = runner.run(cluster_command(cluster_id, args, timeout=12)).stdout
    except KubectlError as exc:
        log.info("pod metrics unavailable code=%s message=%s", exc.info.code, exc.info.message)
        return
    metrics = parse_pod_metrics(output, namespace)
    for summary in summaries:
        key = (str(summary.get("namespace", "")), str(summary.get("name", "")))
        values = metrics.get(key)
        if values:
            summary.update(values)


def parse_pod_metrics(output: str, namespace: str) -> dict[tuple[str, str], dict[str, str]]:
    results: dict[tuple[str, str], dict[str, str]] = {}
    all_namespaces = namespace == "all"
    for line in output.splitlines():
        parts = line.split()
        if all_namespaces:
            if len(parts) < 4:
                continue
            namespace, name, cpu, memory = parts[0], parts[1], parts[2], parts[3]
        else:
            if len(parts) < 3:
                continue
            metric_namespace, name, cpu, memory = namespace, parts[0], parts[1], parts[2]
            results[(metric_namespace, name)] = {"cpuUsage": cpu, "memoryUsage": format_memory_metric(memory)}
            continue
        results[(namespace, name)] = {"cpuUsage": cpu, "memoryUsage": format_memory_metric(memory)}
    return results


def format_memory_metric(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    if text.endswith("Ki"):
        return f"{float(text[:-2]) / 1024:.1f} MiB"
    if text.endswith("Mi"):
        return f"{float(text[:-2]):.1f} MiB"
    if text.endswith("Gi"):
        return f"{float(text[:-2]) * 1024:.1f} MiB"
    return text


def load_problem_resource(cluster_id: str, resource: str, namespace: str, normalizer: Any) -> list[dict[str, Any]]:
    args = ["get", resource]
    if namespace == "all":
        args.append("-A")
    elif namespace and namespace != "_cluster":
        args.extend(["-n", namespace])
    args.extend(["-o", "json"])
    data = runner.run_json(cluster_command(cluster_id, args, timeout=45, max_output_bytes=RESOURCE_JSON_MAX_OUTPUT_BYTES))
    summaries = [normalizer(item) for item in data.get("items", [])]
    if resource == "pods":
        apply_pod_metrics(cluster_id, namespace, summaries)
    return summaries


def build_problem_rows(
    pods: list[dict[str, Any]],
    deployments: list[dict[str, Any]],
    events: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
    pvcs: list[dict[str, Any]],
    restart_threshold: int,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for pod in pods:
        phase = str(pod.get("phase") or "")
        restarts = int(pod.get("restarts") or 0)
        if phase and phase not in {"Running", "Succeeded", "Completed"}:
            severity = "Critical" if phase in {"Failed", "Unknown"} else "Warning"
            category = "scheduling" if phase == "Pending" else "podPhase"
            results.append(problem_row(f"pod-phase-{pod.get('uid')}", severity, "Pod", "pods", pod.get("namespace"), pod.get("name"), "Pod phase", phase, pod.get("createdAt"), category=category))
        if restarts >= restart_threshold:
            severity = "Critical" if restarts >= restart_threshold * 3 else "Warning"
            results.append(problem_row(f"pod-restarts-{pod.get('uid')}", severity, "Pod", "pods", pod.get("namespace"), pod.get("name"), "Restart threshold", f"{restarts} restarts", pod.get("createdAt"), category="restarts"))
        if pod.get("reason") or pod.get("statusMessage"):
            reason = str(pod.get("reason") or "Pod status")
            message = str(pod.get("statusMessage") or pod.get("reason") or "")
            results.append(problem_row(f"pod-status-{pod.get('uid')}", severity_for_category(classify_problem("Pod", reason, message), "Warning"), "Pod", "pods", pod.get("namespace"), pod.get("name"), reason, message, pod.get("createdAt"), category=classify_problem("Pod", reason, message)))
        if pod.get("containerProblems"):
            message = str(pod.get("containerProblems"))
            category = classify_problem("Pod", "Container problem", message)
            results.append(problem_row(f"pod-containers-{pod.get('uid')}", severity_for_category(category, "Warning"), "Pod", "pods", pod.get("namespace"), pod.get("name"), "Container problem", message, pod.get("createdAt"), category=category))
        if pod.get("conditions"):
            message = str(pod.get("conditions"))
            category = classify_problem("Pod", "Pod conditions", message)
            results.append(problem_row(f"pod-conditions-{pod.get('uid')}", severity_for_category(category, "Warning"), "Pod", "pods", pod.get("namespace"), pod.get("name"), "Pod conditions", message, pod.get("createdAt"), category=category))

    for deployment in deployments:
        ready = str(deployment.get("ready") or "")
        ready_count, desired_count = parse_ready_pair(ready)
        if desired_count > 0 and ready_count < desired_count:
            results.append(problem_row(f"deployment-ready-{deployment.get('uid')}", "Warning", "Deployment", "deployments", deployment.get("namespace"), deployment.get("name"), "Unavailable replicas", ready, deployment.get("createdAt"), category="deployment"))

    for event in events:
        if str(event.get("type") or "").lower() == "warning":
            reason = str(event.get("reason") or "Warning")
            message = str(event.get("message") or "")
            category = classify_problem("Event", reason, message)
            target_kind = str(event.get("involvedKind") or "")
            target_name = str(event.get("involvedName") or "")
            target_namespace = str(event.get("involvedNamespace") or event.get("namespace") or "")
            target_resource = resource_for_kind(target_kind)
            results.append(problem_row(
                f"event-{event.get('uid')}",
                severity_for_category(category, "Warning"),
                "Event",
                "events",
                event.get("namespace"),
                event.get("name"),
                reason,
                message,
                str(event.get("lastTimestamp") or event.get("createdAt") or ""),
                category=category,
                target_kind=target_kind,
                target_resource=target_resource,
                target_namespace=target_namespace,
                target_name=target_name,
            ))

    for node in nodes:
        if str(node.get("status") or "") != "Ready":
            results.append(problem_row(f"node-ready-{node.get('uid')}", "Critical", "Node", "nodes", "_cluster", node.get("name"), "Node not ready", str(node.get("status") or ""), node.get("createdAt"), category="node"))
        if node.get("pressure"):
            results.append(problem_row(f"node-pressure-{node.get('uid')}", "Critical", "Node", "nodes", "_cluster", node.get("name"), "Node pressure", str(node.get("pressure")), node.get("createdAt"), category="node"))

    for pvc in pvcs:
        status = str(pvc.get("status") or "")
        if status and status != "Bound":
            results.append(problem_row(f"pvc-{pvc.get('uid')}", "Warning", "PersistentVolumeClaim", "persistentvolumeclaims", pvc.get("namespace"), pvc.get("name"), "PVC not bound", status, pvc.get("createdAt"), category="storage"))

    return sorted(results, key=problem_sort_key)

def parse_ready_pair(value: str) -> tuple[int, int]:
    try:
        left, right = value.split("/", 1)
        return int(left), int(right)
    except Exception:
        return 0, 0


def problem_row(
    uid: str,
    severity: str,
    kind: str,
    resource: str,
    namespace: Any,
    name: Any,
    reason: str,
    message: str,
    created_at: Any = "",
    *,
    category: str | None = None,
    target_kind: str | None = None,
    target_resource: str | None = None,
    target_namespace: str | None = None,
    target_name: str | None = None,
) -> dict[str, Any]:
    resolved_category = category or classify_problem(kind, reason, message)
    resolved_target_kind = target_kind or kind
    resolved_target_resource = target_resource or resource
    resolved_target_namespace = target_namespace if target_namespace is not None else str(namespace or "")
    resolved_target_name = target_name if target_name is not None else str(name or "")
    return {
        "uid": uid,
        "severity": severity,
        "kind": kind,
        "resource": resource,
        "namespace": str(namespace or ""),
        "name": str(name or ""),
        "reason": reason,
        "message": message,
        "createdAt": str(created_at or ""),
        "category": resolved_category,
        "categoryLabel": CATEGORY_LABELS.get(resolved_category, CATEGORY_LABELS["generic"]),
        "impact": impact_for_category(resolved_category),
        "targetKind": resolved_target_kind,
        "targetResource": resolved_target_resource,
        "targetNamespace": resolved_target_namespace,
        "targetName": resolved_target_name,
    }


def classify_problem(kind: str, reason: str, message: str) -> str:
    text = f"{kind} {reason} {message}".lower()
    if any(token in text for token in ("crashloop", "back-off restarting", "backoff restarting")):
        return "crashLoop"
    if any(token in text for token in ("imagepull", "errimagepull", "image pull", "pull image", "pull access denied", "manifest unknown", "repository does not exist")):
        return "imagePull"
    if any(token in text for token in ("failedscheduling", "unschedulable", "0/", "nodes are available", "preemption", "taint", "toleration", "affinity", "insufficient", "node(s) didn't match")):
        return "scheduling"
    if any(token in text for token in ("failedmount", "mountvolume", "attachvolume", "detachvolume", "persistentvolume", "storageclass", "pvc", "volume", "multi-attach")):
        return "storage"
    if any(token in text for token in ("nodepressure", "node pressure", "notready", "node not ready", "diskpressure", "memorypressure", "pidpressure", "kubelet")):
        return "node"
    if any(token in text for token in ("readiness probe", "liveness probe", "startup probe", "probe failed", "unhealthy")):
        return "probe"
    if any(token in text for token in ("oomkilled", "restart", "restarts", "terminated")):
        return "restarts"
    if "unavailable replicas" in text:
        return "deployment"
    if kind.lower() == "event":
        return "event"
    if "pod phase" in text:
        return "podPhase"
    return "generic"


def severity_for_category(category: str, default: str) -> str:
    if category in {"crashLoop", "imagePull", "node"}:
        return "Critical"
    return default


def impact_for_category(category: str) -> str:
    if category in {"crashLoop", "imagePull", "scheduling", "probe"}:
        return "Workload may be unavailable or degraded."
    if category == "node":
        return "Node capacity or kubelet health can affect multiple workloads."
    if category == "storage":
        return "Pod startup or application writes may be blocked by storage state."
    if category == "deployment":
        return "Desired replicas are not fully available."
    if category == "restarts":
        return "Container instability may cause request failures or data loss."
    return "Open the resource and inspect status, events and related resources."


def resource_for_kind(kind: str) -> str:
    normalized = kind.lower()
    return KIND_TO_RESOURCE.get(normalized, "events")

def problem_sort_key(row: dict[str, Any]) -> tuple[int, float, str]:
    severity_order = {"Critical": 0, "Warning": 1, "Info": 2}
    created = str(row.get("createdAt") or "")
    try:
        timestamp = datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp()
    except Exception:
        timestamp = 0.0
    return (severity_order.get(str(row.get("severity") or ""), 9), -timestamp, str(row.get("name") or ""))


def summarize_problems(items: list[dict[str, Any]], sources: dict[str, list[dict[str, Any]]], errors: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "total": len(items),
        "critical": sum(1 for item in items if item.get("severity") == "Critical"),
        "warning": sum(1 for item in items if item.get("severity") == "Warning"),
        "info": sum(1 for item in items if item.get("severity") == "Info"),
        "errors": len(errors),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sources": {key: len(value) for key, value in sources.items()},
        "categories": count_by(items, "category"),
        "kinds": count_by(items, "kind"),
    }


def count_by(items: list[dict[str, Any]], key: str) -> dict[str, int]:
    values: dict[str, int] = {}
    for item in items:
        value = str(item.get(key) or "unknown")
        values[value] = values.get(value, 0) + 1
    return dict(sorted(values.items(), key=lambda pair: (-pair[1], pair[0])))
