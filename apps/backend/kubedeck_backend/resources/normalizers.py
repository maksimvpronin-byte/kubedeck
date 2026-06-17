from __future__ import annotations

from typing import Any


def meta(item: dict[str, Any]) -> dict[str, Any]:
    metadata = item.get("metadata") or {}
    return {
        "uid": metadata.get("uid", ""),
        "name": metadata.get("name", ""),
        "namespace": metadata.get("namespace", ""),
        "createdAt": metadata.get("creationTimestamp", ""),
        "deletionTimestamp": metadata.get("deletionTimestamp", ""),
        "labels": metadata.get("labels") or {},
        "ownerReferences": metadata.get("ownerReferences") or [],
    }


def pod_summary(item: dict[str, Any]) -> dict[str, Any]:
    status = item.get("status") or {}
    spec = item.get("spec") or {}
    containers = status.get("containerStatuses") or []
    spec_containers = spec.get("containers") or []
    restarts = sum(int(container.get("restartCount") or 0) for container in containers)
    restart_diagnostics = pod_restart_diagnostics(containers)
    ready = sum(1 for container in containers if container.get("ready"))
    container_problems = []
    for container in containers:
        state = container.get("state") or {}
        waiting = state.get("waiting") or {}
        terminated = state.get("terminated") or {}
        reason = waiting.get("reason") or terminated.get("reason") or ""
        message = waiting.get("message") or terminated.get("message") or ""
        if reason or message:
            container_problems.append(f"{container.get('name', '')}: {reason} {message}".strip())
    condition_summary = []
    for condition in status.get("conditions") or []:
        if condition.get("status") != "True":
            condition_summary.append(
                f"{condition.get('type', '')}={condition.get('status', '')} {condition.get('reason', '')} {condition.get('message', '')}".strip()
            )
    base = meta(item)
    deleting = bool(base.get("deletionTimestamp"))
    base.update({
        "phase": "Terminating" if deleting else status.get("phase", ""),
        "status": "Terminating" if deleting else status.get("phase", ""),
        "ready": f"{ready}/{len(containers)}",
        "restarts": restarts,
        "node": spec.get("nodeName", ""),
        "serviceAccountName": spec.get("serviceAccountName", "default"),
        "podIp": status.get("podIP", ""),
        "reason": status.get("reason", ""),
        "statusMessage": status.get("message", ""),
        "containerProblems": "; ".join(container_problems),
        "conditions": "; ".join(condition_summary),
        "containers": [str(container.get("name", "")) for container in spec_containers if container.get("name")],
        "restartDiagnostics": restart_diagnostics,
        "lastRestartReason": first_restart_diagnostic_value(restart_diagnostics, "lastReason"),
        "lastRestartExitCode": first_restart_diagnostic_value(restart_diagnostics, "lastExitCode"),
        "lastRestartFinishedAt": first_restart_diagnostic_value(restart_diagnostics, "lastFinishedAt"),
        "ports": format_container_ports(spec_containers),
        "cpuUsage": "",
        "memoryUsage": "",
    })
    return base


def pod_restart_diagnostics(container_statuses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []
    for container in container_statuses:
        restart_count = int(container.get("restartCount") or 0)
        state = container.get("state") or {}
        waiting = state.get("waiting") or {}
        running = state.get("running") or {}
        terminated = state.get("terminated") or {}
        last_state = container.get("lastState") or {}
        last_terminated = last_state.get("terminated") or {}

        current_state = ""
        if waiting:
            current_state = "waiting"
        elif terminated:
            current_state = "terminated"
        elif running:
            current_state = "running"

        # Keep entries for containers that have restarted or currently carry a
        # non-running/waiting/terminated state. This keeps the UI concise for
        # healthy pods, but still preserves actionable restart information.
        if not restart_count and not last_terminated and not waiting and not terminated:
            continue

        diagnostics.append({
            "container": str(container.get("name") or ""),
            "restartCount": restart_count,
            "ready": bool(container.get("ready")),
            "currentState": current_state,
            "currentReason": str(waiting.get("reason") or terminated.get("reason") or ""),
            "currentMessage": str(waiting.get("message") or terminated.get("message") or ""),
            "lastReason": str(last_terminated.get("reason") or ""),
            "lastExitCode": last_terminated.get("exitCode"),
            "lastSignal": last_terminated.get("signal"),
            "lastStartedAt": str(last_terminated.get("startedAt") or ""),
            "lastFinishedAt": str(last_terminated.get("finishedAt") or ""),
            "lastMessage": str(last_terminated.get("message") or ""),
        })
    return diagnostics


def first_restart_diagnostic_value(diagnostics: list[dict[str, Any]], key: str) -> Any:
    for diagnostic in diagnostics:
        if int(diagnostic.get("restartCount") or 0) <= 0:
            continue
        value = diagnostic.get(key)
        if value not in (None, ""):
            return value
    for diagnostic in diagnostics:
        value = diagnostic.get(key)
        if value not in (None, ""):
            return value
    return ""
def service_account_summary(item: dict[str, Any]) -> dict[str, Any]:
    base = meta(item)
    secrets = item.get("secrets") or []
    image_pull_secrets = item.get("imagePullSecrets") or []
    base.update({
        "secrets": ", ".join(str(secret.get("name", "")) for secret in secrets if secret.get("name")),
        "imagePullSecrets": ", ".join(str(secret.get("name", "")) for secret in image_pull_secrets if secret.get("name")),
    })
    return base


def role_summary(item: dict[str, Any]) -> dict[str, Any]:
    rules = item.get("rules") or []
    base = meta(item)
    base.update({
        "rules": rules,
        "rulesText": format_policy_rules(rules),
    })
    return base


def role_binding_summary(item: dict[str, Any]) -> dict[str, Any]:
    subjects = item.get("subjects") or []
    role_ref = item.get("roleRef") or {}
    base = meta(item)
    base.update({
        "subjects": subjects,
        "subjectsText": format_subjects(subjects),
        "roleRef": role_ref,
        "roleRefKind": role_ref.get("kind", ""),
        "roleRefName": role_ref.get("name", ""),
    })
    return base


def format_subjects(subjects: list[dict[str, Any]]) -> str:
    values = []
    for subject in subjects:
        kind = subject.get("kind", "")
        namespace = subject.get("namespace", "")
        name = subject.get("name", "")
        values.append(f"{kind}/{namespace + '/' if namespace else ''}{name}".strip("/"))
    return ", ".join(values)


def format_policy_rules(rules: list[dict[str, Any]]) -> str:
    values = []
    for rule in rules:
        verbs = ",".join(rule.get("verbs") or [])
        resources = ",".join(rule.get("resources") or [])
        api_groups = ",".join(rule.get("apiGroups") or [])
        values.append(f"{verbs} {api_groups}/{resources}".strip())
    return "; ".join(values)


def format_container_ports(containers: list[dict[str, Any]]) -> str:
    ports: list[str] = []
    for container in containers:
        for port in container.get("ports") or []:
            container_port = port.get("containerPort")
            if not container_port:
                continue
            protocol = str(port.get("protocol") or "TCP")
            name = str(port.get("name") or "")
            label = f"{container_port}/{protocol}"
            if name:
                label = f"{label} ({name})"
            ports.append(label)
    return ", ".join(ports)


def deployment_summary(item: dict[str, Any]) -> dict[str, Any]:
    status = item.get("status") or {}
    spec = item.get("spec") or {}
    base = meta(item)
    base.update({
        "ready": f"{status.get('readyReplicas', 0)}/{spec.get('replicas', 0)}",
        "updated": status.get("updatedReplicas", 0),
        "available": status.get("availableReplicas", 0),
    })
    return base


def service_summary(item: dict[str, Any]) -> dict[str, Any]:
    spec = item.get("spec") or {}
    ports = spec.get("ports") or []
    selector = spec.get("selector") or {}
    base = meta(item)
    base.update({
        "type": spec.get("type", ""),
        "clusterIp": spec.get("clusterIP", ""),
        "ports": ", ".join(str(port.get("port", "")) for port in ports),
        "selector": selector,
        "selectorText": ", ".join(f"{key}={value}" for key, value in selector.items()),
    })
    return base


def ingress_summary(item: dict[str, Any]) -> dict[str, Any]:
    spec = item.get("spec") or {}
    base = meta(item)
    services = sorted(set(ingress_backend_services(spec)))
    base.update({
        "kind": item.get("kind", "Ingress"),
        "className": spec.get("ingressClassName", ""),
        "hosts": ", ".join(rule.get("host", "") for rule in spec.get("rules") or [] if rule.get("host")),
        "backendServices": services,
        "backendServicesText": ", ".join(services),
    })
    return base


def ingress_backend_services(spec: dict[str, Any]) -> list[str]:
    names: list[str] = []
    default_backend = spec.get("defaultBackend") or {}
    default_name = service_name_from_backend(default_backend)
    if default_name:
        names.append(default_name)
    for rule in spec.get("rules") or []:
        http = rule.get("http") or {}
        for path in http.get("paths") or []:
            backend_name = service_name_from_backend(path.get("backend") or {})
            if backend_name:
                names.append(backend_name)
    return names


def service_name_from_backend(backend: dict[str, Any]) -> str:
    service = backend.get("service") or {}
    return str(service.get("name") or backend.get("serviceName") or "")


def crd_summary(item: dict[str, Any]) -> dict[str, Any]:
    spec = item.get("spec") or {}
    names = spec.get("names") or {}
    versions = spec.get("versions") or []
    served_versions = [version.get("name", "") for version in versions if version.get("served")]
    base = meta(item)
    base.update({
        "kind": names.get("kind", ""),
        "plural": names.get("plural", ""),
        "singular": names.get("singular", ""),
        "shortNames": ", ".join(names.get("shortNames") or []),
        "group": spec.get("group", ""),
        "scope": spec.get("scope", ""),
        "versions": ", ".join(served_versions),
        "resourceName": f"{names.get('plural', '')}.{spec.get('group', '')}".strip("."),
    })
    return base


def event_summary(item: dict[str, Any]) -> dict[str, Any]:
    base = meta(item)
    involved = item.get("involvedObject") or {}
    event_time = item.get("lastTimestamp") or item.get("eventTime") or item.get("firstTimestamp") or base.get("createdAt", "")
    base.update({
        "type": item.get("type", ""),
        "reason": item.get("reason", ""),
        "message": item.get("message", ""),
        "object": f"{involved.get('kind', '')}/{involved.get('name', '')}",
        "involvedKind": involved.get("kind", ""),
        "involvedName": involved.get("name", ""),
        "involvedNamespace": involved.get("namespace", "") or base.get("namespace", ""),
        "involvedApiVersion": involved.get("apiVersion", ""),
        "count": item.get("count") or item.get("series", {}).get("count") or 1,
        "source": item.get("source", {}).get("component", "") or item.get("reportingController", ""),
        "createdAt": event_time,
        "lastTimestamp": event_time,
    })
    return base


def node_summary(item: dict[str, Any]) -> dict[str, Any]:
    status = item.get("status") or {}
    spec = item.get("spec") or {}
    capacity = status.get("capacity") or {}
    allocatable = status.get("allocatable") or {}
    node_info = status.get("nodeInfo") or {}
    addresses = status.get("addresses") or []
    address_by_type = {str(address.get("type") or ""): str(address.get("address") or "") for address in addresses if address.get("address")}
    conditions = status.get("conditions") or []
    ready = next((condition for condition in conditions if condition.get("type") == "Ready"), {})
    pressure = [
        f"{condition.get('type', '')}: {condition.get('reason', '')} {condition.get('message', '')}".strip()
        for condition in conditions
        if condition.get("type") != "Ready" and condition.get("status") == "True"
    ]
    base = meta(item)
    base.update({
        "status": ("Ready" if ready.get("status") == "True" else "NotReady") + (", SchedulingDisabled" if spec.get("unschedulable") else ""),
        "unschedulable": bool(spec.get("unschedulable")),
        "internalIp": address_by_type.get("InternalIP", ""),
        "externalIp": address_by_type.get("ExternalIP", ""),
        "hostname": address_by_type.get("Hostname", ""),
        "addresses": addresses,
        "os": node_info.get("operatingSystem", ""),
        "osImage": node_info.get("osImage", ""),
        "kernelVersion": node_info.get("kernelVersion", ""),
        "architecture": node_info.get("architecture", ""),
        "containerRuntime": node_info.get("containerRuntimeVersion", ""),
        "kubeletVersion": node_info.get("kubeletVersion", ""),
        "cpuCapacity": capacity.get("cpu", ""),
        "memoryCapacity": format_bytes_quantity(capacity.get("memory", "")),
        "podsCapacity": capacity.get("pods", ""),
        "cpuAllocatable": allocatable.get("cpu", ""),
        "memoryAllocatable": format_bytes_quantity(allocatable.get("memory", "")),
        "podsAllocatable": allocatable.get("pods", ""),
        "diskCapacity": format_bytes_quantity(capacity.get("ephemeral-storage", "")),
        "diskAllocatable": format_bytes_quantity(allocatable.get("ephemeral-storage", "")),
        "pressure": "; ".join(pressure),
    })
    return base


def format_bytes_quantity(value: Any) -> str:
    text = str(value or "")
    if not text:
        return ""
    suffixes = {
        "Ki": 1024,
        "Mi": 1024 ** 2,
        "Gi": 1024 ** 3,
        "Ti": 1024 ** 4,
    }
    for suffix, multiplier in suffixes.items():
        if text.endswith(suffix):
            number = float(text.removesuffix(suffix))
            return f"{number * multiplier / (1024 ** 3):.2f} GiB"
    if text.isdigit():
        return f"{int(text) / (1024 ** 3):.2f} GiB"
    return text
