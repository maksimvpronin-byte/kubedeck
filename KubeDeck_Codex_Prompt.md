# Prompt for Codex / development agent

You are a senior full-stack desktop engineer. Build the foundation of **KubeDeck**, a Windows Kubernetes IDE built on top of system `kubectl`.

Read the attached `KubeDeck_Technical_Specification.md` carefully and treat it as the source of truth.

## Product summary

KubeDeck is a Windows desktop Kubernetes IDE inspired by Lens/OpenLens, but focused on operations, diagnostics, relationships between Kubernetes resources, safe actions, logs, pod terminal, port-forward, YAML dry-run/diff/apply, CRD browsing, and future LLM-assisted diagnostics.

The app must use the system `kubectl`; do not use the Kubernetes API as the primary transport.

## Required foundation build

Implement the **Foundation build**, not the full product.

The foundation build must include:

### Desktop shell

- Electron desktop app.
- React + TypeScript renderer.
- Dark-first IDE-style layout.
- Top bar with cluster selector placeholder, namespace selector placeholder, global search placeholder.
- Sidebar with main sections:
  - Overview
  - Problems
  - Workloads
  - Network
  - Storage
  - Config
  - CRD
  - Events
  - Port Forwards
  - Terminal
  - Settings
- Tabs area.
- Basic RU/EN i18n infrastructure.
- Theme setting: dark/light/system.

### Backend

- Python FastAPI backend.
- Electron must start the backend as a child process.
- Backend must bind only to `127.0.0.1`.
- Backend port must be passed/discovered by Electron.
- Health endpoint:
  - `GET /health`
- Kubectl status endpoint:
  - `GET /kubectl/status`
- App/backend logs written under:
  - `%APPDATA%\KubeDeck\logs\`

### Local storage

Use:

```text
%APPDATA%\KubeDeck\
├─ config.json
├─ kubeconfigs\
└─ logs\
```

Implement config management for:

```json
{
  "clusters": [],
  "settings": {
    "kubectlPath": "kubectl",
    "language": "system",
    "theme": "system",
    "refreshIntervalSeconds": 10,
    "logsTailLines": 500,
    "secretRevealTimeoutSeconds": 30,
    "restartProblemThreshold": 3,
    "terminalFontSize": 13,
    "logsSince": "",
    "llm": {
      "enabled": false,
      "baseUrl": "",
      "model": "",
      "apiKeyRef": ""
    }
  }
}
```

### Cluster management

Implement:

- Import kubeconfig from UI.
- Copy imported kubeconfig into `%APPDATA%\KubeDeck\kubeconfigs\<cluster-id>.yaml`.
- One imported kubeconfig equals one KubeDeck cluster.
- Cluster list.
- Rename cluster.
- Remove cluster, including deleting copied kubeconfig.
- Store last opened cluster.
- On app startup, try to open the last opened cluster.
- If unavailable, show a Cluster Unavailable screen with raw error.

### Kubectl

Use system `kubectl`.

Startup check:

```bash
kubectl version --client -o json
```

Cluster open check:

```bash
kubectl --kubeconfig <file> cluster-info
kubectl --kubeconfig <file> get namespaces -o json
```

All kubectl errors must expose:

- human readable message;
- raw stderr;
- command preview;
- copy error action in UI.

Create a reusable kubectl command abstraction in code, even if only partially used in foundation build.

### Kubernetes foundation resources

Implement through `kubectl`:

- namespaces;
- pods;
- deployments;
- services;
- events.

Required UI:

- namespace selector;
- pods table;
- deployments table;
- services table;
- events page;
- pod details drawer.

Pod details drawer must include:

- Summary;
- YAML;
- Describe;
- Logs current;
- Logs follow if practical in foundation build.

Commands:

```bash
kubectl --kubeconfig <file> get namespaces -o json
kubectl --kubeconfig <file> get pods -A -o json
kubectl --kubeconfig <file> get deployments -A -o json
kubectl --kubeconfig <file> get services -A -o json
kubectl --kubeconfig <file> get events -A -o json
kubectl --kubeconfig <file> get pod <name> -n <namespace> -o yaml
kubectl --kubeconfig <file> describe pod <name> -n <namespace>
kubectl --kubeconfig <file> logs <pod> -n <namespace> --tail=500
kubectl --kubeconfig <file> logs <pod> -n <namespace> -f --tail=500
```

### Tables

Resource tables must have the architecture for:

- search;
- sort;
- filters;
- bulk select;
- context menu;
- refresh;
- open details drawer;
- virtualization-ready structure.

CSV export is not required.

### Logging

Implement app logs early because they are required for debugging.

Write logs to:

```text
%APPDATA%\KubeDeck\logs\
```

At minimum:

- desktop startup/shutdown;
- backend startup/shutdown;
- kubectl command preview;
- kubectl stderr summary;
- backend errors;
- cluster import/open errors.

Do not log Secret values or sensitive kubeconfig content.

## Monorepo structure

Create a monorepo similar to:

```text
kubedeck/
├─ apps/
│  ├─ desktop/
│  └─ backend/
├─ packages/
│  ├─ shared-types/
│  └─ ui/
├─ docs/
├─ scripts/
└─ README.md
```

You may simplify package tooling if needed, but preserve clear separation between desktop and backend.

## Important architecture rules

1. Do not block the UI with long kubectl commands.
2. Backend must bind only to localhost.
3. Use system kubectl, do not bundle kubectl.
4. Do not persist Kubernetes resource cache to disk.
5. Do not persist opened tabs after restart.
6. Do not implement auto-updater.
7. Leave placeholders/modules for:
   - Problems engine;
   - Relations engine;
   - CRD support;
   - Metrics;
   - LLM bridge.
8. Use clear code boundaries so future stages can add:
   - pod terminal via kubectl exec;
   - port-forward;
   - YAML editor with dry-run/diff/apply;
   - command palette;
   - global search;
   - dangerous action confirmations;
   - `kubectl auth can-i`.

## Deliverables

Produce:

1. Initial monorepo.
2. Desktop app that starts.
3. Python backend that starts as child process.
4. Health check working.
5. Kubectl check working.
6. AppData config/log/kubeconfig directories created.
7. Kubeconfig import working.
8. Cluster list/rename/remove working.
9. Open cluster flow working.
10. Namespace selector working.
11. Pods/deployments/services/events visible.
12. Pod detail drawer with YAML/Describe/Logs.
13. README with development instructions.
14. Short architecture document in `docs/architecture.md`.

## Development style

- Prefer simple, maintainable code over clever abstractions.
- Add type definitions for shared API models.
- Keep error handling explicit.
- Log important lifecycle and kubectl events.
- Make placeholders obvious with TODO comments.
- Do not implement unrelated features beyond the foundation build.
