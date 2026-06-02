from __future__ import annotations

from typing import Any

from kubedeck_backend.api.runtime import cluster_command, runner
from kubedeck_backend.api.search import SEARCH_MAX_OUTPUT_BYTES, generic_summary
from kubedeck_backend.kubectl.command import KubectlError
from kubedeck_backend.resources.normalizers import (
    crd_summary,
    deployment_summary,
    event_summary,
    ingress_backend_services,
    ingress_summary,
    node_summary,
    pod_summary,
    role_binding_summary,
    role_summary,
    service_account_summary,
    service_summary,
)

RESOURCE_JSON_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
TEXT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024


def normalizer_for_resource(resource: str) -> Any:
    normalizers = {
        "pods": pod_summary,
        "pod": pod_summary,
        "deployments": deployment_summary,
        "deployments.apps": deployment_summary,
        "services": service_summary,
        "service": service_summary,
        "ingresses": ingress_summary,
        "ingresses.networking.k8s.io": ingress_summary,
        "customresourcedefinitions": crd_summary,
        "customresourcedefinitions.apiextensions.k8s.io": crd_summary,
        "events": event_summary,
        "nodes": node_summary,
        "node": node_summary,
        "serviceaccounts": service_account_summary,
        "serviceaccount": service_account_summary,
        "roles": role_summary,
        "role": role_summary,
        "clusterroles": role_summary,
        "clusterrole": role_summary,
        "rolebindings": role_binding_summary,
        "rolebinding": role_binding_summary,
        "clusterrolebindings": role_binding_summary,
        "clusterrolebinding": role_binding_summary,
    }
    return normalizers.get(resource, generic_summary)


def load_raw_items(cluster_id: str, resource: str, namespace: str, *, timeout: int = 30, max_output_bytes: int = RESOURCE_JSON_MAX_OUTPUT_BYTES) -> list[dict[str, Any]]:
    args = ["get", resource]
    if resource in {"namespaces", "nodes", "persistentvolumes", "storageclasses", "clusterroles", "clusterrolebindings", "customresourcedefinitions", "customresourcedefinitions.apiextensions.k8s.io"}:
        pass
    elif namespace == "all":
        args.append("-A")
    elif namespace and namespace != "_cluster":
        args.extend(["-n", namespace])
    args.extend(["-o", "json"])
    data = runner.run_json(cluster_command(cluster_id, args, timeout=timeout, max_output_bytes=max_output_bytes))
    return data.get("items", []) if isinstance(data.get("items", []), list) else []


def load_target_raw(cluster_id: str, resource: str, namespace: str, name: str) -> dict[str, Any]:
    args = ["get", resource, name]
    if namespace != "_cluster":
        args.extend(["-n", namespace])
    args.extend(["-o", "json"])
    data = runner.run_json(cluster_command(cluster_id, args, timeout=30, max_output_bytes=TEXT_MAX_OUTPUT_BYTES))
    return data if isinstance(data, dict) else {}


def filter_events_for_target(events: list[dict[str, Any]], resource: str, namespace: str, name: str, target_raw: dict[str, Any]) -> list[dict[str, Any]]:
    metadata = target_raw.get("metadata") or {}
    target_uid = str(metadata.get("uid") or "")
    target_kind = str(target_raw.get("kind") or kind_for_resource(resource))
    target_namespace = str(metadata.get("namespace") or ("" if namespace == "_cluster" else namespace))
    matched: list[dict[str, Any]] = []
    for event in events:
        involved = event.get("involvedObject") or event.get("regarding") or {}
        event_name = str(involved.get("name") or "")
        event_kind = str(involved.get("kind") or "")
        event_uid = str(involved.get("uid") or "")
        event_namespace = str(involved.get("namespace") or event.get("metadata", {}).get("namespace") or "")
        if target_uid and event_uid and event_uid == target_uid:
            matched.append(event)
            continue
        if event_name != name:
            continue
        if target_kind and event_kind and event_kind != target_kind:
            continue
        if target_namespace and event_namespace and event_namespace != target_namespace:
            continue
        matched.append(event)
    return sorted(matched, key=lambda item: str(item.get("lastTimestamp") or item.get("eventTime") or item.get("metadata", {}).get("creationTimestamp") or ""), reverse=True)


def build_related_links(cluster_id: str, resource: str, namespace: str, target_raw: dict[str, Any], target_summary: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, int], list[dict[str, Any]]]:
    sources: dict[str, int] = {}
    errors: list[dict[str, Any]] = []

    def safe_load(source_resource: str, source_namespace: str) -> list[dict[str, Any]]:
        try:
            items = load_raw_items(cluster_id, source_resource, source_namespace, timeout=25, max_output_bytes=SEARCH_MAX_OUTPUT_BYTES)
            sources[source_resource] = len(items)
            return items
        except KubectlError as exc:
            info = exc.info.model_dump()
            info["resource"] = source_resource
            info["namespace"] = source_namespace
            errors.append(info)
            sources[source_resource] = 0
            return []

    links: list[dict[str, Any]] = []
    metadata = target_raw.get("metadata") or {}
    spec = target_raw.get("spec") or {}
    name = str(metadata.get("name") or target_summary.get("name") or "")
    target_namespace = str(metadata.get("namespace") or ("" if namespace == "_cluster" else namespace))
    labels = metadata.get("labels") or {}

    # Common owner links are intentionally not returned here: the drawer already renders ownerReferences instantly from the selected row.
    if resource in {"pods", "pod"}:
        node_name = str(spec.get("nodeName") or "")
        if node_name:
            links.append(related_link("nodes", "_cluster", node_name, "Node", "scheduled on", ""))
        service_account = str(spec.get("serviceAccountName") or "default")
        if service_account and target_namespace:
            links.append(related_link("serviceaccounts", target_namespace, service_account, "ServiceAccount", "used by pod", ""))
        links.extend(pod_reference_links(target_raw, target_namespace))
        for owner in owner_reference_links_for_pod(target_raw, target_namespace, safe_load):
            links.append(owner)
        for service in safe_load("services", target_namespace):
            service_spec = service.get("spec") or {}
            if selector_matches(labels, service_spec.get("selector") or {}):
                links.append(related_link("services", target_namespace, metadata_name(service), "Service", "selects this pod", selector_detail(service_spec.get("selector") or {})))

    if resource in {"deployments", "deployments.apps", "statefulsets", "daemonsets", "replicasets", "jobs", "cronjobs"}:
        selector = selector_from_workload(spec)
        if target_namespace and selector:
            for pod in safe_load("pods", target_namespace):
                if selector_matches((pod.get("metadata") or {}).get("labels") or {}, selector):
                    links.append(related_link("pods", target_namespace, metadata_name(pod), "Pod", "matches workload selector", selector_detail(selector)))
            for service in safe_load("services", target_namespace):
                service_spec = service.get("spec") or {}
                if selector_matches(selector, service_spec.get("selector") or {}):
                    links.append(related_link("services", target_namespace, metadata_name(service), "Service", "targets this workload", selector_detail(service_spec.get("selector") or {})))
        if resource in {"deployments", "deployments.apps"} and target_namespace:
            for rs in safe_load("replicasets", target_namespace):
                if has_owner(rs, "Deployment", name):
                    links.append(related_link("replicasets", target_namespace, metadata_name(rs), "ReplicaSet", "owned by deployment", ""))

    if resource in {"services", "service"}:
        selector = spec.get("selector") or {}
        if target_namespace and selector:
            for pod in safe_load("pods", target_namespace):
                if selector_matches((pod.get("metadata") or {}).get("labels") or {}, selector):
                    links.append(related_link("pods", target_namespace, metadata_name(pod), "Pod", "selected by service", selector_detail(selector)))
        if target_namespace:
            for ingress in safe_load("ingresses", target_namespace):
                if name in ingress_backend_services(ingress.get("spec") or {}):
                    links.append(related_link("ingresses", target_namespace, metadata_name(ingress), "Ingress", "routes to service", ""))
            for endpoints in safe_load("endpoints", target_namespace):
                if metadata_name(endpoints) == name:
                    links.append(related_link("endpoints", target_namespace, name, "Endpoints", "backing endpoints", ""))
            for endpointslice in safe_load("endpointslices", target_namespace):
                if endpoint_slice_service_name(endpointslice) == name:
                    links.append(related_link("endpointslices", target_namespace, metadata_name(endpointslice), "EndpointSlice", "backing endpoint slice", endpoint_slice_address_detail(endpointslice)))

    if resource in {"endpoints", "endpoint"}:
        if target_namespace:
            links.append(related_link("services", target_namespace, name, "Service", "backs service", ""))
            links.extend(endpoint_address_links(target_raw, target_namespace))

    if resource in {"endpointslices", "endpointslice", "endpointslices.discovery.k8s.io"}:
        service_name = endpoint_slice_service_name(target_raw)
        if service_name and target_namespace:
            links.append(related_link("services", target_namespace, service_name, "Service", "backs service", ""))
        links.extend(endpoint_slice_address_links(target_raw, target_namespace))

    if resource in {"ingresses", "ingresses.networking.k8s.io", "ingress"}:
        for service_name in ingress_backend_services(spec):
            links.append(related_link("services", target_namespace, service_name, "Service", "used by ingress", ""))

    if resource in {"persistentvolumeclaims", "pvc"}:
        volume_name = str(spec.get("volumeName") or "")
        if volume_name:
            links.append(related_link("persistentvolumes", "_cluster", volume_name, "PersistentVolume", "bound volume", ""))
        storage_class = str(spec.get("storageClassName") or "")
        if storage_class:
            links.append(related_link("storageclasses", "_cluster", storage_class, "StorageClass", "storage class", ""))
        if target_namespace:
            for pod in safe_load("pods", target_namespace):
                if pod_uses_pvc(pod, name):
                    links.append(related_link("pods", target_namespace, metadata_name(pod), "Pod", "mounts this PVC", ""))

    if resource in {"persistentvolumes", "pv"}:
        claim_ref = spec.get("claimRef") or {}
        claim_name = str(claim_ref.get("name") or "")
        claim_namespace = str(claim_ref.get("namespace") or "")
        if claim_name:
            links.append(related_link("persistentvolumeclaims", claim_namespace or "_cluster", claim_name, "PersistentVolumeClaim", "bound claim", ""))
        storage_class = str(spec.get("storageClassName") or "")
        if storage_class:
            links.append(related_link("storageclasses", "_cluster", storage_class, "StorageClass", "storage class", ""))

    if resource in {"configmaps", "configmap", "secrets", "secret"}:
        if target_namespace:
            for pod in safe_load("pods", target_namespace):
                relation = pod_uses_config_resource(pod, "configMap" if resource.startswith("config") else "secret", name)
                if relation:
                    links.append(related_link("pods", target_namespace, metadata_name(pod), "Pod", relation, ""))

    if resource in {"serviceaccounts", "serviceaccount"}:
        if target_namespace:
            links.extend(service_account_secret_links(target_raw, target_namespace))
            for pod in safe_load("pods", target_namespace):
                if str((pod.get("spec") or {}).get("serviceAccountName") or "default") == name:
                    links.append(related_link("pods", target_namespace, metadata_name(pod), "Pod", "uses this service account", ""))
            for binding in safe_load("rolebindings", target_namespace):
                if binding_has_service_account_subject_raw(binding, target_namespace, name):
                    links.append(related_link("rolebindings", target_namespace, metadata_name(binding), "RoleBinding", "grants permissions", role_ref_detail_raw(binding)))
        for binding in safe_load("clusterrolebindings", "_cluster"):
            if binding_has_service_account_subject_raw(binding, target_namespace, name):
                links.append(related_link("clusterrolebindings", "_cluster", metadata_name(binding), "ClusterRoleBinding", "grants cluster permissions", role_ref_detail_raw(binding)))

    if resource in {"roles", "role"}:
        if target_namespace:
            for binding in safe_load("rolebindings", target_namespace):
                role_ref = binding.get("roleRef") or {}
                if str(role_ref.get("kind") or "") == "Role" and str(role_ref.get("name") or "") == name:
                    links.append(related_link("rolebindings", target_namespace, metadata_name(binding), "RoleBinding", "uses this role", subjects_detail_raw(binding)))

    if resource in {"clusterroles", "clusterrole"}:
        for binding in safe_load("clusterrolebindings", "_cluster"):
            role_ref = binding.get("roleRef") or {}
            if str(role_ref.get("kind") or "") == "ClusterRole" and str(role_ref.get("name") or "") == name:
                links.append(related_link("clusterrolebindings", "_cluster", metadata_name(binding), "ClusterRoleBinding", "uses this cluster role", subjects_detail_raw(binding)))
        for binding in safe_load("rolebindings", "all"):
            role_ref = binding.get("roleRef") or {}
            if str(role_ref.get("kind") or "") == "ClusterRole" and str(role_ref.get("name") or "") == name:
                links.append(related_link("rolebindings", str((binding.get("metadata") or {}).get("namespace") or "_cluster"), metadata_name(binding), "RoleBinding", "uses this cluster role", subjects_detail_raw(binding)))

    if resource in {"rolebindings", "rolebinding", "clusterrolebindings", "clusterrolebinding"}:
        binding_namespace = target_namespace if resource.startswith("role") else "_cluster"
        links.extend(role_ref_links_raw(target_raw, binding_namespace))
        links.extend(subject_links_raw(target_raw, binding_namespace))

    if resource in {"nodes", "node"}:
        for pod in safe_load("pods", "all"):
            if str((pod.get("spec") or {}).get("nodeName") or "") == name:
                pod_meta = pod.get("metadata") or {}
                links.append(related_link("pods", str(pod_meta.get("namespace") or "default"), metadata_name(pod), "Pod", "scheduled on node", ""))

    return dedupe_related_links(links), sources, errors


def metadata_name(item: dict[str, Any]) -> str:
    return str((item.get("metadata") or {}).get("name") or "")


def metadata_namespace(item: dict[str, Any], fallback: str = "_cluster") -> str:
    return str((item.get("metadata") or {}).get("namespace") or fallback)


def kind_for_resource(resource: str) -> str:
    mapping = {
        "pods": "Pod", "pod": "Pod",
        "deployments": "Deployment", "deployments.apps": "Deployment",
        "statefulsets": "StatefulSet", "daemonsets": "DaemonSet", "replicasets": "ReplicaSet",
        "jobs": "Job", "cronjobs": "CronJob",
        "services": "Service", "service": "Service",
        "ingresses": "Ingress", "ingresses.networking.k8s.io": "Ingress",
        "endpoints": "Endpoints", "endpointslices": "EndpointSlice", "endpointslices.discovery.k8s.io": "EndpointSlice",
        "configmaps": "ConfigMap", "secrets": "Secret",
        "persistentvolumeclaims": "PersistentVolumeClaim", "persistentvolumes": "PersistentVolume",
        "storageclasses": "StorageClass", "nodes": "Node", "namespaces": "Namespace",
        "serviceaccounts": "ServiceAccount", "roles": "Role", "rolebindings": "RoleBinding",
        "clusterroles": "ClusterRole", "clusterrolebindings": "ClusterRoleBinding",
    }
    return mapping.get(resource, singular_kind(resource))


def singular_kind(resource: str) -> str:
    base = resource.split(".", 1)[0]
    if base.endswith("ies"):
        base = f"{base[:-3]}y"
    elif base.endswith("ses"):
        base = base[:-2]
    elif base.endswith("s"):
        base = base[:-1]
    return "".join(part.capitalize() for part in base.split("-"))


def related_link(resource: str, namespace: str, name: str, kind: str, relation: str, detail: str = "") -> dict[str, Any]:
    return {"key": f"{resource}:{namespace}:{name}:{relation}", "resource": resource, "namespace": namespace or "_cluster", "name": name, "kind": kind, "relation": relation, "detail": detail}


def dedupe_related_links(links: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str, str, str]] = set()
    result: list[dict[str, Any]] = []
    for link in links:
        if not link.get("resource") or not link.get("name"):
            continue
        key = (str(link.get("resource")), str(link.get("namespace")), str(link.get("name")), str(link.get("relation")))
        if key in seen:
            continue
        seen.add(key)
        result.append(link)
    return sorted(result, key=lambda item: (str(item.get("kind")), str(item.get("namespace")), str(item.get("name"))))


def selector_from_workload(spec: dict[str, Any]) -> dict[str, Any]:
    selector = spec.get("selector") or {}
    if isinstance(selector, dict):
        match_labels = selector.get("matchLabels") or {}
        return match_labels if isinstance(match_labels, dict) else {}
    return {}


def selector_matches(labels_value: Any, selector_value: Any) -> bool:
    labels = labels_value if isinstance(labels_value, dict) else {}
    selector = selector_value if isinstance(selector_value, dict) else {}
    return bool(selector) and all(str(labels.get(key, "")) == str(value) for key, value in selector.items())


def selector_detail(selector: Any) -> str:
    if not isinstance(selector, dict):
        return ""
    return ", ".join(f"{key}={value}" for key, value in selector.items())


def has_owner(item: dict[str, Any], kind: str, name: str) -> bool:
    for owner in (item.get("metadata") or {}).get("ownerReferences") or []:
        if str(owner.get("kind") or "") == kind and str(owner.get("name") or "") == name:
            return True
    return False


def pod_reference_links(pod: dict[str, Any], namespace: str) -> list[dict[str, Any]]:
    links: list[dict[str, Any]] = []
    spec = pod.get("spec") or {}
    for secret in spec.get("imagePullSecrets") or []:
        if isinstance(secret, dict) and secret.get("name"):
            links.append(related_link("secrets", namespace, str(secret.get("name")), "Secret", "imagePull secret", ""))
    for volume in spec.get("volumes") or []:
        if not isinstance(volume, dict):
            continue
        pvc = volume.get("persistentVolumeClaim") or {}
        if pvc.get("claimName"):
            links.append(related_link("persistentvolumeclaims", namespace, str(pvc.get("claimName")), "PersistentVolumeClaim", "mounted volume", str(volume.get("name") or "")))
        config_map = volume.get("configMap") or {}
        if config_map.get("name"):
            links.append(related_link("configmaps", namespace, str(config_map.get("name")), "ConfigMap", "mounted config", str(volume.get("name") or "")))
        secret = volume.get("secret") or {}
        if secret.get("secretName"):
            links.append(related_link("secrets", namespace, str(secret.get("secretName")), "Secret", "mounted secret", str(volume.get("name") or "")))
    for container in list(spec.get("containers") or []) + list(spec.get("initContainers") or []):
        links.extend(container_config_links(container, namespace))
    return links


def container_config_links(container: dict[str, Any], namespace: str) -> list[dict[str, Any]]:
    links: list[dict[str, Any]] = []
    if not isinstance(container, dict):
        return links
    container_name = str(container.get("name") or "")
    detail_prefix = f"container {container_name}" if container_name else "container"
    for env_from in container.get("envFrom") or []:
        if not isinstance(env_from, dict):
            continue
        config_ref = env_from.get("configMapRef") or {}
        if config_ref.get("name"):
            links.append(related_link("configmaps", namespace, str(config_ref.get("name")), "ConfigMap", "envFrom config", detail_prefix))
        secret_ref = env_from.get("secretRef") or {}
        if secret_ref.get("name"):
            links.append(related_link("secrets", namespace, str(secret_ref.get("name")), "Secret", "envFrom secret", detail_prefix))
    for env in container.get("env") or []:
        value_from = env.get("valueFrom") if isinstance(env, dict) else None
        if not isinstance(value_from, dict):
            continue
        config_ref = value_from.get("configMapKeyRef") or {}
        if config_ref.get("name"):
            key_detail = f"{detail_prefix}, key {config_ref.get('key', '')}".rstrip()
            links.append(related_link("configmaps", namespace, str(config_ref.get("name")), "ConfigMap", "env key config", key_detail))
        secret_ref = value_from.get("secretKeyRef") or {}
        if secret_ref.get("name"):
            key_detail = f"{detail_prefix}, key {secret_ref.get('key', '')}".rstrip()
            links.append(related_link("secrets", namespace, str(secret_ref.get("name")), "Secret", "env key secret", key_detail))
    return links


def owner_reference_links_for_pod(pod: dict[str, Any], namespace: str, safe_load: Any) -> list[dict[str, Any]]:
    links: list[dict[str, Any]] = []
    for owner in (pod.get("metadata") or {}).get("ownerReferences") or []:
        kind = str(owner.get("kind") or "")
        owner_name = str(owner.get("name") or "")
        if not owner_name:
            continue
        if kind == "ReplicaSet":
            for rs in safe_load("replicasets", namespace):
                if metadata_name(rs) != owner_name:
                    continue
                for rs_owner in (rs.get("metadata") or {}).get("ownerReferences") or []:
                    if str(rs_owner.get("kind") or "") == "Deployment" and rs_owner.get("name"):
                        links.append(related_link("deployments", namespace, str(rs_owner.get("name")), "Deployment", "controls pod via ReplicaSet", owner_name))
                break
        elif kind == "Job":
            for job in safe_load("jobs", namespace):
                if metadata_name(job) != owner_name:
                    continue
                for job_owner in (job.get("metadata") or {}).get("ownerReferences") or []:
                    if str(job_owner.get("kind") or "") == "CronJob" and job_owner.get("name"):
                        links.append(related_link("cronjobs", namespace, str(job_owner.get("name")), "CronJob", "controls pod via Job", owner_name))
                break
    return links


def service_account_secret_links(service_account: dict[str, Any], namespace: str) -> list[dict[str, Any]]:
    links: list[dict[str, Any]] = []
    for secret in service_account.get("secrets") or []:
        if isinstance(secret, dict) and secret.get("name"):
            links.append(related_link("secrets", namespace, str(secret.get("name")), "Secret", "service account token/secret", ""))
    for secret in service_account.get("imagePullSecrets") or []:
        if isinstance(secret, dict) and secret.get("name"):
            links.append(related_link("secrets", namespace, str(secret.get("name")), "Secret", "service account imagePullSecret", ""))
    return links


def endpoint_slice_service_name(endpoint_slice: dict[str, Any]) -> str:
    labels = (endpoint_slice.get("metadata") or {}).get("labels") or {}
    return str(labels.get("kubernetes.io/service-name") or "")


def endpoint_slice_address_detail(endpoint_slice: dict[str, Any]) -> str:
    endpoint_count = len(endpoint_slice.get("endpoints") or [])
    port_count = len(endpoint_slice.get("ports") or [])
    parts = []
    if endpoint_count:
        parts.append(f"{endpoint_count} endpoints")
    if port_count:
        parts.append(f"{port_count} ports")
    return ", ".join(parts)


def endpoint_address_links(endpoints: dict[str, Any], namespace: str) -> list[dict[str, Any]]:
    links: list[dict[str, Any]] = []
    for subset in endpoints.get("subsets") or []:
        for address in subset.get("addresses") or []:
            target_ref = address.get("targetRef") if isinstance(address, dict) else None
            if not isinstance(target_ref, dict):
                continue
            kind = str(target_ref.get("kind") or "")
            name = str(target_ref.get("name") or "")
            target_namespace = str(target_ref.get("namespace") or namespace)
            resource = resource_for_kind(kind)
            if resource and name:
                links.append(related_link(resource, target_namespace, name, kind, "endpoint target", str(address.get("ip") or "")))
    return links


def endpoint_slice_address_links(endpoint_slice: dict[str, Any], namespace: str) -> list[dict[str, Any]]:
    links: list[dict[str, Any]] = []
    for endpoint in endpoint_slice.get("endpoints") or []:
        if not isinstance(endpoint, dict):
            continue
        target_ref = endpoint.get("targetRef") or {}
        kind = str(target_ref.get("kind") or "")
        name = str(target_ref.get("name") or "")
        target_namespace = str(target_ref.get("namespace") or namespace)
        resource = resource_for_kind(kind)
        addresses = ",".join(str(address) for address in endpoint.get("addresses") or [])
        if resource and name:
            links.append(related_link(resource, target_namespace, name, kind, "endpoint slice target", addresses))
    return links


def resource_for_kind(kind: str) -> str:
    mapping = {
        "Pod": "pods",
        "Service": "services",
        "Deployment": "deployments",
        "ReplicaSet": "replicasets",
        "StatefulSet": "statefulsets",
        "DaemonSet": "daemonsets",
        "Job": "jobs",
        "CronJob": "cronjobs",
        "Node": "nodes",
        "PersistentVolumeClaim": "persistentvolumeclaims",
        "PersistentVolume": "persistentvolumes",
        "ServiceAccount": "serviceaccounts",
    }
    return mapping.get(kind, "")


def pod_uses_pvc(pod: dict[str, Any], claim_name: str) -> bool:
    for volume in (pod.get("spec") or {}).get("volumes") or []:
        pvc = volume.get("persistentVolumeClaim") if isinstance(volume, dict) else None
        if isinstance(pvc, dict) and str(pvc.get("claimName") or "") == claim_name:
            return True
    return False


def pod_uses_config_resource(pod: dict[str, Any], ref_kind: str, name: str) -> str:
    spec = pod.get("spec") or {}
    volume_field = "configMap" if ref_kind == "configMap" else "secret"
    name_field = "name" if ref_kind == "configMap" else "secretName"
    for volume in spec.get("volumes") or []:
        ref = volume.get(volume_field) if isinstance(volume, dict) else None
        if isinstance(ref, dict) and str(ref.get(name_field) or "") == name:
            return "mounted by pod"
    for container in list(spec.get("containers") or []) + list(spec.get("initContainers") or []):
        if not isinstance(container, dict):
            continue
        for env_from in container.get("envFrom") or []:
            ref = env_from.get(f"{ref_kind}Ref") if isinstance(env_from, dict) else None
            if isinstance(ref, dict) and str(ref.get("name") or "") == name:
                return "used by envFrom"
        for env in container.get("env") or []:
            value_from = env.get("valueFrom") if isinstance(env, dict) else None
            ref = value_from.get(f"{ref_kind}KeyRef") if isinstance(value_from, dict) else None
            if isinstance(ref, dict) and str(ref.get("name") or "") == name:
                return "used by environment variable"
    return ""


def binding_has_service_account_subject_raw(binding: dict[str, Any], namespace: str, name: str) -> bool:
    for subject in binding.get("subjects") or []:
        if str(subject.get("kind") or "") != "ServiceAccount":
            continue
        if str(subject.get("name") or "") != name:
            continue
        if str(subject.get("namespace") or namespace) == namespace:
            return True
    return False


def role_ref_detail_raw(binding: dict[str, Any]) -> str:
    role_ref = binding.get("roleRef") or {}
    kind = str(role_ref.get("kind") or "")
    name = str(role_ref.get("name") or "")
    return "/".join(part for part in (kind, name) if part)


def subjects_detail_raw(binding: dict[str, Any]) -> str:
    values: list[str] = []
    for subject in binding.get("subjects") or []:
        kind = str(subject.get("kind") or "")
        namespace = str(subject.get("namespace") or "")
        name = str(subject.get("name") or "")
        values.append(f"{kind}/{namespace + '/' if namespace else ''}{name}".strip("/"))
    return ", ".join(values)


def role_ref_links_raw(binding: dict[str, Any], fallback_namespace: str) -> list[dict[str, Any]]:
    role_ref = binding.get("roleRef") or {}
    kind = str(role_ref.get("kind") or "")
    name = str(role_ref.get("name") or "")
    if kind == "Role" and name:
        return [related_link("roles", fallback_namespace, name, "Role", "role reference", "")]
    if kind == "ClusterRole" and name:
        return [related_link("clusterroles", "_cluster", name, "ClusterRole", "role reference", "")]
    return []


def subject_links_raw(binding: dict[str, Any], fallback_namespace: str) -> list[dict[str, Any]]:
    links: list[dict[str, Any]] = []
    for subject in binding.get("subjects") or []:
        kind = str(subject.get("kind") or "")
        name = str(subject.get("name") or "")
        namespace = str(subject.get("namespace") or fallback_namespace)
        if kind == "ServiceAccount" and name:
            links.append(related_link("serviceaccounts", namespace, name, "ServiceAccount", "subject", ""))
    return links
