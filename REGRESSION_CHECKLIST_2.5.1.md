# KubeDeck 2.5.1 — Regression Checklist

Дата: 2026-07-21

## Automated gate

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`; 29/29 tests.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway`; 73/73 tests.
- [x] `npm run verify:release`.
- [x] Release contracts: Node 50 / Python 0.
- [x] Cluster contracts и границы приватности LLM сохранены.

## Pod watch and table acceptance

- [x] Polling helper отключает interval только при здоровом watch и сохраняет настройку `0`.
- [x] Watch command использует `--watch-only=true` во всех namespace scopes.
- [x] Watch deduplication, cache invalidation, event publication и shutdown contracts проходят.
- [x] Resource table сохраняет единственный `<table>` и sticky header внутри `.table-scroll`.
- [x] Новые зависимости и архитектурные слои не добавлены.

## Manual smoke

- [ ] При здоровом watch повторного polling дольше одного interval нет.
- [ ] После остановки watch polling fallback возобновляется.
- [ ] Реальное изменение pod вызывает один debounced refresh; ручной Refresh работает.
- [ ] На 710+ pod заголовок виден после вертикальной прокрутки, включая горизонтальный scroll, resize, reorder и sort.

## Acceptance

- [x] Автоматические контракты KubeDeck `2.5.1` выполнены после version bump.
- [x] Версии root, desktop, shared package и lock-файла синхронизированы на `2.5.1`.
- [ ] Пользовательский smoke завершён.
