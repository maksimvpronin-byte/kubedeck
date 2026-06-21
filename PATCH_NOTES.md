# KubeDeck 2.0.0-alpha.3.2 — Resource discovery and events on Node

## Routes migrated to Node

- `GET /clusters/{cluster_id}/resource-definitions`
- `GET /clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/events`

## Included

- `kubectl api-resources --verbs=list -o wide` parsing.
- In-memory resource-definition cache with a 60-second TTL.
- Namespaced and cluster-scoped event loading.
- Event filtering by target UID with name/kind/namespace fallback.
- Reverse chronological event sorting.
- Compatibility with both `involvedObject` and `regarding`.
- Existing KubeDeck `ErrorInfo` envelope.
- Contract tests for parsing, caching, filtering, sorting and HTTP responses.
- Existing Gateway contract assertions updated to the Alpha 3.2 ownership count.
- `test:gateway` now runs all current Node backend contract files.

## Ownership after the patch

- Node: 20 existing routes.
- Python: 29 existing routes.

No renderer or Python business logic is removed in this patch.
