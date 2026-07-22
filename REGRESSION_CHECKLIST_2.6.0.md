# KubeDeck 2.6.0 — Regression Checklist

Дата: 2026-07-21

## Automated gate

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`; 33/33 tests.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway`; 73/73 tests.
- [x] `npm run verify:release`.
- [x] Release contracts: Node 50 / Python 0.
- [x] Cluster contracts и границы приватности LLM сохранены.

## Pinned terminal acceptance

- [x] Terminal owner расположен вне resource drawer identity boundary.
- [x] Collapse сохраняет смонтированный `TerminalTab`.
- [x] Target содержит cluster, namespace, pod и container identity.
- [x] Повторный запуск другого target требует подтверждения.
- [x] Pod drawer больше не владеет `TerminalTab`.
- [x] Native resize сохраняет ширину и высоту через существующий UI state.
- [x] Новые зависимости и backend routes отсутствуют.

## Manual smoke

- [ ] Запустить netshoot terminal и перейти к другому Pod, Service, Deployment и Node.
- [ ] Свернуть и развернуть panel; ввод, вывод и scrollback сохраняются.
- [ ] Изменить размер panel, закрыть terminal и открыть снова; ширина и высота восстановлены.
- [ ] Переключить cluster; исходная terminal-сессия остаётся доступной и правильно подписана.
- [ ] Закрыть terminal и проверить завершение сессии.
- [ ] Запустить другой terminal и проверить подтверждение замены.

## Acceptance

- [x] Автоматический gate KubeDeck `2.6.0` выполнен после version bump.
- [x] Версии root, desktop, shared package и lock-файла синхронизированы на `2.6.0`.
- [ ] Пользовательский smoke завершён.
