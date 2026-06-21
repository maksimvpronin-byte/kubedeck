# KubeDeck 2.0.0-alpha.4 — YAML dry-run and apply on Node

## Routes migrated to Node

- `POST /clusters/{cluster_id}/yaml/dry-run`
- `PUT /clusters/{cluster_id}/yaml/apply`

## Included

- YAML is passed to `kubectl` through standard input; no temporary YAML files are created.
- Server-side dry-run uses `kubectl apply --dry-run=server -f - -o yaml`.
- Apply uses `kubectl apply -f -`.
- Apply remains limited to one Kubernetes object per request.
- Existing typed-name confirmation semantics are preserved.
- YAML payload size is limited to 5 MiB.
- kubectl timeout and output-size limits remain enforced.
- YAML and Secret contents are never added to desktop logs or audit records.
- Successful apply asks the remaining Python backend to invalidate its resource cache.
- Success and failure audit events are retained.
- Node kubectl runtime now supports bounded stdin input.
- Contract tests cover parsing, confirmation, stdin transport, dry-run, apply and failures.

## Dependency

- Adds the runtime dependency `yaml@2.8.4` to the desktop workspace.

## Ownership after the patch

- Node: 24 existing routes.
- Python: 25 existing routes.

Python/FastAPI is still packaged because the remaining routes continue to use it.
