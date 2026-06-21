# KubeDeck 2.0.0-alpha.3.1 — Resource details on Node

This patch moves five read-only resource-detail routes from Python to the Node Gateway.

## Routes migrated to Node

- `GET /clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/yaml`
- `GET /clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/describe`
- `GET /clusters/{cluster_id}/pods/{namespace}/{name}/yaml`
- `GET /clusters/{cluster_id}/pods/{namespace}/{name}/describe`
- `GET /clusters/{cluster_id}/pods/{namespace}/{name}/logs`

## Preserved behavior

- Namespaced and cluster-scoped resources through `_cluster`.
- Bounded log output with `tail`, `all`, `container`, `previous`, and `timestamps`.
- HTTP follow-mode rejection; streaming remains on the existing WebSocket path.
- Identifier validation and the current `ErrorInfo` response envelope.
- Existing kubectl timeouts and output-size limits.

## Ownership after the patch

- Node: 18 existing routes.
- Python: 31 existing routes.

Python/FastAPI remains packaged during the hybrid migration.
