# KubeDeck 2.0.0-alpha.4.3 — Pod Exec on Node

## Route migrated to Node

- `POST /clusters/{cluster_id}/pods/{namespace}/{name}/exec`

## Included

- Native Node handling through the existing `KubectlRunner`.
- `kubectl auth can-i create pods/exec` before execution.
- Shell allowlist: `sh`, `bash`, `ash`.
- Optional container selection.
- Existing typed-name operation confirmation.
- 4000-character command limit.
- 60-second execution timeout.
- 16 MiB combined output limit.
- Active kubectl processes remain governed by the Node runtime shutdown path.
- Audit events contain execution metadata but do not contain stdout or stderr.
- Existing `ErrorInfo` response envelope.
- Contract tests for route matching, command construction, confirmation,
  authorization denial, invalid input, successful execution and kubectl failure.

## Ownership after the patch

- Node: 29 existing routes.
- Python: 20 existing routes.

The interactive Pod terminal WebSocket remains on Python for the next migration stage.
