# KubeDeck 2.1.0 — Regression Checklist

Дата: 2026-07-10

## Automated gate

- [x] `npm run typecheck`.
- [x] `npm run build`; основной JS chunk меньше 500 KB.
- [x] `npm --workspace apps/desktop run test:gateway`; 69/69 tests.
- [x] Release contracts: `node-only`, Node 49 / Python 0.
- [x] macOS release validator: payload не содержит Python runtime и встроенный kubectl.

## Desktop runtime

- [ ] Приложение запускается с `sandbox: true`.
- [ ] File dialogs, Settings folder actions и About diagnostics работают.
- [ ] Неожиданная renderer navigation блокируется.
- [ ] Lazy-loaded Settings, Help, About, Problems, Audit, Port Forward и drawer открываются повторно.

## Kubernetes workflows

- [ ] Cluster import/open/remove/rename.
- [ ] Namespace selection, resource refresh, cache и watch-driven update.
- [ ] Global Search, Problems и Related Resources.
- [ ] LLM status, connection test, prompt preview и resource analysis без утечки sensitive context.
- [ ] YAML dry-run/apply и multi-document rejection.
- [ ] Delete/restart/redeploy/scale и RBAC-denied paths.
- [ ] Secret reveal/copy/auto-hide без value в logs/audit.
- [ ] Pod Terminal input, paste, navigation keys, resize и reconnect.
- [ ] Node SSH password/key/jump-host paths.
- [ ] Port Forward start/open/stop и shutdown cleanup.

## UI and platforms

- [ ] Table resize/reorder/visibility/reset сохраняются между sessions.
- [ ] Drawer tabs и resource selection не регрессировали.
- [ ] Dark/light/system theme.
- [ ] ru/en/system language.
- [ ] Windows portable x64 smoke.
- [ ] macOS arm64 DMG/ZIP smoke.
- [x] macOS arm64 DMG/ZIP packaging и artifact validation.

## Acceptance

- [ ] KubeDeck `2.1.0` принят как стабильный релиз.
