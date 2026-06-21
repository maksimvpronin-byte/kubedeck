# KubeDeck 2.0.0-alpha.3.3 — Deployment logs on Node

## Routes migrated to Node

- `GET /clusters/{cluster_id}/deployments/{namespace}/{name}/log-targets`
- `GET /clusters/{cluster_id}/deployments/{namespace}/{name}/logs`

## Included

- Deployment selector evaluation with `matchLabels` and `matchExpressions`.
- Pod discovery and deterministic sorting by creation time and name.
- Target response containing Pod names, phases and container lists.
- Combined logs across all Pods belonging to a Deployment.
- Query compatibility for `tail`, `all`, `previous`, `timestamps`, `container` and `pod`.
- Optional `prefix` query support, defaulting to the existing `--prefix=true` behavior.
- Automatic `--all-containers=true` for multi-container Pods when no container is selected.
- Maximum four concurrent `kubectl logs` processes.
- Partial combined output when one Pod log request fails.
- Existing KubeDeck `ErrorInfo` response envelope.
- Contract tests for selectors, targets, command generation, concurrency, partial failures and HTTP responses.

## Ownership after the patch

- Node: 22 existing routes.
- Python: 27 existing routes.

No renderer changes or new npm dependencies are included.
