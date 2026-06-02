# KubeDeck 1.0.1 Stabilization Plan

## Goal

Version 1.0.1 is a stabilization release for the 1.0.0 foundation build. It focuses on safety gates, version consistency, reproducible packaging inputs, and a small backend regression-test baseline.

## Completed scope

### P0 — Dangerous-operation confirmation

- YAML apply now requires a backend-side `OperationConfirmation`.
- YAML apply is limited to one Kubernetes object per request in 1.0.1.
- The backend parses the YAML payload and verifies `kind`, `metadata.namespace`, and `metadata.name` before running `kubectl apply -f -`.
- Resource actions keep command previews and backend confirmation metadata. Restart/redeploy/scale require typed resource-name confirmation; delete keeps the original standard confirmation dialog without requiring the user to type the resource name.
- Pod terminal typed confirmation was introduced in 1.0.1 but later removed in the 1.0.3 terminal UX hotfix.

### P1 — Version consistency

- Root package version updated to `1.0.1`.
- Desktop package version updated to `1.0.1`.
- Shared package versions updated to `1.0.1`.
- Backend `pyproject.toml`, `__version__`, FastAPI metadata, `/app/info`, Help panel, and README output examples updated to `1.0.1`.

### P1 — Backend regression tests

Added tests for:

- typed operation confirmation success/failure for apply/restart/redeploy/scale/exec endpoint plus standard confirmation for delete and direct Terminal-tab opening;
- YAML apply target extraction;
- multi-document YAML apply blocking;
- `NO_PROXY` merge de-duplication.

### P1 — Dependency and packaging hardening

- Python runtime dependencies pinned in `requirements.txt`.
- `requirements.lock.txt` added with the same pinned set.
- `kubectl.exe.sha256` added.
- Windows packaging now enforces `kubectl.exe` SHA256 from either `KUBEDECK_KUBECTL_SHA256` or `kubectl.exe.sha256`.

## Validation performed

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run typecheck
npm.cmd run build
py -3 -m compileall apps/backend/kubedeck_backend
py -3 -m pytest apps/backend/tests
```

In the Linux validation environment, equivalent `npm`, `python3 -m compileall`, and `pytest` commands passed. Full Windows `electron-builder --win` packaging was not run in this environment.

## Deferred to 1.0.2+

- Split `PodDrawer.tsx` into tab/modal components.
- Split backend `api/common.py` into smaller modules.
- Move renderer contracts to `packages/shared-types` or remove the unused package.
- Investigate Electron renderer `sandbox: true`.
- Add frontend unit tests.
- Reduce Vite chunk size via code-splitting/manual chunks.
