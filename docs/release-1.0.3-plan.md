# KubeDeck 1.0.3 Current State and Follow-up Plan

> Archived release plan. It describes the retired Python/FastAPI-based 1.0.3 line and must not be used as current build or architecture guidance.

This document tracks the current stabilized `1.0.3` line. Dependency cleanup remains on hold until a dedicated maintenance window is approved.

## Current fixed constraints

- Keep the working project directory: `C:\Users\Fidel\Kubedeck-agent 1.0.3`.
- Keep application version `1.0.3` for now.
- Deliver future work as small patch ZIPs over the current project.
- Do not touch `node_modules`, `package.json`, `package-lock.json`, Electron, Vite, electron-builder, or TypeScript unless dependency maintenance is the actual task.
- Do not run `npm ci` as part of normal feature/hotfix patching.

## Current dependency state

The project is on the stable toolchain:

- Electron `31.7.7`
- Vite `^5.4.11`
- electron-builder `^24.13.3`
- TypeScript `^5.7.2`

Dependency cleanup remains on hold.

## Completed 1.0.3 work

- Split `PodDrawer.tsx` into Terminal, Logs, YAML, Describe, Events, Related, PortForward and modal components.
- Reduced backend `api/common.py` by extracting validation, runtime, terminal, port-forward, search, problems and relations helpers.
- Removed manual typed-name confirmation from Terminal, Restart, Redeploy, Scale and YAML Apply UI flows.
- Added stable namespace selection during refresh/restart/delete scenarios.
- Added refresh interval UX with Off / 10 sec / 30 sec / 60 sec.
- Added YAML modified-draft protection with Reset and Reload actions.
- Added Describe tab fill-layout scrolling matching the YAML tab behavior.
- Improved empty/error states.
- Improved command preview blocks and redaction.
- Added Secrets viewer with reveal/copy/auto-hide and safe audit metadata.
- Added CRD definitions view-only behavior and improved CRD instances UX.
- Hardened bulk delete preview, partial failure reporting and result summary panel.
- Added non-blocking single delete/restart and bulk-delete confirmation UX.
- Added Deployment-level aggregated logs across all pods selected by one Deployment.
- Added backend resource cache diagnostics and discovery/resource-list snapshots.
- Added resource-list cache invalidation after mutating actions and YAML apply.
- Added watch diagnostics UI for backend `kubectl watch` sessions.
- Connected `kubectl watch` events to resource-list cache invalidation.
- Added WebSocket resource-watch event streaming and active-table silent refresh.
- Removed bundled/root-level `kubectl.exe` from portable packaging; runtime uses Settings path or PATH.
- Improved Problems dashboard with category grouping, priority diagnostic cards, affected-resource navigation and Copy diagnostics.
- Improved Related resources topology with Pod config refs, owner chains, Service EndpointSlices, Endpoint/EndpointSlice targets, ServiceAccount secrets and Copy map.

## Current confirmation behavior

- Delete: standard confirmation dialog, no typed name, closes immediately after confirm.
- Restart: confirmation dialog, no typed name, closes immediately after confirm.
- Redeploy: confirmation dialog, no typed name.
- Scale: confirmation dialog, no typed name; replicas are still required.
- YAML Apply: confirmation dialog, no typed name.
- Terminal: no typed pod-name confirmation.
- Bulk delete: preview + copy list, closes immediately after confirm, runs in the background and reports success/failure details in a dedicated result panel.

Backend confirmation metadata and safety checks are still used.

## Remaining plan

1. Broader resource coverage and CRD-instance UX improvements where needed.
2. Resource action safety polish: clearer command previews, can-i diagnostics and confirmation copy for high-risk actions.
3. Dependency cleanup as a separate maintenance window.

## kubectl packaging state

Portable packaging no longer bundles `kubectl.exe` from the repository root through `electron-builder` `extraResources`. Implemented behavior:

- removed `kubectl.exe` from portable `extraResources`;
- stopped passing packaged `resources/bin/kubectl.exe` as the default backend kubectl path;
- kept Settings-based kubectl path configuration;
- kept PATH-based `kubectl` resolution;
- updated docs/error text to explain user-provided kubectl only;
- `kubectl.exe.sha256` is no longer used by packaging and can be deleted from working copies.

## Validation baseline

Use the stabilization gate script from the project root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-1.0.3.ps1 -Package
```

The script validates:

- portable packaging config does not bundle root-level `kubectl.exe`;
- Electron main process does not inject a packaged kubectl path;
- backend modules compile;
- backend tests pass;
- desktop TypeScript/Vite build passes;
- optional portable packaging completes;
- packaged release output contains no `kubectl.exe` or `kubectl.exe.sha256`.

Equivalent manual commands:

```powershell
npm.cmd run build
py -3 -m compileall .\apps\backend\kubedeck_backend
py -3 -m pytest .\apps\backend\tests
npm.cmd run package:win
```
