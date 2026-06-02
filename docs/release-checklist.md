# KubeDeck release checklist

This checklist describes the current 1.0.3 patch workflow. Dependencies are intentionally not refreshed during normal feature/hotfix work.

## Before packaging

Check that the project is still on version `1.0.3`:

```powershell
(Get-Content .\package.json -Raw | ConvertFrom-Json).version
(Get-Content .\apps\desktop\package.json -Raw | ConvertFrom-Json).version
```

Run validation from the repository root:

```powershell
npm.cmd run typecheck
npm.cmd run build
py -3 -m compileall .\apps\backend\kubedeck_backend
py -3 -m pytest .\apps\backend\tests
npm.cmd run package:win
```

Do not run `npm ci`, `npm audit fix`, Electron/Vite upgrades, or package-lock changes unless the task is explicitly dependency maintenance.

## After packaging

Smoke-test the portable executable:

1. Start the app and confirm backend status is `ok`.
2. Open a kubeconfig-backed cluster.
3. Verify namespace refresh and resource refresh.
4. Open a Pod drawer.
5. Check Summary, YAML, Describe, Events, Related, Logs and Terminal.
6. Verify Terminal opens without typed pod-name confirmation and connects to `kubectl exec`.
7. Verify Restart pod opens confirmation without typing the pod name.
8. Verify Delete pod opens standard confirmation without typing the pod name.
9. Verify Deployment drawer has Logs and can aggregate logs from all selected pods.
10. Verify Deployment logs pod/container filters work.
11. Verify YAML Apply opens confirmation without typing the object name and still blocks multi-document YAML.
12. Verify Secrets drawer tab lists keys without decoded values by default.
13. Verify Secret Reveal/Hide/Copy works and auto-hide hides revealed values.
14. Verify CRD definitions are view-only.
15. Verify CRD instances can open YAML and can be deleted when RBAC allows it.
16. Verify bulk delete shows the full preview and partial failure reporting.
17. Verify Global Search with `Ctrl+K`.
18. Verify Problems dashboard.
19. Verify Related tab.
20. Open About and copy diagnostics if needed.

The About screen exposes local paths for config, kubeconfigs and logs. It must not copy kubeconfig contents or secret values.

## Packaging notes

The packaging script currently fails fast when npm build tools are missing. It does not repair `node_modules` automatically.

Portable builds must not include root-level `kubectl.exe`. Verify kubectl access through Settings path or PATH-based resolution.
