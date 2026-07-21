# KubeDeck 2.4.5 — Release Notes

Дата подготовки: 2026-07-21

KubeDeck 2.4.5 исправляет обнаруженные аудитом ошибки жизненного цикла и ограничивает рост audit log. Новых пользовательских возможностей и зависимостей нет.

Node-only baseline остаётся неизменным: Node 50 / Python 0.

## Исправления

- Bulk-действия выполняются только в исходном кластере; устаревшие подтверждения сбрасываются при переключении кластера.
- Закрытие одного resource view больше не останавливает общий backend watch для других потребителей.
- Port-forward считается готовым только после сигнала готовности, а не просто пока процесс жив.
- Общий таймаут поиска отменяет только принадлежащие этому запросу процессы `kubectl`.
- Завершение приложения ожидает остановки Node Gateway перед выходом.
- Ошибки чтения cluster config не перезаписывают файл; повреждённый primary восстанавливается только из валидного backup.
- Удаление кластера ожидает остановки его watches, port-forwards, terminals и SSH-сессий и сообщает об ошибке удаления managed kubeconfig.
- Audit log ротируется при 20 MiB и сохраняет один предыдущий сегмент.

## Проверка

Автоматический gate включает lint, format check, renderer contracts, TypeScript typecheck, production build, Gateway contracts и release contract. Точечные контракты покрывают все перечисленные исправления.

## Artifacts

- Windows x64: `apps\desktop\release\KubeDeck-Portable-2.4.5-x64.exe`;
- macOS arm64: `apps/desktop/release/KubeDeck-2.4.5-arm64.dmg` и `.zip`.
