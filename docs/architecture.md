# KubeDeck Architecture

## Process Model

KubeDeck has two runtime processes:

- Electron main process: owns the desktop window, starts/stops the backend, exposes safe IPC for file dialogs and opening the logs folder.
- FastAPI backend: owns AppData config, kubeconfig imports, kubectl execution, resource normalization and REST APIs.

The renderer calls the backend over `http://127.0.0.1:<dynamic-port>`. Electron allocates the backend port at startup and exposes the final URL through preload IPC.

## Storage

All local state is stored under `%APPDATA%\KubeDeck\`.

- `config.json`: clusters and settings.
- `kubeconfigs\<cluster-id>.yaml`: imported kubeconfigs.
- `logs\`: desktop, backend and kubectl logs.

Kubernetes resources are fetched on demand and kept in renderer/backend memory only. The current resource cache is in-memory; silent refresh can reuse fresh cached resource snapshots while manual refresh bypasses cache.

## kubectl Transport

The backend uses `kubectl` as the primary transport. All kubectl calls pass through `KubectlRunner` and `KubectlCommand`, which provide:

- command preview;
- timeout handling;
- stderr capture;
- error classification;
- logging with basic sensitive-line redaction.

The portable build does not bundle root-level `kubectl.exe`. Runtime resolution uses the configured kubectl path from Settings or `kubectl` from PATH.

## Backend module split

Important backend modules:

- `api/runtime.py`: store/runner/config cache and common kubectl runtime helpers.
- `api/validation.py`: validation, payload limits and confirmation helpers.
- `api/terminal.py`: pod terminal command and streaming helpers.
- `api/port_forward.py`: port-forward process discovery, registry and session helpers.
- `api/search.py`: global search helper logic.
- `api/problems.py`: Problems dashboard engine helpers.
- `api/relations.py`: related-resource engine helpers.
- `api/secrets.py`: Secret reveal/copy helpers and safe audit metadata.
- `api/workload_logs.py`: Deployment-level aggregated log helpers.
- `api/resource_cache.py`: in-memory resource cache foundation for discovery and short-lived resource-list snapshots.
- `api/watch_manager.py`: kubectl watch process lifecycle, cache invalidation counters and event publication.
- `api/watch_events.py`: lightweight in-process WebSocket event hub for resource-watch notifications.

## API Surface

Core endpoints include:

- `GET /health`
- `GET /kubectl/status`
- `GET /config`
- `PUT /settings`
- `GET /clusters`
- `POST /clusters/import`
- `PATCH /clusters/{id}`
- `DELETE /clusters/{id}`
- `POST /clusters/{id}/open`
- `POST /clusters/last/open`
- `GET /clusters/{id}/namespaces`
- `GET /clusters/{id}/resources/{resource}`
- `GET /clusters/{id}/resources/{resource}/{namespace}/{name}/{yaml|describe}`
- `GET /clusters/{id}/resources/{resource}/{namespace}/{name}/related`
- `GET /clusters/{id}/resources/{resource}/{namespace}/{name}/logs` for supported workloads such as Deployment logs
- `GET /resource-cache/status`
- `POST /resource-cache/clear`

## Current frontend structure

The resource drawer has been split into smaller components:

- `ResourceSummary.tsx`
- `YamlTab.tsx`
- `DescribeTab.tsx`
- `EventsTab.tsx`
- `RelatedTab.tsx`
- `LogsTab.tsx`
- `TerminalTab.tsx`
- `SecretTab.tsx`
- `PortForwardModal.tsx`
- `PodDrawerModals.tsx`

`PodDrawer.tsx` remains the coordinator for drawer state and tab selection.

## Completed watch/cache architecture

The current 1.0.3 line has the watch/cache/WebSocket foundation in place:

1. cache diagnostics UI;
2. cache invalidation after mutating actions and YAML apply;
3. cached discovery/resource definitions;
4. controlled resource-list cache with manual refresh bypass;
5. watch manager foundation;
6. watch diagnostics UI;
7. watch-driven resource-list cache invalidation;
8. WebSocket event stream for resource changes;
9. active-table silent refresh with regular polling fallback.

Future dangerous actions should reuse the kubectl command abstraction, command preview, backend confirmation metadata and RBAC checks where applicable.

## Resource watch live refresh

`kubectl watch` reader threads parse `--output-watch-events=true` JSON lines, invalidate `ResourceSnapshotCache`, and publish lightweight events through an in-process WebSocket hub. The renderer subscribes only for the active cluster/resource/namespace and schedules a debounced silent refresh. This keeps normal HTTP polling as a safe fallback while reducing stale table windows.
