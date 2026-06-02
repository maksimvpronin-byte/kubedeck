# Security Notes

## Local backend exposure

- Backend binds only to `127.0.0.1`.
- Electron generates a random `KUBEDECK_SESSION_TOKEN` for every desktop session and passes it to the Python backend through the environment.
- Renderer HTTP calls must include the token as `X-KubeDeck-Token`.
- Terminal WebSocket calls pass the token as a query parameter.
- Only `/health` is intentionally public.
- Standalone backend runs without a token are locked unless `KUBEDECK_ALLOW_UNAUTHENTICATED=1` is set explicitly for development.

## Local data

- Imported kubeconfigs are copied into `%APPDATA%\KubeDeck\kubeconfigs\`.
- Kubeconfig content is not logged.
- Logs are written under `%APPDATA%\KubeDeck\logs\`.
- Kubernetes resource data is not persisted to disk.
- The backend resource cache foundation is in-memory only.
- Secret reveal/copy audit records include metadata only and do not store decoded secret values.

## Redaction

Log and command-preview redaction removes or masks common sensitive markers such as:

- token;
- password;
- secret;
- client key;
- kubeconfig path in visible command previews.

## Mutating operations

Mutating operations use backend-side confirmation metadata and command previews. Current 1.0.3 UI intentionally does not require manual typed resource-name entry for the common workflows:

- delete uses a standard confirmation dialog;
- restart uses a confirmation dialog without typing the pod name;
- redeploy uses a confirmation dialog without typing the deployment name;
- scale uses a confirmation dialog without typing the deployment name, but replicas are required;
- YAML apply uses a confirmation dialog without typing the object name;
- interactive Terminal tab sessions do not require typed pod-name confirmation.

Backend confirmation metadata is still sent for mutating operations. Backend-side guards still include payload-size limits, YAML single-object validation, operation metadata checks and `kubectl auth can-i` checks where implemented.

Relevant mutating endpoints include:

- `PUT /clusters/{cluster_id}/yaml/apply`
- `POST /clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/action`
- `POST /clusters/{cluster_id}/pods/{namespace}/{name}/exec`

YAML apply is intentionally limited to one Kubernetes object per request. The backend parses the YAML payload, extracts `kind`, `metadata.namespace`, and `metadata.name`, and validates the target before running `kubectl apply -f -`.

## Process hardening

KubeDeck does not stop arbitrary `external:<pid>` port-forward processes. External port-forwards are shown as read-only. Managed port-forward cleanup validates that the target process is actually a `kubectl port-forward` process with a kubeconfig argument.

The desktop process stores backend process metadata as JSON in `%APPDATA%\KubeDeck\backend.pid` and validates the process command line before using `taskkill`.

## Packaging hardening

Current packaging verifies that npm build tools already exist and does not automatically repair `node_modules`. Backend packaging dependencies are installed into an isolated build venv.

Portable packaging does not include `kubectl.exe` and no longer performs bundled-kubectl SHA256 enforcement. Runtime Kubernetes access relies on the configured kubectl path or PATH-based kubectl resolution.
