## 2.0.5 - Stable Node-only desktop release

- Promoted KubeDeck to stable `2.0.5`.
- Renamed release verification to `verify:release` and synchronized release contract tests.
- Updated README, release notes, regression checklist, package metadata, lockfile, Help version and build artifact paths.
- Included the accumulated UX fixes for pod terminal, themes, languages, filters, namespaces, resource-table columns and button styling.

## 1.1.2 - Windows portable builder cleanup

- Added a canonical Windows portable builder.
- Updated package:win to use scripts/build-portable-windows.ps1.
- Converted package-windows.ps1 and build.bat into wrappers for the canonical builder.
## 1.1.1 - Related and namespace selector hotfix
- Fixed Related tab diagnostics and relation chips layout so scanned sources and badges render as compact UI elements instead of loose text.
- Preserved the last selected namespaced namespace when navigating to cluster-scoped resources and returning back to namespaced resource sections.
- Bumped application, desktop and backend metadata to 1.1.1.
## 1.1.0 - Local LLM diagnostics

- Added local OpenAI-compatible LLM integration with Settings -> LLM configuration.
- Added a resource drawer LLM tab with manual `Analyze resource`, rerun, copy answer and response metadata.
- Added backend `/llm/status`, `/llm/test` and `/llm/analyze-resource` endpoints.
- Added sanitization and truncation before resource context is sent to the configured local LLM endpoint.
- Bumped application, desktop and backend metadata to 1.1.0.

## Patch 11 - 1.0.5 stabilization gate

- Added `scripts/validate-1.0.5.ps1` as the explicit stabilization gate for the current 1.0.5 line.
- The validation script checks that portable packaging no longer bundles/injects `kubectl.exe`.
- The script can run backend compile/tests, desktop build and optional portable packaging with release-output kubectl verification.
- Updated roadmap/release docs to freeze the current 1.0.5 stabilization stage before starting 1.0.5 refactor work.

## Patch 10 - Related resources topology polish

- Related resources now include richer Pod configuration links: imagePullSecrets, envFrom refs and env key refs for ConfigMaps/Secrets.
- Pod related resources can now show the parent Deployment/CronJob behind ReplicaSet/Job owner chains.
- Service related resources now include EndpointSlices in addition to legacy Endpoints.
- Endpoint and EndpointSlice drawers now link back to their Service and target Pods when Kubernetes provides targetRef metadata.
- ServiceAccount related resources now show token/secret and imagePullSecret links.
- Related tab now has relation summary chips and Copy map for sharing a compact resource topology map.

## Patch 09 - Problems dashboard diagnostics polish

- Added backend problem categories for CrashLoop, image pull, scheduling, node health, storage/volume, probe, restart and deployment availability issues.
- Problems summary now includes category and kind counts for faster triage.
- Problems UI now has a Category filter, category column and top priority problem cards.
- Priority problem cards can open the affected resource and copy a compact diagnostics block.
- Warning Events now carry target resource locators when Kubernetes provides involved object metadata, so opening a problem jumps to the affected resource instead of the Event row where possible.

## Patch 08 - Bulk delete result panel polish

- Added a dedicated bulk-delete result panel outside the confirmation modal.
- The result panel shows total, deleted and failed resource counts after the background delete finishes.
- Failed resource details are displayed inline without turning partial success into a global error banner.
- Added Copy result for sharing the full success/failure summary.

## Patch 07 - Cleanup and roadmap alignment

- Aligned roadmap/release docs with the already completed watch/cache/WebSocket, Deployment logs, Describe scroll and kubectl unbundling work.
- Updated resource cache comments/status text so they no longer describe resource polling as cache-disabled.
- Removed stale in-modal bulk-delete result state and CSS now that bulk delete closes immediately and reports status outside the modal.
- Verified the resource action audit path in the current source; it records one success event per successful action.

## Patch 06 - Watch WebSocket live refresh

- Added a backend WebSocket event stream for parsed `kubectl watch` events.
- The active resource table now auto-starts/reuses a watch and schedules a silent refresh when matching watch events arrive.
- HTTP polling remains the fallback if WebSocket or watch startup fails.

## 1.0.5 - controlled resource list cache step

## Patch 05 - Watch-to-cache invalidation

- Connected backend `kubectl watch` output to `ResourceSnapshotCache` invalidation.
- Watch commands now request Kubernetes watch event envelopes with `--output-watch-events=true`.
- Parsed watch events invalidate affected resource-list cache entries for the concrete namespace and `all` namespace snapshot.
- Watch diagnostics now expose cache event and cache invalidation counters per watch session.
- WebSocket live updates are still a future step; current UI polling remains the safe fallback.

## Patch 03 - Watch diagnostics UI

- Added Settings diagnostics UI for backend kubectl watch sessions.
- Added frontend API methods and TypeScript types for watch status/start/stop/stop-all.
- Watch diagnostics can start a watch for the active cluster, show pid/status/stdout/stderr counters, display output/error tails and stop one or all watch sessions.
- Watch diagnostics remain visible in Settings; watch output is now connected to cache invalidation, while WebSocket live updates are still a future step.
- Updated stale cache and portable-kubectl help text in RU/EN locales.

## Patch 02 - Portable kubectl unbundling

- Removed bundled `kubectl.exe` from Electron portable `extraResources`.
- Stopped forcing the backend to use packaged `resources/bin/kubectl.exe`.
- Removed build-time SHA256 enforcement for root-level `kubectl.exe` because the portable artifact no longer includes kubectl.
- Updated docs and missing-kubectl guidance to require Settings path or PATH-based kubectl resolution.


### Watch manager foundation

- Added backend `watch_manager.py` foundation for future Kubernetes watch integration.
- Added diagnostic endpoints to start, stop and inspect kubectl watch processes without connecting them to UI live updates yet.
- Added graceful backend shutdown cleanup for running watch processes.
- Watch output is not connected to resource cache or WebSocket updates yet.
- Existing polling/resource tables remain unchanged.


- Added controlled read-through cache support for `/clusters/{cluster_id}/resources/{resource}` responses.
- Resource list cache is short-lived: 15 seconds.
- Manual/live resource loads bypass cached reads and refresh the cached snapshot.
- Silent auto-refresh may reuse a fresh cached snapshot to reduce repeated `kubectl get` calls.
- Existing action/YAML/cluster invalidation helpers now clear these resource list snapshots.
- Resource cache diagnostics now report `foundation+discovery+resource-list` mode and resource-list TTL.
- Watch/WebSocket remain disabled; package manifests, lockfile and dependencies remain unchanged.


## 1.0.5 - discovery cache step

- Added read-through backend cache for `kubectl api-resources --verbs=list -o wide`.
- Resource definitions, global search CRD discovery and CRD instance discovery now share the visible resource cache foundation.
- CRD mutations and YAML apply of CRD definitions invalidate discovery cache.
- Main resource tables still bypass cache; watch/WebSocket remain disabled.

## 1.0.5 - YAML dynamic drawer layout hotfix

- Fixed the drawer grid layout so the tab content occupies the remaining drawer height instead of an auto-sized row.
- Restored dynamic YAML editor sizing: the YAML editor now grows/shrinks with the drawer/window height and keeps scrolling inside the editor.
- Kept the main resource table scrollbar fix and did not change backend, package manifests, or dependencies.

### 1.0.5 YAML drawer layout hotfix

- YAML tab now uses the drawer fill layout, like Logs and Terminal, so the drawer itself does not create an extra vertical scrollbar.
- YAML editor now flexes into the remaining drawer height and keeps scrolling inside the editor area.
- Main resource table layout, Settings, Problems, Secrets, Logs, backend APIs, dependencies and version remain unchanged.


### 1.0.5 main resource layout hotfix

- Removed the extra outer scrollbar from resource-table pages by making the main resource panel a non-scrolling flex container.
- Kept internal table scrolling inside the virtual table area and preserved scrolling for Settings, Problems, Audit, Help, and other non-table pages.

### 1.0.5 cache invalidation helpers

- Added backend resource cache invalidation helpers for future cached resource lists.
- Resource actions now invalidate affected resource snapshots after successful delete/restart/redeploy/scale operations.
- YAML apply now invalidates affected snapshots; unknown custom-resource kinds clear the cluster cache safely.
- Cluster removal clears cached snapshots for that cluster.
- Added backend tests for targeted invalidation, workload-related pod/replicaset invalidation and broad YAML apply fallback.
- Current resource polling is still not switched to cache; watch/WebSocket remains disabled.
- No frontend, dependency, package-lock, or version changes.

### 1.0.5 non-blocking delete status hotfix

- Backend delete actions now call `kubectl delete ... --wait=false` so the API returns after Kubernetes accepts deletion instead of waiting for graceful termination to finish.
- Pod rows with `metadata.deletionTimestamp` are displayed as `Terminating` instead of `Running`.
- Bulk delete marks selected rows as `Terminating` immediately while the background delete requests are running.
- Updated delete/restart command previews to show `--wait=false`.
- Added a backend normalizer test for terminating pods.
- No dependency, package-lock, or version changes.

### 1.0.5 bulk delete confirmation UX

- Bulk delete confirmation now closes immediately after Confirm is clicked.
- Deletions continue in the background so the modal no longer looks stuck while Kubernetes waits for graceful termination.
- Added a main-panel status message for requested/completed bulk delete operations.
- Partial failures are surfaced through the existing ErrorPanel with the failed resource list.
- No backend API, dependency, package-lock, or version changes.


### 1.0.5 delete/restart confirmation UX

- Resource action confirmation modals now close immediately after Confirm is clicked.
- Long-running Kubernetes delete/restart operations continue in the background and update the drawer status when they finish or fail.
- This avoids making pod delete/restart confirmations look frozen while Kubernetes waits for graceful termination or controller reconciliation.

# KubeDeck 1.0.5 documentation snapshot patch

- Aligned README, security notes, release checklist and 1.0.5 plan with the current post-refactor behavior.
- Documented that Terminal, Restart, Redeploy, Scale and YAML Apply no longer require manual typed-name confirmation in the UI.
- Documented current packaging behavior: packaging does not repair npm dependencies automatically.
- Added roadmap item to remove bundled/root-level `kubectl.exe` from the portable build and rely on PATH/configured kubectl.
- Added architecture notes for the backend module split, Secrets viewer, Deployment logs and resource cache foundation.
- No application code, dependency, package-lock, backend API, or version changes.

# KubeDeck 1.0.5 resource cache foundation patch

- Added a thread-safe backend resource snapshot cache foundation for the future watch/cache/WebSocket architecture step.
- Added `/resource-cache/status` and `/resource-cache/clear` diagnostic endpoints.
- The cache is intentionally not used by current resource polling yet, so UI behavior remains unchanged.
- Added backend tests for cache set/get/expiry/clear behavior.
- No frontend, dependency, package-lock, or version changes.

# KubeDeck 1.0.5 deployment logs patch

- Added Deployment-level Logs tab support that aggregates logs from every pod selected by the Deployment selector.
- Added Deployment log pod/container filters, bounded follow refresh, previous logs, timestamps, copy, and download support.
- Added backend Deployment log target discovery with matchLabels and matchExpressions selector support.

# Changelog

### 1.0.5 bulk actions hardening
- Bulk delete now shows the full target list in a scrollable preview instead of truncating after a few rows.
- Added resource and namespace scope metadata plus a Copy list action to the bulk delete confirmation.
- Bulk delete now collects per-resource failures and keeps the modal open with a partial result report instead of hiding failed items behind a single error.
- No backend API, dependency, package-lock, or version changes.

### 1.0.5 CRD instances UX
- Marked CustomResourceDefinition objects as view-only in the drawer.
- Hid direct delete/edit actions for CRD definitions while keeping YAML/Describe readable.
- Enabled delete action for CRD instances opened from the CRD sidebar, subject to Kubernetes RBAC.
- Added a CRD instance notice and better table columns for custom resources.
- Added API Version to generic resource summaries.

### YAML toolbar labels
- Shortened YAML toolbar actions: `Reset draft` -> `Reset`, `Reload from cluster` -> `Reload`.
- Kept the full explanations in button tooltips.
- No behavior, backend, dependency, package-lock, or version changes.

### Layout repair
- Restored the refactored PodDrawer layout after YAML drawer experiments.
- Kept drawer/resource tabs scrollable without forcing the drawer off-screen.
- Rebalanced YAML editor height so it stays usable without turning into a tiny block.

## 2026-06-02 вЂ” 1.0.5 Secret tab resource-text hotfix

- Fixed TypeScript build error in `PodDrawer.tsx` after adding the Secret tab.
- Secret tab is now excluded from the generic YAML/Describe `resourceText()` loader.
- No backend API, dependency, package-lock, or version changes.


### 1.0.5 Secrets viewer

- Added a Secret drawer tab for Kubernetes Secrets.
- Secret keys are listed without decoded values by default.
- Individual keys can be revealed, hidden, copied, and auto-hidden using the configured reveal timeout.
- Secret reveal/copy actions write audit metadata without storing secret values.

### 1.0.5 command preview UX

- Added reusable command preview blocks with a Copy command action.
- Resource action confirmations now show a dedicated kubectl command preview panel.
- YAML apply confirmation now shows the apply command preview.
- Error panels now redact kubeconfig and token/password-like arguments before displaying or copying command previews.

### Build hotfix note

- Rolled desktop dependency graph back to the stable 1.0.2 toolchain while keeping application version 1.0.5.
- Packaging no longer attempts to repair npm dependencies automatically; run npm install/ci explicitly before packaging.


## 1.0.5

- package script now validates required npm build executables and reinstalls dependencies if node_modules is incomplete.

### Dependency cleanup

- Updated Electron, electron-builder, Vite, @vitejs/plugin-react, and TypeScript dependency lines.
- Regenerated `package-lock.json` after controlled dependency updates.
- Removed the npm audit findings present in the 1.0.2 dependency graph.
- Kept runtime behavior, Kubernetes polling, UI timer behavior, confirmation flows, and backend APIs unchanged.

### Validation

- `npm audit` reports zero vulnerabilities.
- `npm run typecheck` passes.
- `npm run build` passes.
- Backend compile and tests pass.

## 1.0.2

### UI timers

- Added a frontend-only UI clock that ticks every second without increasing Kubernetes polling frequency.
- Resource table `Age` columns now update locally every second between backend refreshes.
- Drawer summary `Age` now renders as a live elapsed duration.
- Drawer event timestamps now render as live `ago` durations with the original timestamp preserved in the tooltip.

### Versioning

- Updated root, desktop, shared packages, backend metadata, About/Help fallback, and README release path to `1.0.2`.

## 1.0.1

### Security / safety

- Added backend-enforced typed confirmation for YAML apply.
- Limited YAML apply to one Kubernetes object per request.
- Added YAML target parsing before `kubectl apply`.
- Added typed confirmation UI for restart/redeploy/scale resource actions; delete keeps the standard confirmation dialog without typed resource-name entry.
- Added typed confirmation before opening pod terminal sessions.
- Added WebSocket-side pod-name confirmation for terminal sessions.

### Packaging

- Added `kubectl.exe.sha256`.
- Windows packaging now verifies bundled `kubectl.exe` against `KUBEDECK_KUBECTL_SHA256` or `kubectl.exe.sha256`.
- Pinned Python runtime dependencies.
- Added `requirements.lock.txt`.

### Versioning

- Updated root, desktop, shared packages, backend metadata, About/Help fallback, and README release path to `1.0.1`.

### Tests

- Added backend tests for confirmation validation, YAML apply parsing, multi-document blocking, and `NO_PROXY` merge logic.

### Known notes

- Full Windows portable packaging must still be smoke-tested on Windows.
- `npm audit` reports dependency vulnerabilities in the current Electron/build dependency graph; this requires separate dependency review because automatic fixes may introduce breaking changes.

### 1.0.5 packaging hotfix

- Avoid running `npm ci` a second time from `scripts/package-windows.ps1` when `node_modules` already exists.
- Keep packaging deterministic while reducing exposure to transient npm CLI failures during the portable build step.
## 1.0.5 - YAML drawer visible editor hotfix

- Restored visible YAML editor content after the drawer fill-layout change.
- Kept the drawer outer scrollbar suppressed while allowing YAML to scroll inside the editor.
- Did not change backend, dependencies, package manifests, or application version.
