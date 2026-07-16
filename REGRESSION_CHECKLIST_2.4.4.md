# KubeDeck 2.4.4 — Regression Checklist

Дата: 2026-07-16

## Automated gate

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`; 25/25 tests.
- [x] `npm run typecheck`.
- [x] `npm run build` после финальных изменений.
- [x] `npm --workspace apps/desktop run test:gateway`; 70/70 tests.
- [x] Release contracts: Node 50 / Python 0.
- [x] Полная Gateway suite сохраняет cluster-контракты и границы приватности LLM.

## Terminal paste contract

- [x] Pod Terminal использует `terminal.onData()` как единственный маршрут отправки вставленного текста.
- [x] В renderer отсутствует ручное чтение clipboard для вставки.
- [x] В renderer отсутствует дополнительный DOM-обработчик `paste`.
- [x] Backend передаёт каждое входящее `input` терминалу ровно один раз.

## Manual packaged smoke

- [ ] Windows: одна вставка через `Ctrl+V` появляется в Pod Terminal ровно один раз.
- [ ] Windows: проверить `Ctrl+Shift+V` и `Shift+Insert`.
- [ ] Windows: проверить многострочный текст, кириллицу и повторные быстрые вставки.
- [ ] macOS: проверить `Cmd+V` в Pod Terminal.
- [ ] Проверить обычный ввод, копирование и изменение размера терминала.

## Acceptance

- [x] Автоматические контракты KubeDeck `2.4.4` выполнены.
- [x] Версии root, desktop, shared package и lock-файла синхронизированы на `2.4.4`.
- [ ] Windows packaged smoke закрывается после ручной проверки artifact.
