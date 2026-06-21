# KubeDeck 2.0.0-alpha.2.1 — Node cluster management

This patch migrates four existing cluster-management contracts from Python to the Node Gateway:

- `GET /clusters`
- `POST /clusters/import`
- `PATCH /clusters/{cluster_id}`
- `DELETE /clusters/{cluster_id}`

## Resulting ownership

- Node: 9 existing routes
- Python: 40 existing routes

The following cluster routes intentionally remain on Python until the Node kubectl runtime is introduced:

- `POST /clusters/last/open`
- `POST /clusters/{cluster_id}/open`
- `GET /clusters/{cluster_id}/namespaces`

## Compatibility and safety

- Imported kubeconfigs are copied into `%APPDATA%\KubeDeck\kubeconfigs\<uuid>.yaml`.
- Cluster rename preserves the existing name when the submitted name is blank.
- Cluster removal deletes only kubeconfigs located inside KubeDeck's managed kubeconfig directory.
- External/user-owned kubeconfig files are never deleted.
- Deletion triggers best-effort cleanup of the legacy Python resource cache.
- Python config caching now observes `config.json` modification time, so Node-written config changes are visible immediately to Python routes that still remain during migration.
- Cluster import, rename, remove, and failure paths are written to the existing audit log.

No new npm dependencies are added.
