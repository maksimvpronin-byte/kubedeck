# KubeDeck

KubeDeck is a Windows desktop Kubernetes IDE foundation build. It uses Electron + React for the desktop shell and a local FastAPI backend that talks to Kubernetes through `kubectl`.

Current working version: **1.0.3**.

## Current Features

- Electron desktop app with React + TypeScript renderer.
- Python FastAPI backend started as an Electron child process.
- Backend binds to `127.0.0.1` only and is protected by a per-session local token.
- AppData storage under `%APPDATA%\KubeDeck\`.
- Logs under `%APPDATA%\KubeDeck\logs\`.
- Kubeconfig import, rename, remove and last-opened cluster state.
- `kubectl` health/status check and configurable kubectl path.
- Namespace selector with stable namespace selection during pod restart/delete refreshes.
- Resource tables for Pods, Deployments, Services, Events and multiple extended resource groups.
- Resource drawer with Summary, Related, YAML, Describe, Events, Logs, Terminal and resource-specific tabs.
- Related tab shows owner, selector, storage, config, RBAC and network topology links with relation summary chips and Copy map.
- Pod logs with current/previous/timestamps/follow/search/copy/download.
- Deployment logs aggregated across all pods selected by one Deployment, with pod/container filters.
- Pod terminal through `kubectl exec` without typed pod-name confirmation.
- Port-forward modal and port-forward sessions panel.
- Secrets viewer with reveal/copy/auto-hide and audit metadata without storing secret values.
- CRD definitions are view-only; CRD instances can be inspected, edited via YAML and deleted when RBAC allows it.
- Bulk delete with full preview, copy list, fast background execution, result panel and Copy result summary.
- YAML editing with dry-run/apply, modified-draft indicator, Reset and Reload actions.
- Command preview blocks with copy action and redaction for kubeconfig/token/password-like arguments.
- Backend resource cache diagnostics and short-lived cached silent-refresh support for resource lists.
- Resource watch diagnostics for starting, stopping and inspecting kubectl watch processes; active watches invalidate affected resource-list cache entries and drive WebSocket silent refresh for the active table.
- Problems dashboard with severity/category grouping, priority diagnostic cards, affected-resource navigation and Copy diagnostics.
- Related-resource topology includes Pod config refs, owner chains, Service EndpointSlices, Endpoint/EndpointSlice target Pods and ServiceAccount secrets.
- RU/EN i18n base and dark/light/system theme setting.

## Confirmation Model

Current 1.0.3 UX intentionally avoids typed resource-name confirmation in the UI:

- Delete pod/resource: standard confirmation dialog.
- Restart pod: confirmation dialog without typing the name.
- Redeploy: confirmation dialog without typing the name.
- Scale: confirmation dialog without typing the name, but replicas are still required.
- YAML Apply: confirmation dialog without typing the name.
- Terminal tab: opens without typed pod-name confirmation.

The backend still receives confirmation metadata for mutating operations and keeps API-side safety checks such as payload limits, YAML single-object validation and `kubectl auth can-i` where implemented.

## Prerequisites

- Windows
- Node.js 20+
- Python 3.11+
- `kubectl.exe` in PATH, or a configured full path in Settings

PowerShell script execution policy may block `npm.ps1`. Use `cmd /c npm ...` or `npm.cmd ...` if that happens.

## Development

Install frontend dependencies only when the existing `node_modules` is missing or intentionally refreshed:

```powershell
npm.cmd install
```

Install backend dependencies for development:

```powershell
py -3 -m pip install -r .\apps\backend\requirements.txt
```

Run the app:

```powershell
npm.cmd run dev
```

Build TypeScript and renderer assets:

```powershell
npm.cmd run build
```

## Portable Windows Build

Build the portable Windows executable from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-windows.ps1
```

Equivalent npm command:

```powershell
npm.cmd run package:win
```

The current packaging script:

- stops running KubeDeck processes that can lock the release directory;
- verifies that required npm build executables already exist;
- does **not** automatically repair or reinstall `node_modules`;
- prepares an isolated backend build venv;
- installs backend packaging dependencies into that isolated venv;
- packages the Python backend with PyInstaller;
- builds the Electron portable executable.

If npm build tools are missing, run dependency installation explicitly from the project root before packaging. Do not run `npm ci` or dependency cleanup as part of normal feature patching unless dependency maintenance is the actual task.

Portable packaging does not bundle `kubectl.exe`. Runtime Kubernetes access uses the kubectl path configured in Settings, or `kubectl` from PATH when no explicit path is configured.

Output:

```text
apps\desktop\release\KubeDeck-Portable-1.0.3-x64.exe
```

Run the portable build by double-clicking that `.exe`. Settings, kubeconfigs, logs, and UI state are stored under `%APPDATA%\KubeDeck\`.

## 1.0.3 Stabilization Validation

Before starting the next refactor/feature stage, validate the current 1.0.3 line from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-1.0.3.ps1 -Package
```

The script runs backend validation, the desktop build, optional portable packaging and a release-output check that no `kubectl.exe` is bundled.

## kubectl Path

The default setting is `kubectl`. The portable build does not include `kubectl.exe`. If kubectl is not in PATH, open Settings and set the full path, for example:

```text
C:\Tools\kubectl\kubectl.exe
```

The packaged app uses only PATH/configured kubectl resolution.

## Local Data

```text
%APPDATA%\KubeDeck\
  config.json
  kubeconfigs\
  logs\
    desktop.log
    backend.log
    kubectl.log
```

Kubernetes resource data is not persisted to disk. The current backend resource cache is in-memory only; silent refresh can reuse fresh cached snapshots while manual refresh still forces fresh kubectl data.


### Watch/WebSocket live refresh

KubeDeck can now use `kubectl watch` events to invalidate resource-list cache and publish lightweight WebSocket events. The active table auto-starts/reuses a watch for the current cluster/resource/namespace and performs a debounced silent refresh when matching events arrive. Regular HTTP polling remains enabled as a fallback.

## Build From Fresh Clone

```powershell
git clone https://github.com/maksimvpronin-byte/kubedeck.git
cd kubedeck

npm.cmd install
py -3 -m pip install -r .\apps\backend\requirements.txt

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-1.0.3.ps1 -Package
```

The portable build will be created in:

```text
apps\desktop\release
```

KubeDeck portable does not bundle `kubectl.exe`. Install `kubectl` separately and make it available in `PATH`, or configure the kubectl path in KubeDeck Settings.

Do not commit local build artifacts such as `node_modules`, `.build-venv`, `apps/desktop/release`, `apps/desktop/dist`, backup folders, archives, logs, or local `kubectl.exe` binaries.
