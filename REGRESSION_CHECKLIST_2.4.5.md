# KubeDeck 2.4.5 — Regression Checklist

Дата: 2026-07-21

## Automated gate

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`; 27/27 tests.
- [x] `npm run typecheck`.
- [x] `npm run build` после финальных изменений.
- [x] `npm --workspace apps/desktop run test:gateway`; 73/73 tests.
- [x] `npm run verify:release`.
- [x] Release contracts: Node 50 / Python 0.
- [x] Полная Gateway suite сохраняет cluster-контракты и границы приватности LLM.

## Correctness contracts

- [x] Bulk actions сохраняют исходный `clusterId` и сбрасываются при смене активного кластера.
- [x] Resource watch cleanup не останавливает общий backend watch.
- [x] Port-forward без сигнала готовности завершается по timeout с ошибкой.
- [x] Search timeout отменяет только команды текущего запроса.
- [x] Application quit ожидает idempotent shutdown Gateway.
- [x] Config recovery различает повреждённый JSON и ошибку доступа.
- [x] Cluster removal ожидает cleanup и сообщает об ошибке удаления managed kubeconfig.
- [x] Audit log сохраняет текущий и предыдущий ограниченные сегменты.

## Manual packaged smoke

- [ ] Windows: запустить portable artifact, подключить кластер и выполнить bulk action.
- [ ] Windows: открыть watch, port-forward и terminal, затем удалить тестовый кластер.
- [ ] macOS: запустить DMG/ZIP artifact и повторить базовый resource/watch smoke.
- [ ] На обеих платформах: закрыть приложение при активной Gateway-сессии и проверить чистое завершение процесса.

## Acceptance

- [x] Автоматические контракты KubeDeck `2.4.5` выполнены.
- [x] Версии root, desktop, shared package и lock-файла синхронизированы на `2.4.5`.
- [ ] Packaged smoke закрывается после ручной проверки artifacts.
