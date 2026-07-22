# KubeDeck 2.4.2 — Regression Checklist

Дата: 2026-07-16

## Automated gate

- [x] `npm run verify:release`.
- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`; 21/21 tests.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway`; 70/70 tests.
- [x] Release contracts: Node 50 / Python 0.

## Bulk delete contracts

- [x] Successful bulk delete не создаёт action status.
- [x] Partial/full failure используют ErrorPanel без дублирующей зелёной панели.
- [x] Reload выполняется после всех попыток удаления.
- [x] Deleted selected row закрывается; failed selected row восстанавливается.
- [x] Secret-like failure details редактируются.
- [x] Confirmation modal, Copy list и `Terminating` сохранены.
- [x] Node actions используют отдельный status и сохраняют `Close`.
- [x] Мёртвые bulk result CSS и locale keys удалены.

## Manual UI smoke

- [ ] Проверить открытие cluster и обновление Resource Table после удаления.
- [ ] Удалить один ресурс: строка исчезает, зелёного окна нет.
- [ ] Удалить несколько ресурсов: строки исчезают, зелёного окна нет.
- [ ] Проверить медленное удаление и `Terminating`.
- [ ] Проверить partial и full failure через ErrorPanel.
- [ ] Проверить selected drawer для success и failure.
- [ ] Проверить Drain/Cordon/Uncordon status и `Close`.
- [ ] Проверить Light и одну тёмную тему.
- [ ] Проверить LLM preview/analyze: Kubernetes logs не попадают в LLM-контекст.

## Packaged artifacts

- [x] macOS arm64 DMG/ZIP собраны и прошли автоматическую payload-проверку.
- [ ] Windows Portable x64 собран на Windows и прошёл payload-проверку.
- [ ] Ручной packaged smoke отмечается после проверки соответствующей ОС.

## Acceptance

- [x] Все автоматические контракты KubeDeck `2.4.2` выполнены.
- [x] Имена и build metadata macOS/Windows синхронизированы на `2.4.2`.
- [ ] Cross-platform packaged smoke закрывается после ручной проверки artifacts.
