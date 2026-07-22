# KubeDeck 2.7.3

[English](./README.md) | [Русский](./README.ru.md)

KubeDeck is a desktop Kubernetes IDE for Windows and macOS. It combines resource browsing, diagnostics, YAML workflows, logs, terminals, SSH, port forwarding, and optional local LLM analysis in one Electron application.

KubeDeck uses a **Node-only runtime inside Electron**. It does not start or package a Python/FastAPI backend, and it does not bundle `kubectl`.

## Highlights

- multiple kubeconfig files and clusters with persistent manual ordering;
- namespace filtering and global search;
- built-in Kubernetes resources and CRDs;
- YAML view, edit, dry-run, and apply;
- Describe, Events, Related Resources, and Problems views;
- Pod and Deployment logs;
- Pod Terminal, Node SSH, and Port Forward;
- delete, restart, redeploy, scale, cordon, uncordon, and drain actions;
- protected Kubernetes Secret viewing;
- metrics and resource snapshot caching;
- optional OpenAI-compatible local LLM analysis that never receives Kubernetes logs;
- English and Russian UI;
- Midnight Blue, Nord Frost, Forest Teal, Plum Graphite, Warm Mocha, Light, and System themes.

## Supported platforms

| Platform | Architecture | Package | Status |
|---|---:|---|---|
| Windows 10/11 | x64 | Portable EXE | Supported |
| macOS | Apple Silicon (`arm64`) | DMG and ZIP | Supported, unsigned |
| macOS Intel | x64 | — | Not supported yet |
| Linux | — | — | Not supported yet |

## Architecture

| Layer | Technology | Responsibility |
|---|---|---|
| Desktop UI | Electron, React, TypeScript | Resource tables, drawers, YAML, logs, and terminals |
| Runtime | Node.js in the Electron main process | Local REST/WebSocket gateway, kubectl execution, cache, watch, search, diagnostics, and LLM integration |
| Kubernetes CLI | System `kubectl` | Kubernetes API access |
| Native terminal | `node-pty` | Pod Terminal and interactive sessions |
| SSH | `ssh2` | Kubernetes node connections |

The local Gateway listens on a random `127.0.0.1` port. Every HTTP and WebSocket request requires a session token.

## Requirements

- Git;
- Node.js 22.12 or newer;
- npm;
- a system `kubectl`, either in `PATH` or configured by absolute path in KubeDeck Settings;
- access to a Kubernetes cluster through kubeconfig.

Python, FastAPI, PyInstaller, and a bundled `kubectl` are not required.

### Windows

- Windows 10/11 x64;
- PowerShell 5.1 or newer.

Install `kubectl` if necessary:

```powershell
winget install -e --id Kubernetes.kubectl
kubectl version --client
```

### macOS

- Apple Silicon Mac;
- Xcode Command Line Tools;
- Homebrew;
- `kubectl` and `p7zip`.

```bash
xcode-select --install
brew install node@22 kubectl p7zip
```

## Getting started

Clone the repository and install the locked dependencies from the project root.

### Windows

```powershell
git clone https://github.com/maksimvpronin-byte/kubedeck.git
cd kubedeck
npm.cmd ci --no-audit --no-fund
npm.cmd run dev
```

Use `npm.cmd` in PowerShell to avoid the `npm.ps1` execution-policy restriction found on some Windows systems.

### macOS

```bash
git clone https://github.com/maksimvpronin-byte/kubedeck.git
cd kubedeck
npm ci --no-audit --no-fund
npm run dev
```

Do not reuse `node_modules` across operating systems: KubeDeck includes the native `node-pty` dependency.

## Verification

Run the complete source gate:

```bash
npm run verify
```

Individual commands:

| Task | Command |
|---|---|
| Lint | `npm run lint` |
| Format check | `npm run format:check` |
| TypeScript check | `npm run typecheck` |
| Renderer tests | `npm run test:renderer` |
| Gateway tests | `npm run test:gateway` |
| Production build | `npm run build` |
| Node-only release check | `npm run verify:node-only` |

## Windows portable build

```powershell
npm.cmd run package:win
```

If dependencies have not been installed yet:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-portable-windows.ps1 `
  -InstallNpmDeps
```

The builder verifies the Node-only release contract, repairs required native helpers, runs the complete source gate, builds the portable package, and validates the release payload.

Output:

```text
apps\desktop\release\KubeDeck-Portable-2.7.3-x64.exe
```

## macOS Apple Silicon build

```bash
npm run package:mac
```

Outputs:

```text
apps/desktop/release/KubeDeck-2.7.3-arm64.dmg
apps/desktop/release/KubeDeck-2.7.3-arm64.zip
```

The macOS package is not signed with an Apple Developer ID and is not notarized. On first launch, use Finder → Applications → Control-click KubeDeck → Open.

## Network troubleshooting

An `ECONNRESET` or `fetch failed` error during `npm ci` or Electron download means the network, proxy, or registry connection was interrupted. Retry with cache verification and longer npm timeouts:

```powershell
npm.cmd cache verify
npm.cmd ci `
  --no-audit `
  --no-fund `
  --prefer-offline `
  --fetch-retries=5 `
  --fetch-retry-mintimeout=20000 `
  --fetch-retry-maxtimeout=120000 `
  --fetch-timeout=300000
```

If Node.js must use proxy variables for an Electron download, enable environment proxy support only for that download process. Do not leave it enabled for the local Gateway test suite.

## kubectl and kubeconfig

KubeDeck uses either `kubectl` from `PATH` or an absolute executable path configured in Settings.

```bash
kubectl version --client
kubectl --kubeconfig /path/to/config get nodes
```

Kubeconfig files imported through the UI are copied into the application data directory. The original file is not modified.

## Application data

Windows:

```text
%APPDATA%\KubeDeck\
├── config.json
├── kubeconfigs\
└── logs\
    ├── desktop.log
    └── kubectl.log
```

macOS:

```text
~/Library/Application Support/KubeDeck/
├── config.json
├── kubeconfigs/
└── logs/
    ├── desktop.log
    └── kubectl.log
```

## Security

- the Gateway is bound only to `127.0.0.1`;
- every HTTP and WebSocket request requires a session token;
- Kubernetes Secrets and the LLM API key are not logged;
- destructive operations require confirmation;
- commands are spawned with argument arrays instead of shell interpolation;
- LLM context is sanitized before it is sent;
- release packages contain neither Python runtime nor bundled `kubectl`.

## Documentation

- [Release notes 2.7.3](./RELEASE_NOTES_2.7.3.md)
- [Regression checklist 2.7.3](./REGRESSION_CHECKLIST_2.7.3.md)
- [Node migration status](./NODE_MIGRATION_PROGRESS.md)
