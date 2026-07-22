# KubeDeck 2.5.2 — Regression Checklist

Дата: 2026-07-21

## Automated gate

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`; 31/31 tests.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway`; 73/73 tests.
- [x] `npm run verify:release`.
- [x] Release contracts: Node 50 / Python 0.
- [x] Cluster contracts и границы приватности LLM сохранены.

## 2.5.2 acceptance

- [x] Page size options содержат `50, 100, 200, 500, 1000, 2000`.
- [x] Default page size остаётся `200`.
- [x] Выбранные namespace сохраняются в результатах поиска без дубликатов.
- [x] Пустой и несовпадающий поисковые запросы сохраняют прежнюю семантику.
- [x] Новые dependencies и backend-изменения отсутствуют.

## Manual smoke

- [ ] Отобразить 2000 Pods на одной странице и проверить scrolling, sticky header, sort, resize и select-all.
- [ ] Переключить page size `2000 → 1000 → 200`.
- [ ] Найти второй namespace, снять старый и выбрать новый без очистки запроса.
- [ ] Проверить multi-select, `All namespaces`, Escape и очистку поиска.

## Acceptance

- [x] Автоматический gate KubeDeck `2.5.2` выполнен после version bump.
- [x] Версии root, desktop, shared package и lock-файла синхронизированы на `2.5.2`.
- [ ] Пользовательский smoke завершён.
