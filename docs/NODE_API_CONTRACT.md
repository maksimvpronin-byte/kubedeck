# KubeDeck 2.0 — Node API Contract

**Status:** baseline contract for migration  
**Source branch:** `dev/2.0.0`  
**Snapshot date:** 2026-06-21  
**Current implementation:** Python 3 + FastAPI  
**Target implementation:** Node.js + TypeScript inside Electron main process  
**Scope:** preserve the observable REST and WebSocket behavior while the implementation is replaced.

---

## 1. Purpose

This document freezes the current backend boundary used by the renderer.

The Node implementation must preserve:

- HTTP methods and paths;
- path and query parameter names;
- request bodies;
- response media types;
- response field names and nullability;
- HTTP status codes;
- `ErrorInfo` payloads;
- WebSocket URLs, authentication and messages;
- confirmation and authorization checks;
- cleanup semantics for long-running processes.

The current branch exposes **49 route contracts**:

- **46 HTTP routes**
- **3 WebSocket routes**

The contract is derived from:

```text
apps/backend/kubedeck_backend/main.py
apps/backend/kubedeck_backend/security.py
apps/backend/kubedeck_backend/core/models.py
apps/backend/kubedeck_backend/api/routes.py
apps/backend/kubedeck_backend/api/routes_*.py
apps/backend/kubedeck_backend/api/terminal.py
apps/desktop/src/renderer/api.ts
apps/desktop/src/renderer/types.ts
```

---

## 2. Transport baseline

### 2.1 Binding

Current backend:

```text
host: 127.0.0.1
transport: HTTP + WebSocket
```

The Node Gateway must remain loopback-only.

### 2.2 HTTP authentication

All HTTP routes except `GET /health` require:

```http
X-KubeDeck-Token: <session-token>
```

Missing or invalid token:

```json
{
  "detail": {
    "code": "UNAUTHORIZED",
    "message": "KubeDeck session token is missing or invalid",
    "rawStderr": "",
    "commandPreview": ""
  }
}
```

Expected status:

```text
401 Unauthorized
```

### 2.3 WebSocket authentication

WebSocket routes accept the session token through the query string:

```text
?token=<session-token>
```

The implementation also supports resolving the token from the WebSocket headers.

Invalid token, invalid origin or invalid route identifiers cause close code:

```text
1008 Policy Violation
```

### 2.4 Allowed origins

The existing desktop runtime accepts the Electron/file context and local Vite development origins:

```text
http://localhost:5173
http://127.0.0.1:5173
file://
null
```

The Node implementation must not broaden this list without a separate security decision.

### 2.5 Default media types

| Response kind | Media type |
|---|---|
| Normal objects | `application/json` |
| YAML, describe, logs, dry-run/apply output | `text/plain` |
| WebSocket events | UTF-8 JSON text frames |

---

## 3. Common schemas

### 3.1 ErrorInfo

```ts
interface ErrorInfo {
  code: string;
  message: string;
  rawStderr: string;
  commandPreview: string;
}
```

Normal backend failures use:

```json
{
  "detail": {
    "code": "KUBECTL_COMMAND_FAILED",
    "message": "Human-readable message",
    "rawStderr": "Original or sanitized stderr",
    "commandPreview": "kubectl ..."
  }
}
```

The renderer currently accepts:

- `detail: ErrorInfo`;
- `detail: string`;
- otherwise it produces a fallback `HTTP_ERROR`.

### 3.2 FastAPI validation compatibility

Invalid request models or query constraints can currently return FastAPI's standard `422` response:

```json
{
  "detail": [
    {
      "type": "...",
      "loc": ["body", "field"],
      "msg": "...",
      "input": "..."
    }
  ]
}
```

This is not the same shape as `ErrorInfo`.

**Migration decision:** Alpha 1 contract tests must record the actual renderer behavior before deciding whether Node should preserve `422` exactly or normalize it to `ErrorInfo`.

### 3.3 Cluster

```ts
interface Cluster {
  id: string;
  displayName: string;
  kubeconfigPath: string;
  lastOpened: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### 3.4 Settings

```ts
type Language = "ru" | "en";
type Theme = "dark" | "light" | "system";

interface Settings {
  kubectlPath: string;
  language: Language;
  theme: Theme;
  refreshIntervalSeconds: number;
  logsTailLines: number;
  secretRevealTimeoutSeconds: number;
  restartProblemThreshold: number;
  terminalFontSize: number;
  logsSince: string;
  llm: LlmSettings;
  ssh: SshSettings;
}
```

### 3.5 AppConfig

```ts
interface AppConfig {
  clusters: Cluster[];
  settings: Settings;
}
```

### 3.6 CommandResult

```ts
interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  commandPreview: string;
  returnCode: number | null;
}
```

### 3.7 ResourceRow

```ts
interface ResourceRow {
  uid: string;
  name: string;
  namespace?: string;
  createdAt?: string;
  [key: string]: unknown;
}
```

Resource-specific columns remain open-ended. The Node normalizers must preserve field names and primitive types for every currently supported Kubernetes kind.

### 3.8 OperationConfirmation

```ts
interface OperationConfirmation {
  clusterId: string;
  action: string;
  typedName: string;
  namespace?: string | null;
  resource?: string | null;
  name?: string | null;
  commandPreviewHash?: string | null;
}
```

### 3.9 ResourceActionRequest

```ts
interface ResourceActionRequest {
  action: string;
  replicas?: number | null;
  confirmation?: OperationConfirmation | null;
}
```

### 3.10 LLM settings

```ts
interface LlmSettings {
  enabled: boolean;
  provider: "openai_compatible";
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  timeoutSeconds: number;
  maxContextChars: number;
  maxOutputTokens: number;
}
```

### 3.11 SSH settings

```ts
type SshAuthMethod = "agent" | "password" | "privateKey";

interface SshSettings {
  defaultUsername: string;
  defaultPort: number;
  defaultAuthMethod: SshAuthMethod;
  useJumpHost: boolean;
  jumpHost: string;
  jumpPort: number;
  jumpUsername: string;
  jumpAuthMethod: SshAuthMethod;
}
```

---

## 4. Route inventory

| # | Method | Path | Media | Current source |
|---:|---|---|---|---|
| 1 | GET | `/health` | JSON | `routes_core.py` |
| 2 | GET | `/app/info` | JSON | `routes_core.py` |
| 3 | GET | `/config` | JSON | `routes_core.py` |
| 4 | PUT | `/settings` | JSON | `routes_core.py` |
| 5 | GET | `/resource-cache/status` | JSON | `routes_core.py` |
| 6 | POST | `/resource-cache/clear` | JSON | `routes_core.py` |
| 7 | GET | `/kubectl/status` | JSON | `routes_core.py` |
| 8 | GET | `/clusters` | JSON | `routes_clusters.py` |
| 9 | POST | `/clusters/import` | JSON | `routes_clusters.py` |
| 10 | PATCH | `/clusters/{cluster_id}` | JSON | `routes_clusters.py` |
| 11 | DELETE | `/clusters/{cluster_id}` | JSON | `routes_clusters.py` |
| 12 | POST | `/clusters/last/open` | JSON | `routes_clusters.py` |
| 13 | POST | `/clusters/{cluster_id}/open` | JSON | `routes_clusters.py` |
| 14 | GET | `/clusters/{cluster_id}/namespaces` | JSON | `routes_clusters.py` |
| 15 | GET | `/audit` | JSON | `routes_audit.py` |
| 16 | GET | `/llm/status` | JSON | `routes_llm.py` |
| 17 | POST | `/llm/test` | JSON | `routes_llm.py` |
| 18 | POST | `/llm/preview-resource-prompt` | JSON | `routes_llm.py` |
| 19 | POST | `/llm/analyze-resource` | JSON | `routes_llm.py` |
| 20 | GET | `/clusters/{cluster_id}/problems` | JSON | `routes_problems.py` |
| 21 | GET | `/clusters/{cluster_id}/search` | JSON | `routes_search.py` |
| 22 | POST | `/clusters/{cluster_id}/yaml/dry-run` | text | `routes_yaml.py` |
| 23 | PUT | `/clusters/{cluster_id}/yaml/apply` | text | `routes_yaml.py` |
| 24 | GET | `/clusters/{cluster_id}/resources/{resource}` | JSON | `routes_resources.py` |
| 25 | GET | `/clusters/{cluster_id}/secrets/{namespace}/{name}/keys` | JSON | `routes_resources.py` |
| 26 | POST | `/clusters/{cluster_id}/secrets/{namespace}/{name}/reveal` | JSON | `routes_resources.py` |
| 27 | POST | `/clusters/{cluster_id}/secrets/{namespace}/{name}/copy` | JSON | `routes_resources.py` |
| 28 | GET | `/clusters/{cluster_id}/deployments/{namespace}/{name}/log-targets` | JSON | `routes_resources.py` |
| 29 | GET | `/clusters/{cluster_id}/deployments/{namespace}/{name}/logs` | text | `routes_resources.py` |
| 30 | GET | `/clusters/{cluster_id}/resource-definitions` | JSON | `routes_resources.py` |
| 31 | GET | `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/yaml` | text | `routes_resources.py` |
| 32 | GET | `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/describe` | text | `routes_resources.py` |
| 33 | GET | `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/events` | JSON | `routes_resources.py` |
| 34 | GET | `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/related` | JSON | `routes_resources.py` |
| 35 | POST | `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/action` | text | `routes_resources.py` |
| 36 | GET | `/clusters/{cluster_id}/pods/{namespace}/{name}/yaml` | text | `routes_pods.py` |
| 37 | GET | `/clusters/{cluster_id}/pods/{namespace}/{name}/describe` | text | `routes_pods.py` |
| 38 | GET | `/clusters/{cluster_id}/pods/{namespace}/{name}/logs` | text | `routes_pods.py` |
| 39 | POST | `/clusters/{cluster_id}/pods/{namespace}/{name}/exec` | JSON | `routes_pods.py` |
| 40 | WS | `/clusters/{cluster_id}/pods/{namespace}/{name}/terminal` | WS JSON | `routes_pods.py`, `terminal.py` |
| 41 | GET | `/port-forwards` | JSON | `routes_port_forward.py` |
| 42 | POST | `/clusters/{cluster_id}/port-forwards` | JSON | `routes_port_forward.py` |
| 43 | DELETE | `/port-forwards/{session_id}` | JSON | `routes_port_forward.py` |
| 44 | GET | `/watches/status` | JSON | `routes_watch.py` |
| 45 | POST | `/clusters/{cluster_id}/watches` | JSON | `routes_watch.py` |
| 46 | DELETE | `/watches/{watch_id}` | JSON | `routes_watch.py` |
| 47 | POST | `/watches/stop-all` | JSON | `routes_watch.py` |
| 48 | WS | `/clusters/{cluster_id}/resources/{resource}/watch-events` | WS JSON | `routes_watch.py` |
| 49 | WS | `/clusters/{cluster_id}/nodes/{name}/ssh` | WS JSON | `routes_node_ssh.py` |

---

## 5. Core and configuration routes

### 5.1 GET `/health`

Authentication: **public**

Response:

```json
{
  "ok": true,
  "service": "kubedeck-backend"
}
```

Node compatibility rule:

- keep `ok`;
- keep `service` during the compatibility period;
- any renamed Node service field must be additive, not a replacement.

---

### 5.2 GET `/app/info`

Response shape:

```ts
interface BackendInfo {
  service: string;
  backendVersion: string;
  pythonVersion: string;
  platform: string;
  processId: number;
  paths: Record<string, string>;
  settings: {
    kubectlPath: string;
    refreshIntervalSeconds: number;
    logsTailLines: number;
    language: string;
    theme: string;
    llm?: LlmStatus;
    ssh?: SshSettings;
  };
  clusters: number;
}
```

Migration note:

- `pythonVersion` is Python-specific;
- during Alpha, preserve it as `""` or make it optional only after renderer compatibility is shipped;
- add `nodeVersion` as an additive field;
- do not silently remove the existing field.

---

### 5.3 GET `/config`

Response:

```ts
AppConfig
```

This route is the authoritative persisted settings and cluster-list contract.

---

### 5.4 PUT `/settings`

Request:

```json
{
  "settings": {
    "...": "complete Settings object"
  }
}
```

Response:

```ts
AppConfig
```

Known error:

```text
400 INVALID_SETTINGS
```

Compatibility requirement:

- preserve unknown-value normalization currently performed by Python;
- preserve existing `%APPDATA%\KubeDeck\config.json`;
- do not rewrite valid user settings into incompatible values.

---

### 5.5 GET `/resource-cache/status`

Response:

```ts
interface ResourceCacheStatus {
  enabled: boolean;
  mode: string;
  entries: number;
  items: Array<{
    clusterId: string;
    resource: string;
    namespace: string;
    items?: number;
    rawCount?: number;
    ageSeconds: number;
    ttlSeconds: number;
    hits: number;
  }>;
  resourcePollingEnabled?: boolean;
  discoveryCacheEnabled?: boolean;
  resourceListCacheEnabled?: boolean;
  resourceListTtlSeconds?: number;
  note?: string;
}
```

---

### 5.6 POST `/resource-cache/clear`

Query:

```text
cluster_id?: string
```

Response:

```json
{
  "cleared": 12
}
```

`cluster_id` limits invalidation to one cluster when supplied.

---

### 5.7 GET `/kubectl/status`

Response:

```json
{
  "ok": true,
  "version": "kubectl version text",
  "commandPreview": "kubectl version --client ..."
}
```

Errors use `ErrorInfo`.

---

## 6. Cluster routes

### 6.1 GET `/clusters`

Response:

```json
{
  "clusters": []
}
```

Each element is `Cluster`.

Note: this backend route exists even though the current `ApiClient` normally receives clusters through `/config`.

---

### 6.2 POST `/clusters/import`

Request:

```json
{
  "sourcePath": "C:\\path\\to\\config",
  "displayName": "Optional name"
}
```

Response:

```ts
Cluster
```

Known error:

```text
400 IMPORT_FAILED
```

The imported kubeconfig is copied into the KubeDeck application-data area.

---

### 6.3 PATCH `/clusters/{cluster_id}`

Request:

```json
{
  "displayName": "New display name"
}
```

Response:

```ts
Cluster
```

Known error:

```text
404 CLUSTER_NOT_FOUND
```

---

### 6.4 DELETE `/clusters/{cluster_id}`

Response:

```json
{
  "ok": true
}
```

Known error:

```text
404 CLUSTER_NOT_FOUND
```

---

### 6.5 POST `/clusters/last/open`

Response when no previous cluster exists:

```json
{
  "cluster": null
}
```

Response when a cluster exists:

```json
{
  "cluster": {},
  "namespaces": []
}
```

The non-null shape must match `POST /clusters/{cluster_id}/open`.

---

### 6.6 POST `/clusters/{cluster_id}/open`

Response:

```json
{
  "cluster": {},
  "namespaces": [
    {
      "metadata": {
        "name": "default"
      }
    }
  ]
}
```

`namespaces` contains raw Kubernetes namespace objects, not normalized `ResourceRow` objects.

Known errors:

```text
404 CLUSTER_NOT_FOUND
400 CLUSTER_UNAVAILABLE
kubectl ErrorInfo codes
```

---

### 6.7 GET `/clusters/{cluster_id}/namespaces`

Response:

```json
{
  "items": [
    {
      "metadata": {
        "name": "default"
      }
    }
  ]
}
```

Items are raw Kubernetes namespace objects.

---

## 7. Audit route

### 7.1 GET `/audit`

Query:

```text
limit: integer = 200
range: 1..1000
```

Response:

```ts
interface AuditResponse {
  items: AuditEvent[];
  limit: number;
}

interface AuditEvent {
  timestamp: string;
  action: string;
  status: string;
  clusterId?: string;
  namespace?: string;
  resource?: string;
  name?: string;
  commandPreview?: string;
  message?: string;
  extra?: Record<string, unknown>;
}
```

---

## 8. LLM routes

All LLM routes use prefix:

```text
/llm
```

### 8.1 GET `/llm/status`

Response:

```json
{
  "enabled": true,
  "configured": true,
  "provider": "openai_compatible",
  "baseUrl": "http://localhost:1234/v1",
  "model": "model-name"
}
```

No API key is returned.

---

### 8.2 POST `/llm/test`

Request:

```json
{
  "settings": {}
}
```

`settings` is optional; when omitted, persisted settings are used.

Success response:

```json
{
  "ok": true,
  "message": "Connection successful",
  "model": "model-name",
  "elapsedMs": 123,
  "status": 200
}
```

Connection/test failure is intentionally returned as HTTP `200`:

```json
{
  "ok": false,
  "code": "LLM_ERROR_CODE",
  "message": "Failure message",
  "status": 500
}
```

Node must preserve this unusual success-status behavior until a separate contract migration is approved.

---

### 8.3 POST `/llm/preview-resource-prompt`

Request:

```ts
interface LlmAnalyzeResourceRequest {
  clusterId: string;
  resource: string;
  kind?: string | null;
  namespace?: string | null;
  name: string;
  resourceObject?: Record<string, unknown> | null;
  yaml?: string | null;
  events?: Array<Record<string, unknown>>;
  describe?: string | null;
  logs?: string | null;
  previousLogs?: string | null;
  relatedResources?: Array<Record<string, unknown>>;
  userRequest?: string | null;
  language?: string | null;
}
```

Backend response currently contains:

```json
{
  "messages": [],
  "context": {},
  "contextChars": 1234,
  "truncated": false
}
```

**Known mismatch:** renderer type `LlmPromptPreviewResponse` expects `maxOutputTokens`, while the Python response does not currently add it. Freeze the observed runtime response in a contract test before changing either side.

---

### 8.4 POST `/llm/analyze-resource`

Request:

```ts
LlmAnalyzeResourceRequest
```

Response:

```ts
interface LlmAnalyzeResourceResponse {
  answer: string;
  model: string;
  elapsedMs: number;
  contextChars: number;
  truncated: boolean;
  maxOutputTokens: number;
}
```

Known failures:

```text
400 with LLM ErrorInfo
```

Security requirements:

- mask Kubernetes Secrets;
- do not log complete prompts or secret values;
- preserve the current context-size limits;
- preserve handling of `reasoning_content` versus final content.

---

## 9. Problems and search

### 9.1 GET `/clusters/{cluster_id}/problems`

Response:

```ts
interface ProblemsResponse {
  items: ResourceRow[];
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    errors: number;
    generatedAt: string;
    sources: Record<string, number>;
    categories?: Record<string, number>;
    kinds?: Record<string, number>;
  };
  errors: Array<ErrorInfo & {
    resource?: string;
    namespace?: string;
  }>;
}
```

Partial source failures are returned inside `errors` while successful problem rows remain available.

---

### 9.2 GET `/clusters/{cluster_id}/search`

Query:

```text
q: string, minimum 2 characters
namespace: string = "all"
limit: integer = 200, range 1..500
includeCrdInstances: boolean = true
```

Response:

```ts
interface GlobalSearchResponse {
  items: Array<ResourceRow & {
    resource: string;
    kind: string;
    namespace?: string;
    score: number;
    matchedFields: string[];
    source: "global-search";
    title?: string;
    subtitle?: string;
    crdInstance?: boolean;
  }>;
  summary: {
    query: string;
    total: number;
    sources: Record<string, number>;
    errors: number;
    limited: boolean;
    generatedAt: string;
  };
  errors: Array<ErrorInfo & {
    resource?: string;
    namespace?: string;
  }>;
}
```

---

## 10. YAML routes

### 10.1 POST `/clusters/{cluster_id}/yaml/dry-run`

Request:

```json
{
  "yaml": "apiVersion: ..."
}
```

Response:

```text
text/plain
```

The payload is size-limited.

Known errors include:

```text
INVALID_YAML
EMPTY_YAML
MULTI_DOCUMENT_APPLY_BLOCKED
INVALID_YAML_OBJECT
INVALID_YAML_METADATA
INVALID_YAML_KIND
OUTPUT_TOO_LARGE
kubectl ErrorInfo codes
```

---

### 10.2 PUT `/clusters/{cluster_id}/yaml/apply`

Request:

```json
{
  "yaml": "apiVersion: ...",
  "confirmation": {
    "clusterId": "...",
    "action": "apply",
    "typedName": "...",
    "namespace": "...",
    "resource": "...",
    "name": "...",
    "commandPreviewHash": "..."
  }
}
```

Response:

```text
text/plain
```

Current contract allows only a single Kubernetes object per apply payload.

Required behavior:

- validate YAML before running kubectl;
- require operation confirmation;
- preserve command-preview/hash checking;
- invalidate relevant caches after success;
- append audit event.

---

## 11. Resource routes

### 11.1 GET `/clusters/{cluster_id}/resources/{resource}`

Query:

```text
namespace: string = "all"
useCache: boolean = false
forceRefresh: boolean = false
```

Uncached response:

```json
{
  "items": [],
  "rawCount": 0,
  "cached": false
}
```

Cached responses may additionally contain:

```json
{
  "cached": true,
  "cacheTtlSeconds": 10
}
```

`items` are normalized `ResourceRow` objects.

Compatibility requirement:

- preserve exact normalizer fields per resource kind;
- preserve `rawCount`;
- preserve cache flags and TTL field type;
- preserve namespace handling for cluster-scoped resources.

---

### 11.2 GET `/clusters/{cluster_id}/secrets/{namespace}/{name}/keys`

Response:

```ts
interface SecretKeysResponse {
  type: string;
  immutable: boolean;
  namespace: string;
  name: string;
  keys: Array<{
    key: string;
    encodedBytes: number;
    decodedBytes: number;
    validBase64: boolean;
    binary: boolean;
  }>;
  revealTimeoutSeconds: number;
}
```

No decoded value is returned by this route.

---

### 11.3 POST `/clusters/{cluster_id}/secrets/{namespace}/{name}/reveal`

Request:

```json
{
  "key": "secret-key"
}
```

Response:

```ts
interface SecretRevealResponse {
  key: string;
  value: string;
  decodedBytes: number;
  binary: boolean;
  revealTimeoutSeconds: number;
}
```

Security requirements:

- response must never be written to application logs;
- API key/value must not appear in audit `extra`;
- renderer auto-hide behavior depends on `revealTimeoutSeconds`.

---

### 11.4 POST `/clusters/{cluster_id}/secrets/{namespace}/{name}/copy`

Request:

```json
{
  "key": "secret-key"
}
```

Response:

```json
{
  "ok": true
}
```

This route records the audit event. It does not return the secret value.

---

### 11.5 GET `/clusters/{cluster_id}/deployments/{namespace}/{name}/log-targets`

Response:

```ts
interface DeploymentLogTargetsResponse {
  namespace: string;
  name: string;
  pods: Array<{
    name: string;
    phase: string;
    containers: string[];
  }>;
  containers: string[];
}
```

---

### 11.6 GET `/clusters/{cluster_id}/deployments/{namespace}/{name}/logs`

Query:

```text
tail: integer = 500
all: boolean = false
previous: boolean = false
timestamps: boolean = false
container?: string
pod?: string
```

Response:

```text
text/plain
```

The response combines or filters logs according to selected Pods and containers.

---

### 11.7 GET `/clusters/{cluster_id}/resource-definitions`

Response:

```json
{
  "items": [
    {
      "name": "pods",
      "shortNames": "po",
      "apiGroup": "",
      "namespaced": true,
      "kind": "Pod",
      "verbs": "get,list,watch"
    }
  ],
  "cached": false
}
```

---

### 11.8 GET `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/yaml`

Response:

```text
text/plain
```

---

### 11.9 GET `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/describe`

Response:

```text
text/plain
```

---

### 11.10 GET `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/events`

Response:

```ts
interface ResourceEventsResponse {
  items: ResourceRow[];
  rawCount: number;
}
```

---

### 11.11 GET `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/related`

Response:

```ts
interface RelatedResourcesResponse {
  items: Array<{
    key: string;
    resource: string;
    namespace: string;
    name: string;
    kind: string;
    relation: string;
    detail?: string;
  }>;
  sources: Record<string, number>;
  errors: Array<ErrorInfo & {
    resource?: string;
    namespace?: string;
  }>;
}
```

---

### 11.12 POST `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/action`

Request:

```ts
ResourceActionRequest
```

Supported actions:

```text
delete
restart
redeploy
scale
cordon
uncordon
drain
```

Rules:

- `scale` requires `replicas >= 0`;
- scaling is restricted to supported workload resources;
- `cordon`, `uncordon`, `drain` apply to Nodes;
- dangerous actions require confirmation;
- authorization is checked through `kubectl auth can-i`;
- cache invalidation and audit logging occur after actions.

Response:

```text
text/plain
```

Known errors include:

```text
INVALID_ACTION
INVALID_REPLICAS
UNSUPPORTED_ACTION
CONFIRMATION_REQUIRED
CONFIRMATION_MISMATCH
FORBIDDEN
kubectl ErrorInfo codes
```

---

## 12. Pod HTTP routes

### 12.1 GET `/clusters/{cluster_id}/pods/{namespace}/{name}/yaml`

Response:

```text
text/plain
```

---

### 12.2 GET `/clusters/{cluster_id}/pods/{namespace}/{name}/describe`

Response:

```text
text/plain
```

---

### 12.3 GET `/clusters/{cluster_id}/pods/{namespace}/{name}/logs`

Query:

```text
tail: integer = 500
all: boolean = false
follow: boolean = false
previous: boolean = false
timestamps: boolean = false
container?: string
```

Response:

```text
text/plain
```

Special behavior:

- `all=true` uses the full-log limit and `--tail=-1`;
- `follow=true` is rejected because this endpoint remains bounded.

Known error:

```text
400 FOLLOW_LOGS_REQUIRES_STREAM
```

The current renderer implements follow through bounded polling.

---

### 12.4 POST `/clusters/{cluster_id}/pods/{namespace}/{name}/exec`

Request:

```json
{
  "command": "whoami",
  "container": "optional-container",
  "shell": "sh",
  "confirmation": {}
}
```

Allowed shells:

```text
sh
bash
ash
```

Response:

```ts
CommandResult
```

Known errors:

```text
EMPTY_COMMAND
COMMAND_TOO_LONG
INVALID_SHELL
CONFIRMATION_REQUIRED
FORBIDDEN
kubectl ErrorInfo codes
```

---

## 13. Pod terminal WebSocket

### 13.1 URL

```text
WS /clusters/{cluster_id}/pods/{namespace}/{name}/terminal
```

Query:

```text
token: session token
container: string = ""
shell: "auto" | "sh" | "bash" | "ash" = "auto"
```

### 13.2 Client messages

Input:

```json
{
  "type": "input",
  "data": "ls\r"
}
```

Resize:

```json
{
  "type": "resize",
  "rows": 30,
  "cols": 120
}
```

Close:

```json
{
  "type": "close"
}
```

### 13.3 Server messages

Connected:

```json
{
  "type": "status",
  "data": "connected",
  "commandPreview": "kubectl exec ..."
}
```

Output:

```json
{
  "type": "output",
  "stream": "pty",
  "data": "..."
}
```

Pipe fallback streams use:

```text
stdout
stderr
```

Closed:

```json
{
  "type": "status",
  "data": "closed"
}
```

Error:

```json
{
  "type": "error",
  "data": "Human-readable error",
  "detail": "Optional technical detail"
}
```

### 13.4 Runtime behavior

- checks `create pods/exec` authorization;
- prefers Windows PTY when available;
- falls back to normal pipes;
- selected shell is started interactively;
- process must terminate on client disconnect, explicit close or Electron shutdown;
- terminal content is not written to audit logs;
- audit records open/close metadata and command preview only.

---

## 14. Port-forward routes

### 14.1 GET `/port-forwards`

Response:

```json
{
  "items": []
}
```

Each element:

```ts
interface PortForwardSession {
  id: string;
  clusterId: string;
  namespace: string;
  resource: string;
  name: string;
  localPort: number;
  remotePort: number;
  status: string;
  pid: number;
  startedAt: string;
  commandPreview: string;
  url: string;
  source?: "kubedeck" | "external";
  stoppable?: boolean;
}
```

---

### 14.2 POST `/clusters/{cluster_id}/port-forwards`

Request:

```json
{
  "resource": "service",
  "name": "my-service",
  "namespace": "default",
  "localPort": 0,
  "remotePort": 8080
}
```

Rules:

- supported resources: `pods`, `services`, `deployments`;
- namespace must be concrete, not `all`;
- `remotePort`: `1..65535`;
- `localPort`: `0..65535`;
- `localPort=0` means select an available port automatically.

Response:

```ts
PortForwardSession
```

Known errors:

```text
400 INVALID_RESOURCE
400 INVALID_NAMESPACE
400 INVALID_PORT
409 LOCAL_PORT_IN_USE
404 CLUSTER_NOT_FOUND
502 KUBECTL_NOT_FOUND
502 PORT_FORWARD_FAILED
```

---

### 14.3 DELETE `/port-forwards/{session_id}`

Response:

```json
{
  "ok": true
}
```

Known errors:

```text
403 EXTERNAL_PORT_FORWARD_READ_ONLY
404 PORT_FORWARD_NOT_FOUND
```

External port-forwards discovered from the operating system are read-only.

---

## 15. Watch routes

### 15.1 GET `/watches/status`

Response:

```ts
interface WatchStatus {
  enabled: boolean;
  mode: string;
  running: number;
  total: number;
  watches: WatchSession[];
  note?: string;
}
```

`WatchSession`:

```ts
interface WatchSession {
  id: string;
  clusterId: string;
  resource: string;
  namespace: string;
  status: "running" | "stopping" | "stopped" | "failed" | string;
  pid?: number | null;
  startedAt: number;
  updatedAt: number;
  ageSeconds: number;
  stdoutLines: number;
  stderrLines: number;
  cacheEvents?: number;
  cacheInvalidations?: number;
  exitCode?: number | null;
  stoppedByUser: boolean;
  commandPreview: string;
  outputTail: string[];
  errorTail: string[];
  alreadyRunning?: boolean;
}
```

---

### 15.2 POST `/clusters/{cluster_id}/watches`

Request:

```json
{
  "resource": "pods",
  "namespace": "all"
}
```

Response:

```ts
WatchSession
```

When an equivalent watch already exists, the existing session can be returned with:

```json
{
  "alreadyRunning": true
}
```

---

### 15.3 DELETE `/watches/{watch_id}`

Response:

```json
{
  "ok": true,
  "found": true,
  "watch": {}
}
```

`watch` may be absent/null when not found.

---

### 15.4 POST `/watches/stop-all`

Response:

```json
{
  "ok": true,
  "stopped": 2,
  "watches": []
}
```

---

## 16. Resource watch WebSocket

### 16.1 URL

```text
WS /clusters/{cluster_id}/resources/{resource}/watch-events
```

Query:

```text
namespace: string = "all"
token: session token
```

### 16.2 Initial server event

```json
{
  "type": "status",
  "data": "connected",
  "clusterId": "...",
  "resource": "pods",
  "namespace": "all"
}
```

### 16.3 Resource event

```ts
interface ResourceWatchEvent {
  type: "resource.changed" | "status" | string;
  data?: string;
  clusterId?: string;
  watchId?: string;
  resource?: string;
  namespace?: string;
  name?: string;
  eventType?: string;
  cacheInvalidations?: number;
  at?: number;
}
```

### 16.4 Heartbeat

Server:

```json
{
  "type": "heartbeat",
  "at": 1710000000
}
```

Current heartbeat period:

```text
30 seconds
```

### 16.5 Ping/pong

Client may send the text frame:

```text
ping
```

Server responds:

```json
{
  "type": "pong",
  "at": 1710000000
}
```

---

## 17. Node SSH WebSocket

### 17.1 URL

```text
WS /clusters/{cluster_id}/nodes/{name}/ssh
```

Query:

```text
token: session token
```

### 17.2 Initial server status

```json
{
  "type": "status",
  "data": "Waiting for SSH connection settings"
}
```

### 17.3 First client message

The first message must be `type=connect` and must arrive within 90 seconds.

```json
{
  "type": "connect",
  "host": "10.0.0.10",
  "port": 22,
  "username": "user",
  "authMethod": "agent",
  "password": "",
  "keyPath": "",
  "keyPassphrase": "",
  "useJumpHost": false,
  "jumpHost": "",
  "jumpPort": 22,
  "jumpUsername": "",
  "jumpAuthMethod": "agent",
  "jumpPassword": "",
  "jumpKeyPath": "",
  "jumpKeyPassphrase": "",
  "cols": 100,
  "rows": 30
}
```

Supported auth methods:

```text
agent
default
password
privateKey
```

### 17.4 Subsequent client messages

Input:

```json
{
  "type": "input",
  "data": "uptime\r"
}
```

Resize:

```json
{
  "type": "resize",
  "cols": 120,
  "rows": 40
}
```

Close:

```json
{
  "type": "close"
}
```

### 17.5 Server messages

Statuses:

```json
{
  "type": "status",
  "data": "Connecting to SSH..."
}
```

```json
{
  "type": "status",
  "data": "Connected"
}
```

```json
{
  "type": "status",
  "data": "SSH session closed"
}
```

Output:

```json
{
  "type": "output",
  "data": "..."
}
```

Error:

```json
{
  "type": "error",
  "data": "..."
}
```

Security requirements:

- passwords and key passphrases must never be logged;
- audit may contain target host and jump host but not credentials;
- SSH channel, target client and jump client must close on disconnect;
- Node replacement must define the host-key policy explicitly before RC.

---

## 18. Known contract gaps to resolve in Alpha 1

These are existing ambiguities or mismatches, not reasons to change behavior immediately.

### GAP-001 — LLM preview response mismatch

Renderer expects:

```text
maxOutputTokens
```

Python route currently does not clearly return it.

Action:

- add golden contract test;
- choose one canonical response;
- change backend and renderer together only after the test documents the baseline.

### GAP-002 — BackendInfo is Python-specific

`BackendInfo` requires:

```text
pythonVersion
```

Target runtime needs:

```text
nodeVersion
```

Action:

- make `pythonVersion` optional only after renderer compatibility;
- add `runtime` and `nodeVersion` additively;
- remove Python-specific field only in RC or later.

### GAP-003 — Validation error envelope

FastAPI `422` differs from `ErrorInfo`.

Action:

- enumerate renderer-visible validation failures;
- decide whether to reproduce FastAPI's envelope or normalize it;
- do not let Fastify/Zod expose an unrelated third shape.

### GAP-004 — WebSocket types are not centralized

Terminal and SSH message types are currently implicit in component/backend code.

Action:

- move all WebSocket messages into `packages/shared-types`;
- add discriminated unions;
- contract-test every client and server message.

### GAP-005 — Open-ended ResourceRow

Many resource-specific fields are generated dynamically by Python normalizers.

Action:

- collect golden fixtures for every supported resource kind;
- compare Node output field-by-field;
- preserve number/string/boolean/null distinctions.

### GAP-006 — Cached list response is wider than base type

The resource-list response can add cache metadata.

Action:

- create a canonical `ResourceListResponse`;
- include all cache-related optional fields explicitly.

### GAP-007 — GET `/clusters` is not a normal ApiClient path

The route exists but the renderer mostly uses `/config`.

Action:

- keep the route during migration;
- add a direct contract test so it is not accidentally removed.

### GAP-008 — LLM test failures return HTTP 200

This is intentional current behavior but semantically unusual.

Action:

- preserve through 2.0 migration;
- consider changing only in a later API version.

---

## 19. Contract-test minimum

Alpha 1 must introduce tests that verify at least:

1. route method and path;
2. required authentication;
3. request schema;
4. successful status and media type;
5. error status and payload;
6. renderer parsing;
7. text response encoding;
8. WebSocket close code;
9. WebSocket message union;
10. process cleanup after disconnect.

For migration parity, one fixture must be sent to both implementations:

```text
Node route
Python route
```

The comparison may ignore only explicitly declared unstable values:

```text
PID
timestamps
elapsed milliseconds
random session IDs
auto-selected local ports
```

---

## 20. Compatibility rule

A route can switch from Python to Node only when:

- its contract test passes;
- its Python/Node parity test passes;
- security checks are equivalent;
- audit behavior is equivalent;
- renderer requires no feature-specific workaround;
- portable build smoke test passes;
- process cleanup test passes where applicable.

This document is the baseline. Any intentional API change requires a separate recorded decision and simultaneous renderer update.
