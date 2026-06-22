# KubeDeck 2.0 — миграция backend на Node завершена

Дата обновления: 2026-06-22  
Ветка: `dev/2.0.0`  
Текущая проверяемая версия: `2.0.0-alpha.14`

## Итог

Все существующие backend-контракты перенесены из Python/FastAPI в Node.js внутри Electron main process.

- Node routes: **49**.
- Python routes: **0**.
- Runtime mode: **node-only**.
- Legacy HTTP/WebSocket proxy: удалён.
- Python/FastAPI child process: удалён.
- PyInstaller packaging: удалён.
- Python backend payload в portable: запрещён проверкой сборщика.

## Выполненные этапы

- Alpha 1–2: Node Gateway, config, audit и cluster management.
- Alpha 3–4: Node kubectl runtime, resource details, logs, YAML, Secrets, actions и Pod Exec.
- Alpha 5: resource lists и Resource Snapshot Cache.
- Alpha 6: Resource Watch и WebSocket Event Hub.
- Alpha 7: Port Forward Manager.
- Alpha 8: Pod Terminal и ConPTY/pipe fallback.
- Alpha 9: Node SSH, private key, agent и jump host.
- Alpha 10: Problems Engine.
- Alpha 11: Global Search.
- Alpha 12: Related Resources.
- Alpha 13: LLM status/test/preview/analyze.
- Alpha 14: удаление Python runtime, legacy proxy и PyInstaller.

## Alpha 14 — Node-only Runtime Cleanup

Удалено:

- `apps/backend` с FastAPI-кодом и Python-тестами;
- запуск `kubedeck_backend.main` из Electron;
- backend port allocation, health wait и PID-файл;
- legacy HTTP/WebSocket proxy;
- legacy resource-cache invalidation;
- Python health probe из `/migration/status`;
- PyInstaller virtualenv и backend executable packaging;
- `extraResources: build/backend` из electron-builder;
- требования Python из setup/build документации.

Добавлено:

- постоянный `/migration/status` в режиме `node-only`;
- HTTP 404 `ROUTE_NOT_FOUND` для неизвестных маршрутов;
- WebSocket policy close для неизвестных WS-маршрутов;
- contract test Node-only runtime;
- portable-проверка отсутствия Python backend payload;
- Node-only README и Windows bootstrap.

## Обязательная проверка Alpha 14

- TypeScript typecheck.
- Desktop/Vite build.
- Все Node Gateway contract tests.
- Windows portable build.
- Запуск portable без установленного Python.
- `/migration/status`: Node 49, Python 0, mode `node-only`.
- В release отсутствуют `kubectl.exe`, `resources/backend`, Python DLL и backend executable.
- Regression smoke test: resources, watch, logs, YAML, terminal, SSH, port-forward, Problems, Search, Related и LLM.

## Дальнейшие шаги

После ручной проверки Alpha 14:

1. зафиксировать и push cleanup-коммит;
2. выполнить полный regression smoke test;
3. подготовить RC без изменения backend-контрактов;
4. отдельно обновить историческую техническую документацию при необходимости.

## Правила работы

- Работа ведётся в ветке `dev/2.0.0`.
- Один ZIP-патч — один логический этап.
- Перед ZIP-патчем согласуется план.
- Не выполнять `npm ci` без необходимости.
- Не добавлять `kubectl.exe` в portable.
- Не использовать `git diff` в инструкциях.
