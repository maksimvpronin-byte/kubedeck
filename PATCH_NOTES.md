# KubeDeck 2.0.0-alpha.5 — Node resource lists and snapshot cache

> Архив patch notes промежуточного этапа миграции. Текущий runtime полностью Node-only.

## Routes migrated to Node

- `GET /clusters/{cluster_id}/resources/{resource}`
- `GET /resource-cache/status`
- `POST /resource-cache/clear`

## Included

- Native Node resource-list loading through `KubectlRunner`.
- Namespaced, all-namespaces and cluster-scoped modes.
- KubeDeck-compatible row normalizers for Pods, Deployments, Services,
  Ingresses, Events, Nodes, CRDs, ServiceAccounts and RBAC resources.
- Generic fallback for standard resources and CRD instances.
- Pod CPU and memory usage from `kubectl top pods`.
- Namespace CPU/RAM usage and ResourceQuota limits.
- 15-second in-memory snapshot cache.
- Cache status and manual clear endpoints, including discovery cache clearing.
- Node cache invalidation after YAML apply and resource actions.
- Cluster-specific cache clearing when a cluster is removed.
- Cached reads verify Kubernetes API readiness before returning rows.
- Cache is cleared when kubectl reports cluster/API failure, so stale rows are
  not returned after the cluster becomes unavailable.
- Contract tests for normalizers, metrics parsing, TTL, cache clearing,
  resource loading and unavailable-cluster behavior.

## Ownership after the patch

- Node: 32 existing routes.
- Python: 17 existing routes.

Python watch sessions are retained for now. Their migration will be handled in
the following live-refresh stage.
