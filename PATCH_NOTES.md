# KubeDeck 2.0.0-alpha.4.1 — Secrets on Node

## Routes migrated to Node

- `GET /clusters/{cluster_id}/secrets/{namespace}/{name}/keys`
- `POST /clusters/{cluster_id}/secrets/{namespace}/{name}/reveal`
- `POST /clusters/{cluster_id}/secrets/{namespace}/{name}/copy`

## Included

- Secret loading through the Node kubectl runtime.
- Key metadata without returning encoded or decoded values.
- Strict Base64 validation compatible with the previous Python implementation.
- UTF-8 reveal with binary-payload detection.
- 2 MiB decoded-value safety limit.
- Existing reveal timeout from KubeDeck settings.
- Audit events for reveal and copy without Secret values.
- Generic unexpected-error logging that cannot include Secret values.
- Contract tests for keys, reveal, copy, invalid Base64, missing keys, oversized values, validation and kubectl errors.

## Ownership after the patch

- Node: 27 existing routes.
- Python: 22 existing routes.

The renderer, auto-hide behavior and clipboard integration are unchanged.
