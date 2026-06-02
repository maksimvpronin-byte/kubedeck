# Roadmap after current 1.0.3 stabilization

This roadmap assumes the current project directory stays unchanged and the app version remains `1.0.3` until a deliberate version bump is approved.

## Work rules

- Deliver small patch ZIPs over the existing project directory.
- Keep dependency cleanup on hold.
- Do not touch `node_modules`, `package-lock.json`, Electron, Vite or electron-builder during normal feature work.
- Keep manual PowerShell apply/build instructions with every patch.

## Completed work in the current 1.0.3 line

1. DONE: Delete pod / restart fast-confirm UX.
2. DONE: Cache diagnostics UI.
3. DONE: Cache invalidation helpers after mutating actions.
4. DONE: Cache use for safe discovery/reference data.
5. DONE: Controlled resource-list cache with small TTL.
6. DONE: Watch manager foundation.
7. DONE: Watch diagnostics UI.
8. DONE: Watch-to-cache invalidation integration.
9. DONE: WebSocket resource updates foundation.
10. DONE: UI live updates over WebSocket with polling fallback.
11. DONE: Removed bundled `kubectl.exe` from the portable build; runtime uses system/configured kubectl.
12. DONE: Deployment-level logs across all pods selected by one Deployment.
13. DONE: Describe tab scroll/layout aligned with YAML tab behavior.
14. DONE: Bulk delete fast-confirm/background execution.
15. DONE: Bulk delete result panel with success/failure counts, failed-item details and Copy result.
16. DONE: Problems dashboard category grouping, priority cards, affected-resource navigation and Copy diagnostics.
17. DONE: Relations engine polish for Pod config refs, owner chains, Service EndpointSlices, Endpoint/EndpointSlice targets, ServiceAccount secrets and Related Copy map.

## Current stabilization gate

Before starting new feature work, finish the 1.0.3 stabilization gate:

1. Apply patches through Patch 10.
2. Run backend compile/tests and the desktop build.
3. Build the portable package.
4. Verify the release output does not contain `kubectl.exe` or `kubectl.exe.sha256`.
5. Run the manual smoke checklist from `scripts/validate-1.0.3.ps1`.

Recommended command from the project root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-1.0.3.ps1 -Package
```

## Next planned work after stabilization

1. 1.0.4 refactor / tech debt pass:
   - split `App.tsx` into smaller hooks/components;
   - isolate bulk-action state/result handling;
   - isolate watch/live-refresh state;
   - reduce drawer/table coupling.
2. Resource coverage polish for additional built-in resources and CRD instance actions.
3. Resource action safety polish: clearer command previews, can-i diagnostics and confirmation copy for high-risk actions.
4. Dependency cleanup as a separate maintenance window.

## kubectl unbundling state

The portable app no longer ships a mounted/bundled `kubectl.exe`. Current behavior:

- use `kubectl` from PATH by default;
- allow explicit full path in Settings;
- show actionable error if kubectl is missing;
- do not include root-level `kubectl.exe` in `extraResources`;
- do not set `KUBEDECK_KUBECTL_PATH` to `resources/bin/kubectl.exe`;
- no packaging hash enforcement is required because kubectl is not bundled.

## Watch/cache/WebSocket state

The active resource table can auto-start/reuse a backend `kubectl watch` for the current cluster/resource/namespace. Watch reader threads parse `--output-watch-events=true` lines, invalidate matching `ResourceSnapshotCache` entries and publish lightweight WebSocket events. The renderer performs a debounced silent refresh after matching events. HTTP polling remains enabled as the safe fallback.
