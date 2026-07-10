# KubeDeck 2.0 — миграция backend на Node завершена

Дата обновления: 2026-06-22  
Ветка: `dev/2.0.0`  
Текущая проверяемая версия: `2.1.0`

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

## Alpha 15 — принято

Проверено:

- `npm.cmd run verify:node-only` проходит;
- TypeScript typecheck и desktop build проходят;
- Gateway suite запускается с `--test-concurrency=1`;
- process-heavy Watch и Port Forward тесты проходят без cancelled;
- Windows portable собирается;
- приложение запускается без `python.exe`/`pythonw.exe`;
- `/migration/status`: Node 49, Python 0, mode `node-only`;
- portable не содержит Python backend payload и встроенный `kubectl.exe`.

## 2.0.6 — stable release baseline

`2.0.6` фиксирует проверенный Node-only baseline и включает пользовательские UX-исправления, накопленные после первичной стабилизации.

Исторические release notes и checklist 2.0.6 удалены после переноса итогов в `CHANGELOG.md`. Актуальные проверки находятся в `REGRESSION_CHECKLIST_2.1.0.md` и `docs/release-checklist.md`.

## Следующий этап

`2.1.0` сохраняет Node-only baseline и добавляет декомпозицию renderer orchestration, shared type contracts, bundle splitting и Electron sandbox hardening.

После принятия 2.0.6:

1. commit и push stable baseline;
2. закрыть ручной regression checklist;
3. исправлять найденные дефекты отдельными небольшими patch-релизами;
4. готовить следующий стабильный patch/minor-релиз по итогам проверки.

## Правила работы

- Работа ведётся в ветке `dev/2.0.0`.
- Один ZIP-патч — один логический этап.
- Перед ZIP-патчем согласуется план.
- Не выполнять `npm ci` без необходимости.
- Не добавлять `kubectl.exe` в portable.
- Не использовать `git diff` в инструкциях.
