# KubeDeck 2.0.0-alpha.3 — Node kubectl runtime

This patch introduces the first native Node kubectl execution layer.

## Routes migrated to Node

- `GET /kubectl/status`
- `POST /clusters/last/open`
- `POST /clusters/{cluster_id}/open`
- `GET /clusters/{cluster_id}/namespaces`

## Runtime behavior

- Starts kubectl with `spawn()` and `shell: false`.
- Uses the kubectl path stored in KubeDeck settings.
- Adds the selected cluster kubeconfig.
- Applies process and Kubernetes request timeouts.
- Limits captured stdout/stderr size.
- Parses JSON responses.
- Returns the existing KubeDeck `ErrorInfo` envelope.
- Terminates active kubectl processes when the Node Gateway stops.
- Preserves HTTP and WebSocket proxying for routes still owned by Python.

## Ownership after the patch

- Node: 13 existing routes.
- Python: 36 existing routes.

Python/FastAPI remains packaged during the hybrid migration.
