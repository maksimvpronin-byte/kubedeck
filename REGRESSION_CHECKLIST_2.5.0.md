# KubeDeck 2.5.0 — Regression Checklist

Дата: 2026-07-21

## Automated gate

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`; 27/27 tests.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway`; 73/73 tests.
- [x] `npm run verify:release`.
- [x] Release contracts: Node 50 / Python 0.
- [x] Cluster contracts и границы приватности LLM сохранены.

## Cleanup acceptance

- [x] Каждый удалённый кандидат подтверждён двумя независимыми проверками.
- [x] Строгий TypeScript unused-анализ чист для main/preload и renderer.
- [x] Второй import/export/locale/dependency/script проход не нашёл новых доказанных кандидатов.
- [x] Действующий PTY terminal transport и отказ без `node-pty` сохранены.
- [x] Новые dependencies и пользовательские возможности не добавлены.

## Manual smoke

- [x] Пользователь подтвердил, что приложение и затронутые сценарии работают после cleanup.
- [ ] Проверить финальные Windows/macOS packaged artifacts после их сборки.

## Acceptance

- [x] Автоматические контракты KubeDeck `2.5.0` выполнены после version bump.
- [x] Версии root, desktop, shared package и lock-файла синхронизированы на `2.5.0`.
- [ ] Финальные packaged artifacts проверены.
