# KubeDeck 2.4.3 — Regression Checklist

Дата: 2026-07-16

## Automated gate

- [x] `npm run verify:release`.
- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`; 24/24 tests.
- [x] `npm run typecheck`.
- [x] `npm run build` после финальных изменений.
- [x] `npm --workspace apps/desktop run test:gateway`; 70/70 tests.
- [x] Release contracts: Node 50 / Python 0.

## Namespace and drawer contracts

- [x] Single и multi-select namespaces хранятся раздельно по `clusterId`.
- [x] Новый кластер использует `all`; сохранённый кластер восстанавливает собственную выборку.
- [x] Удалённые namespaces фильтруются, временный пустой list не сбрасывает память.
- [x] `_cluster` не затирает namespaced-выбор активного кластера.
- [x] Поздние ответы предыдущего cluster/object игнорируются.
- [x] Drawer использует атомарную цель `clusterId + resource + row`.
- [x] Смена cluster/resource немедленно скрывает несовпадающую выбранную строку.
- [x] Snapshot старого drawer не показывается во время reset новой identity.
- [x] Auto-refresh прежней identity не сбрасывает drawer.
- [x] Cluster Selector использует тематизированное in-app меню вместо нативного системного popup.

## Manual UI smoke

- [ ] В cluster A выбрать один namespace, в cluster B другой и несколько раз переключиться.
- [ ] Повторить сценарий с multi-select namespaces.
- [ ] Проверить новый кластер и fallback после удаления сохранённого namespace.
- [ ] Проверить namespaced resource → Nodes → namespaced resource.
- [ ] Проверить Secret → Pod на Summary, YAML, Related, LLM, Events и Logs.
- [ ] Быстро выбрать несколько строк и убедиться, что старые данные не возвращаются.
- [ ] Переключить кластер с открытым drawer.
- [ ] Проверить несколько циклов auto-refresh с открытым drawer.
- [ ] Проверить Light и одну тёмную тему.
- [ ] Проверить открытие Cluster Selector, выбор, Escape и закрытие по клику снаружи.

## Packaged artifacts

- [x] macOS arm64 DMG/ZIP собраны и прошли автоматическую payload-проверку.
- [ ] Windows Portable x64 собран на Windows и прошёл payload-проверку.
- [ ] Ручной packaged smoke отмечается после проверки соответствующей ОС.

## Acceptance

- [x] Все автоматические контракты KubeDeck `2.4.3` выполнены.
- [x] Имена и build metadata macOS/Windows синхронизированы на `2.4.3`.
- [ ] Cross-platform packaged smoke закрывается после ручной проверки artifacts.
