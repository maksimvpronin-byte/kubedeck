# KubeDeck 2.0.0-alpha.4.2 — Resource actions on Node

## Route migrated to Node

- `POST /clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/action`

## Supported actions

- delete
- restart / redeploy
- scale
- cordon
- uncordon
- drain

## Included

- Existing confirmation metadata validation.
- Typed resource-name confirmation for restart, redeploy and scale.
- `kubectl auth can-i` checks before destructive operations.
- Node operations with a 300-second Kubernetes drain timeout and a 330-second process timeout.
- Existing plain-text success response and `ErrorInfo` failure envelope.
- Success/failure audit events without resource payloads.
- Best-effort legacy resource-cache invalidation after successful actions.
- Contract tests for route matching, command construction, confirmation, RBAC denial, failure audit and drain.

## Ownership after the patch

- Node: 28 existing routes.
- Python: 21 existing routes.

Pod exec and WebSocket terminal remain on Python in this release.
