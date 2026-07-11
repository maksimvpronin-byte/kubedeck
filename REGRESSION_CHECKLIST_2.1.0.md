# KubeDeck 2.1.0 — Regression Checklist

Дата: 2026-07-10

## Automated gate

- [x] `npm run typecheck`.
- [x] `npm run build`; основной JS chunk меньше 500 KB.
- [x] `npm --workspace apps/desktop run test:gateway`; 69/69 tests.
- [x] `npm run test:renderer`; 9/9 focused controller tests.
- [x] Release contracts: `node-only`, Node 49 / Python 0.
- [x] macOS release validator: payload не содержит Python runtime и встроенный kubectl.
- [x] Electron 43.1.0 runtime: Chromium 150.0.7871.47, Node 24.18.0, node-pty arm64 load.

## Desktop runtime

- [x] Приложение запускается с `sandbox: true`.
- [x] File dialogs, Settings folder actions и About diagnostics работают.
- [x] Неожиданная renderer navigation блокируется.
- [x] Lazy-loaded Settings, Help, About, Problems, Audit, Port Forward и drawer открываются повторно.

## Kubernetes workflows

- [x] Cluster import/open/remove/rename.
- [x] Namespace selection, resource refresh, cache и watch-driven update.
- [x] Global Search и Problems.
- [x] Related Resources packaged smoke.
- [x] LLM status, connection test, prompt preview и resource analysis без утечки sensitive context.
- [x] YAML dry-run/apply и multi-document rejection.
- [x] Delete/restart/redeploy/scale и RBAC-denied paths.
- [x] Secret reveal/copy/auto-hide без value в logs/audit.
- [x] Pod Terminal input, paste, navigation keys, resize и reconnect.
- [x] Node SSH password/key/jump-host paths.
- [x] Port Forward start/open/stop и shutdown cleanup.

## UI and platforms

- [x] Table resize/reorder/visibility/reset сохраняются между sessions.
- [x] Drawer tabs и resource selection не регрессировали.
- [x] Dark/light/system theme.
- [x] ru/en/system language.
- [x] Windows portable x64 smoke.
- [x] macOS arm64 DMG/ZIP smoke.
- [x] macOS arm64 DMG/ZIP packaging и artifact validation.

## Acceptance

- [x] KubeDeck `2.1.0` принят как стабильный релиз.

## Evidence

- 2026-07-10 packaged macOS run: desktop/gateway startup and clean shutdown; saved cluster open; namespaces, Pod list and watch refresh; Logs, Events, Describe, YAML, Related and Pod Terminal PTY observed in `desktop.log`.
- 2026-07-10 post-refactor gates: renderer 5/5, typecheck, build and gateway 69/69; automated visual browser was unavailable before user acceptance.
- 2026-07-10 user acceptance: packaged macOS UI and interactive scenarios confirmed working; Windows acceptance deferred.
- 2026-07-10 Electron upgrade smoke: packaged Electron 43 startup/shutdown, cluster open, watch, Pod Terminal PTY, Logs, Events, Describe, YAML and Related observed; DMG 116 MB, ZIP 112 MB.
- 2026-07-10 user acceptance: rebuilt Electron 43 macOS application launched and functional UI/interactive flows confirmed working.
- 2026-07-11 user acceptance: Windows portable build and smoke accepted; KubeDeck 2.1.0 cross-platform acceptance completed.
