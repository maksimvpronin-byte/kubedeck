# KubeDeck 2.4.1 — Regression Checklist

Дата: 2026-07-15

## Automated gate

- [x] `npm run verify:release`.
- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`; 20/20 tests.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway`; 70/70 tests.
- [x] Release contracts: Node 50 / Python 0.

## Drawer contracts

- [x] Новый object reference строки с прежней identity не перезапускает drawer lifecycle.
- [x] Смена cluster, resource, namespace, name или uid выполняет полный reset.
- [x] YAML после первой загрузки обновляется только вручную и сохраняет несохранённый draft.
- [x] Request generation и AbortController продолжают блокировать stale responses.
- [x] YAML operation-output и `Copy output` удалены.
- [x] Dry-run и Apply используют компактный локализованный status.
- [x] Ошибки операций остаются в копируемом ErrorPanel.

## Manual UI smoke

- [x] Оставить drawer открытым минимум на три цикла auto-refresh без визуального рывка.
- [x] Проверить Summary, YAML, Describe, Events, Related и Logs.
- [x] Проверить сохранение YAML scroll, search, focus и изменённого draft.
- [ ] Проверить Reload, Dry-run и Apply в success/error состояниях.
- [ ] Проверить Apply confirmation и read-only CRD.
- [ ] Проверить Light и все тёмные темы.
- [ ] Проверить LLM preview/analyze: Kubernetes logs не попадают в LLM-контекст.

## Packaged artifacts

- [x] macOS arm64 DMG/ZIP собраны и прошли автоматическую payload-проверку.
- [ ] Windows Portable x64 собран на Windows и прошёл payload-проверку.
- [ ] Ручной packaged smoke отмечается после проверки соответствующей ОС.

## Acceptance

- [x] Все автоматические контракты KubeDeck `2.4.1` выполнены.
- [x] Имена и build metadata macOS/Windows синхронизированы на `2.4.1`.
- [ ] Cross-platform packaged smoke закрывается после ручной проверки artifacts.
