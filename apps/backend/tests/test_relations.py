from kubedeck_backend.api.relations import (
    endpoint_slice_address_links,
    endpoint_slice_service_name,
    owner_reference_links_for_pod,
    pod_reference_links,
    service_account_secret_links,
)


def test_pod_reference_links_include_env_sources_and_image_pull_secrets():
    pod = {
        "spec": {
            "imagePullSecrets": [{"name": "registry-creds"}],
            "volumes": [
                {"name": "settings", "configMap": {"name": "app-config"}},
                {"name": "tls", "secret": {"secretName": "app-tls"}},
                {"name": "data", "persistentVolumeClaim": {"claimName": "app-data"}},
            ],
            "containers": [{
                "name": "app",
                "envFrom": [{"configMapRef": {"name": "env-config"}}, {"secretRef": {"name": "env-secret"}}],
                "env": [
                    {"name": "MODE", "valueFrom": {"configMapKeyRef": {"name": "mode-config", "key": "mode"}}},
                    {"name": "PASSWORD", "valueFrom": {"secretKeyRef": {"name": "db-secret", "key": "password"}}},
                ],
            }],
        }
    }

    links = pod_reference_links(pod, "default")
    keys = {(link["resource"], link["name"], link["relation"]) for link in links}

    assert ("secrets", "registry-creds", "imagePull secret") in keys
    assert ("configmaps", "app-config", "mounted config") in keys
    assert ("secrets", "app-tls", "mounted secret") in keys
    assert ("persistentvolumeclaims", "app-data", "mounted volume") in keys
    assert ("configmaps", "env-config", "envFrom config") in keys
    assert ("secrets", "env-secret", "envFrom secret") in keys
    assert ("configmaps", "mode-config", "env key config") in keys
    assert ("secrets", "db-secret", "env key secret") in keys


def test_owner_reference_links_for_pod_adds_parent_deployment_from_replicaset():
    pod = {"metadata": {"ownerReferences": [{"kind": "ReplicaSet", "name": "web-6d9f"}]}}

    def safe_load(resource: str, namespace: str):
        assert namespace == "default"
        if resource == "replicasets":
            return [{"metadata": {"name": "web-6d9f", "ownerReferences": [{"kind": "Deployment", "name": "web"}]}}]
        return []

    links = owner_reference_links_for_pod(pod, "default", safe_load)

    assert links == [{
        "key": "deployments:default:web:controls pod via ReplicaSet",
        "resource": "deployments",
        "namespace": "default",
        "name": "web",
        "kind": "Deployment",
        "relation": "controls pod via ReplicaSet",
        "detail": "web-6d9f",
    }]


def test_service_account_secret_links_include_token_and_image_pull_secret():
    service_account = {
        "secrets": [{"name": "default-token"}],
        "imagePullSecrets": [{"name": "registry-creds"}],
    }

    links = service_account_secret_links(service_account, "default")
    keys = {(link["resource"], link["name"], link["relation"]) for link in links}

    assert ("secrets", "default-token", "service account token/secret") in keys
    assert ("secrets", "registry-creds", "service account imagePullSecret") in keys


def test_endpoint_slice_helpers_link_service_and_target_pods():
    endpoint_slice = {
        "metadata": {"labels": {"kubernetes.io/service-name": "web"}},
        "endpoints": [{"addresses": ["10.0.0.10"], "targetRef": {"kind": "Pod", "namespace": "default", "name": "web-abc"}}],
    }

    assert endpoint_slice_service_name(endpoint_slice) == "web"
    links = endpoint_slice_address_links(endpoint_slice, "default")

    assert links == [{
        "key": "pods:default:web-abc:endpoint slice target",
        "resource": "pods",
        "namespace": "default",
        "name": "web-abc",
        "kind": "Pod",
        "relation": "endpoint slice target",
        "detail": "10.0.0.10",
    }]
