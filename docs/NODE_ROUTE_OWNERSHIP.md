# KubeDeck 2.0 — Node Route Ownership (archive)

> Исторический план миграции. Все 49 существующих контрактов перенесены на Node; Python/FastAPI proxy удалён. Актуальный registry находится в `apps/desktop/src/main/backend/routeOwnership.ts`.

**Status:** migration registry design  
**Source branch:** `dev/2.0.0`  
**Snapshot date:** 2026-06-21  
**Baseline:** all existing routes are currently implemented by Python/FastAPI.

---

## 1. Purpose

This document defines which runtime owns each backend route during the gradual migration.

Ownership values:

```ts
type RouteOwner = "node" | "python";
```

During Alpha and Beta:

```text
Renderer
   |
   v
Node Gateway
   |
   +-- owner=node   -> execute TypeScript implementation
   |
   +-- owner=python -> proxy to legacy FastAPI backend
```

The renderer must never decide which implementation owns a route.

---

## 2. Current baseline

At the start of the migration:

```text
Existing HTTP routes:      46 Python / 0 Node
Existing WebSocket routes:  3 Python / 0 Node
Total existing contracts:  49 Python / 0 Node
```

`/migration/status` will be a new Node-only diagnostic route and is not part of the legacy 49-route baseline.

---

## 3. Planned releases

| Release | Ownership milestone |
|---|---|
| `2.0.0-alpha.1` | Node Gateway, `/health`, new `/migration/status`; all other existing routes proxied |
| `2.0.0-alpha.2` | Config, Settings, Cluster management and Audit move to Node |
| `2.0.0-alpha.3` | Kubectl runtime and bounded read-only Kubernetes routes move to Node |
| `2.0.0-alpha.4` | Mutating operations, confirmations, auth checks and Secret operations move to Node |
| `2.0.6` | Cache, watch, terminal, deployment logs, port-forward and SSH move to Node |
| `2.0.6` | Relations, Problems, Search and LLM move to Node |
| `2.0.0-rc.1` | Legacy proxy and Python backend are removed |
| `2.0.0` | Node is the sole owner of all routes |

---

## 4. Ownership registry shape

The runtime registry should use explicit entries:

```ts
export type RouteOwner = "node" | "python";
export type RouteTransport = "http" | "websocket";

export interface RouteOwnership {
  method: string;
  path: string;
  transport: RouteTransport;
  owner: RouteOwner;
  targetRelease: string;
  migratedIn?: string;
  sourceModule: string;
  notes?: string;
}
```

Example:

```ts
export const routeOwnership: RouteOwnership[] = [
  {
    method: "GET",
    path: "/health",
    transport: "http",
    owner: "node",
    targetRelease: "2.0.0-alpha.1",
    migratedIn: "2.0.0-alpha.1",
    sourceModule: "routes_core.py"
  },
  {
    method: "GET",
    path: "/config",
    transport: "http",
    owner: "python",
    targetRelease: "2.0.0-alpha.2",
    sourceModule: "routes_core.py"
  }
];
```

The registry is configuration, not advisory documentation. Node Gateway routing must use it directly.

---

## 5. Full route migration matrix

### 5.1 Core, config and clusters

| Method | Path | Baseline owner | Target release | Reason |
|---|---|---|---|---|
| GET | `/health` | Python | `alpha.1` | Minimal Node liveness route |
| GET | `/app/info` | Python | `alpha.2` | Depends on Node runtime metadata and config |
| GET | `/config` | Python | `alpha.2` | ConfigStore foundation |
| PUT | `/settings` | Python | `alpha.2` | Config validation/persistence |
| GET | `/resource-cache/status` | Python | `2.0.6` | Must move with cache/watch implementation |
| POST | `/resource-cache/clear` | Python | `2.0.6` | Must invalidate Node-owned cache |
| GET | `/kubectl/status` | Python | `alpha.3` | First consumer of Node Kubectl Runtime |
| GET | `/clusters` | Python | `alpha.2` | ClusterStore |
| POST | `/clusters/import` | Python | `alpha.2` | Kubeconfig file management |
| PATCH | `/clusters/{cluster_id}` | Python | `alpha.2` | ClusterStore |
| DELETE | `/clusters/{cluster_id}` | Python | `alpha.2` | ClusterStore and file cleanup |
| POST | `/clusters/last/open` | Python | `alpha.2` | ClusterStore |
| POST | `/clusters/{cluster_id}/open` | Python | `alpha.3` | Requires Node Kubectl Runtime |
| GET | `/clusters/{cluster_id}/namespaces` | Python | `alpha.3` | Read-only kubectl route |
| GET | `/audit` | Python | `alpha.2` | Node AuditStore |

### 5.2 LLM, problems, search and relations

| Method | Path | Baseline owner | Target release | Reason |
|---|---|---|---|---|
| GET | `/llm/status` | Python | `2.0.6` | Move with complete LLM module |
| POST | `/llm/test` | Python | `2.0.6` | LLM client |
| POST | `/llm/preview-resource-prompt` | Python | `2.0.6` | Context builder and sanitizer |
| POST | `/llm/analyze-resource` | Python | `2.0.6` | LLM client/context/prompts |
| GET | `/clusters/{cluster_id}/problems` | Python | `2.0.6` | Problems Engine |
| GET | `/clusters/{cluster_id}/search` | Python | `2.0.6` | Search Engine and discovery |
| GET | `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/related` | Python | `2.0.6` | Relations Engine |

### 5.3 YAML and mutating operations

| Method | Path | Baseline owner | Target release | Reason |
|---|---|---|---|---|
| POST | `/clusters/{cluster_id}/yaml/dry-run` | Python | `alpha.4` | YAML validation + confirmation/security layer |
| PUT | `/clusters/{cluster_id}/yaml/apply` | Python | `alpha.4` | Mutating operation and cache invalidation |
| POST | `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/action` | Python | `alpha.4` | Delete/restart/redeploy/scale/node maintenance |
| POST | `/clusters/{cluster_id}/pods/{namespace}/{name}/exec` | Python | `alpha.4` | Confirmation, `auth can-i`, command limits |
| GET | `/clusters/{cluster_id}/secrets/{namespace}/{name}/keys` | Python | `alpha.4` | Secret-specific security contract |
| POST | `/clusters/{cluster_id}/secrets/{namespace}/{name}/reveal` | Python | `alpha.4` | Sensitive response and sanitizer |
| POST | `/clusters/{cluster_id}/secrets/{namespace}/{name}/copy` | Python | `alpha.4` | Secret audit path |

### 5.4 Read-only Kubernetes routes

| Method | Path | Baseline owner | Target release | Reason |
|---|---|---|---|---|
| GET | `/clusters/{cluster_id}/resources/{resource}` | Python | `alpha.3` | Kubectl Runtime + normalizers |
| GET | `/clusters/{cluster_id}/resource-definitions` | Python | `alpha.3` | Discovery parser |
| GET | `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/yaml` | Python | `alpha.3` | Bounded text kubectl command |
| GET | `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/describe` | Python | `alpha.3` | Bounded text kubectl command |
| GET | `/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/events` | Python | `alpha.3` | Event filter/normalizer |
| GET | `/clusters/{cluster_id}/pods/{namespace}/{name}/yaml` | Python | `alpha.3` | Bounded text kubectl command |
| GET | `/clusters/{cluster_id}/pods/{namespace}/{name}/describe` | Python | `alpha.3` | Bounded text kubectl command |
| GET | `/clusters/{cluster_id}/pods/{namespace}/{name}/logs` | Python | `alpha.3` | Bounded HTTP logs |
| GET | `/clusters/{cluster_id}/deployments/{namespace}/{name}/log-targets` | Python | `2.0.6` | Move with workload-log process lifecycle |
| GET | `/clusters/{cluster_id}/deployments/{namespace}/{name}/logs` | Python | `2.0.6` | Multi-Pod workload logs |

### 5.5 Streaming and long-running processes

| Method | Path | Transport | Baseline owner | Target release | Reason |
|---|---|---|---|---|---|
| WS | `/clusters/{cluster_id}/pods/{namespace}/{name}/terminal` | WebSocket | Python | `2.0.6` | PTY/pipes/process cleanup |
| GET | `/port-forwards` | HTTP | Python | `2.0.6` | PortForward Registry |
| POST | `/clusters/{cluster_id}/port-forwards` | HTTP | Python | `2.0.6` | Long-running kubectl process |
| DELETE | `/port-forwards/{session_id}` | HTTP | Python | `2.0.6` | Process ownership and cleanup |
| GET | `/watches/status` | HTTP | Python | `2.0.6` | Watch Manager |
| POST | `/clusters/{cluster_id}/watches` | HTTP | Python | `2.0.6` | Long-running kubectl watch |
| DELETE | `/watches/{watch_id}` | HTTP | Python | `2.0.6` | Watch process cleanup |
| POST | `/watches/stop-all` | HTTP | Python | `2.0.6` | Watch process cleanup |
| WS | `/clusters/{cluster_id}/resources/{resource}/watch-events` | WebSocket | Python | `2.0.6` | Event Hub fan-out |
| WS | `/clusters/{cluster_id}/nodes/{name}/ssh` | WebSocket | Python | `2.0.6` | SSH channel lifecycle |

---

## 6. Ownership counts after each milestone

The counts below describe the planned ownership of the **49 existing contracts**.

| Milestone | Node-owned | Python-owned | Notes |
|---|---:|---:|---|
| Baseline | 0 | 49 | Current branch |
| `alpha.1` | 1 | 48 | Existing `/health`; new `/migration/status` not counted |
| `alpha.2` | 10 | 39 | App info, config/settings, cluster store subset, audit |
| `alpha.3` | 21 | 28 | Kubectl status, cluster open/namespaces, read-only resources |
| `alpha.4` | 28 | 21 | YAML, resource actions, exec, Secrets |
| `2.0.6` | 42 | 7 | Cache, logs, terminal, port-forward, watch, SSH |
| `2.0.6` | 49 | 0 | LLM, Problems, Search, Relations |
| `rc.1` | 49 | 0 | Proxy and Python process removed |

Count changes must be generated from the registry in CI rather than manually maintained once implementation begins.

---

## 7. New Node-only routes

### 7.1 GET `/migration/status`

Introduced:

```text
2.0.0-alpha.1
```

Authentication:

```text
required
```

Proposed response:

```ts
interface MigrationStatus {
  mode: "hybrid" | "node-only";
  gateway: {
    runtime: "node";
    version: string;
    processId: number;
  };
  legacyBackend: {
    enabled: boolean;
    healthy: boolean;
    processId?: number;
    baseUrl?: string;
  };
  routes: {
    totalExisting: number;
    nodeOwned: number;
    pythonOwned: number;
    node: Array<{
      method: string;
      path: string;
      transport: "http" | "websocket";
      migratedIn?: string;
    }>;
    python: Array<{
      method: string;
      path: string;
      transport: "http" | "websocket";
      targetRelease: string;
    }>;
  };
  processes: {
    watches: number;
    terminals: number;
    portForwards: number;
    sshSessions: number;
  };
}
```

This route is diagnostic and must not expose:

- the session token;
- LLM API keys;
- SSH passwords/passphrases;
- Secret values;
- complete environment variables.

The route may be removed or reduced after final 2.0 stabilization.

---

## 8. Gateway routing rules

### 8.1 Node-owned HTTP route

```text
request
  -> authenticate in Node Gateway
  -> validate request using canonical schema
  -> execute Node handler
  -> return canonical response
```

### 8.2 Python-owned HTTP route

```text
request
  -> authenticate in Node Gateway
  -> proxy to loopback legacy backend
  -> preserve method/path/query/body
  -> preserve response status/media/body
```

The proxy must not:

- parse and reserialize `text/plain`;
- translate status codes;
- rename fields;
- expose the Python backend URL to renderer;
- forward arbitrary external destinations.

### 8.3 Python-owned WebSocket route

The Gateway must either:

1. proxy WebSocket frames transparently; or
2. temporarily expose a Gateway-generated URL that still hides legacy ownership.

The renderer must not retain separate Node/Python WebSocket builders.

### 8.4 Route matching

Route matching must distinguish close paths deterministically, including:

```text
/clusters/last/open
/clusters/{cluster_id}/open

/clusters/{cluster_id}/resources/{resource}
/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/yaml
```

The explicit route registry and registration order are part of Alpha 1 tests.

---

## 9. Ownership change checklist

A route can change:

```text
owner: python -> node
```

only after all items pass.

### Contract

- method/path unchanged;
- query defaults unchanged;
- body shape unchanged;
- success status unchanged;
- media type unchanged;
- success payload parity passes;
- error payload parity passes.

### Security

- Node session token check active;
- path identifiers validated;
- output limits enforced;
- dangerous confirmation enforced;
- `kubectl auth can-i` preserved where required;
- secret sanitization tested;
- command uses argv, not `shell: true`.

### Lifecycle

For long-running routes:

- process registered;
- cancel works;
- WebSocket disconnect works;
- Electron shutdown cleanup works;
- stale process recovery works;
- audit close/failure event works.

### Packaging

- development run passes;
- portable build passes;
- clean-Windows smoke test passes;
- no new Python dependency introduced.

---

## 10. Rollback rule

Every Alpha/Beta ownership change must be reversible by editing the registry:

```ts
owner: "node" -> owner: "python"
```

Rollback must not require a renderer rebuild during hybrid releases.

A Node handler that fails parity remains in the source tree but is not activated until corrected.

---

## 11. Alpha 1 implementation boundary

Alpha 1 may change ownership only for:

```text
GET /health
```

Alpha 1 may add:

```text
GET /migration/status
```

All other existing routes remain Python-owned and are proxied.

Alpha 1 must not yet:

- rewrite settings;
- import or modify kubeconfigs;
- run Kubernetes resource commands in Node;
- move WebSockets;
- remove FastAPI;
- remove PyInstaller;
- modify normalizer output;
- redesign the renderer.

---

## 12. RC removal gate

Python can be removed only when the generated registry reports:

```json
{
  "totalExisting": 49,
  "nodeOwned": 49,
  "pythonOwned": 0
}
```

Additional RC requirements:

- no renderer reference to Python backend URL;
- no Python executable in packaged resources;
- no PyInstaller build step;
- no backend PID file;
- no legacy proxy;
- no Python-specific health check;
- no active Python process after launch;
- all contract tests run solely against Node;
- portable application runs on a clean Windows machine without Python.

---

## 13. Initial decision

The current working state remains:

```text
all 49 existing routes -> Python
```

The first implementation patch will establish:

```text
GET /health             -> Node
GET /migration/status   -> Node (new)
all other routes        -> Python through Node Gateway
```

No route ownership should change outside this document and the runtime registry.
