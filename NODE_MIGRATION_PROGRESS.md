# KubeDeck 2.0 — миграция backend на Node завершена

Дата обновления: 2026-06-22  
Ветка: `dev/2.0.0`  
Текущая проверяемая версия: `2.0.0-alpha.15`

## Итог

Все существующие backend-контракты перенесены из Python/FastAPI в Node.js внутри Electron main process.

- Node routes: **49**.
- Python routes: **0**.
- Runtime mode: **node-only**.
- Legacy HTTP/WebSocket proxy: удалён.
- Python/FastAPI child process: удалён.
- PyInstaller packaging: удалён.
- Python backend payload в portable: запрещён проверкой сборщика.
- Встроенный `kubectl.exe`: запрещён проверкой сборщика.

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
- Alpha 15: стабилизация Node-only build/test/documentation pipeline.

## Alpha 14 — принято

Проверено вручную:

- portable-сборка выполнена;
- приложение запускается без `python.exe`/`pythonw.exe`;
- Node Gateway contract tests проходят;
- `/migration/status`: Node 49, Python 0, mode `node-only`;
- portable не содержит Python backend payload и встроенный `kubectl.exe`.

## Alpha 15 — Node-only Stabilization

Добавлено:

- единый `scripts/verify-node-only.ps1`;
- root-команда `npm.cmd run verify:node-only`;
- единые ожидания `node-only`, `49/0` и `processes.source=node`;
- проверка source tree до сборки;
- проверка release payload после electron-builder;
- синхронизированная Node-only документация;
- защита от повторного появления FastAPI/PyInstaller/legacy proxy.

Новая функциональность API/UI не добавляется.

## Обязательная проверка Alpha 15

- `npm.cmd run verify:node-only`;
- TypeScript typecheck;
- Desktop/Vite build;
- все Node Gateway contract tests;
- Windows portable build;
- запуск portable;
- regression smoke test основных функций;
- проверка отсутствия Python и встроенного kubectl в runtime/release.

## Следующий этап

После успешной ручной проверки Alpha 15:

1. commit и push stabilization;
2. зафиксировать regression checklist;
3. перейти к `2.0.0-beta.1` без изменения backend-контрактов;
4. новые функции вести отдельными этапами после beta baseline.

## Правила работы

- Работа ведётся в ветке `dev/2.0.0`.
- Один ZIP-патч — один логический этап.
- Перед ZIP-патчем согласуется план.
- Не выполнять `npm ci` без необходимости.
- Не добавлять `kubectl.exe` в portable.
- Не использовать `git diff` в инструкциях.
