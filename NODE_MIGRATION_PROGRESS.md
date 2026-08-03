# KubeDeck 2.0 — миграция backend на Node завершена

Дата обновления: 2026-08-03
Ветка: `main`
Текущая проверяемая версия: `2.10.3`

## Итог

Все существующие backend-контракты перенесены из Python/FastAPI в Node.js внутри Electron main process.

- Node routes: **54**.
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
- `/migration/status`: Node 52, Python 0, mode `node-only`;
- portable не содержит Python backend payload и встроенный `kubectl.exe`.

## 2.0.6 — stable release baseline

`2.0.6` фиксирует проверенный Node-only baseline и включает пользовательские UX-исправления, накопленные после первичной стабилизации.

Исторические release notes и checklist 2.0.6 удалены после переноса итогов в `CHANGELOG.md`. Актуальные проверки находятся в `docs/releases/REGRESSION_CHECKLIST_2.9.3.md` и `docs/release-checklist.md`.

## 2.10.1 — шифрование LLM API key

`2.10.1` закрывает долг, зафиксированный в плане `2.10.0`: LLM API key больше
не хранится в `config.json` открытым текстом, а шифруется через Electron
`safeStorage` в `secrets/llm-api-key.bin` с one-shot миграцией существующих
ключей. Маршрутов не прибавилось — `PUT /settings` и `POST /llm/test`
расширили контракт существующих routes. Node-only Gateway остаётся на 54
маршрутах.

## 2.10.2 — устранение дублирования backend/renderer

`2.10.2` — внутренний cleanup-патч по итогам повторного код-ревью: один
`decodePathPart`, один `writeRouteError`-диспетчер и один `RouteInfoError`
вместо 14+12+4 копий в routes/WebSocket-модулях; CPU/memory quantity парсится
один раз в `resources/quantity.ts` (раньше `normalizers.ts` не поддерживал
`Pi`/`Ei` и не делал truncation, которые уже были в `metrics.ts` — теперь
поведение одинаковое). На renderer — `PodDrawer.tsx` лишился logs- и
YAML-кластеров (вынесены в hooks), `NodeSshTab.tsx`/`TerminalTab.tsx` делят
общий `utils/xtermSession.ts`, удалён мёртвый `EventsTab.tsx`. Маршрутов не
прибавилось, Node-only Gateway остаётся на 54 маршрутах.

## 2.10.3 — устранение утечки памяти и проблем производительности

`2.10.3` — патч по итогам performance-аудита backend/renderer: `WatchManager`
никогда не удалял завершённые watch-сессии из `this.sessions` — теперь
явная остановка удаляет сессию сразу, а сессии, упавшие без явного `stop()`,
удаляются TTL-sweep'ом (5 минут) при вызове `status()`. Также: убран лишний
`structuredClone` в resource cache; `routes/search.ts` переиспользует общий
кэш `kubectl api-resources` вместо дублирующего вызова на каждый ввод в
поиске; кэш disk-метрик ноды (30s TTL) убирает N+1 kubectl-вызовов на каждый
overview-poll; построение `Set` в `matchingDeploymentPods()` вынесено из
цикла по подам; O(n²)-фильтр выбора строк в таблице ресурсов и четыре
немемоизированных renderer-вычисления (колонки таблицы, YAML search,
Manifest Compare diff, Logs фильтрация) исправлены через `useMemo`.
Маршрутов не прибавилось, Node-only Gateway остаётся на 54 маршрутах.

## Следующий этап

`2.9.3` сохраняет единый Terminal Workspace, исправляет packaged UI и Windows packaging, а также добавляет тему Steel Graphite. Node-only Gateway содержит 52 маршрута.

После принятия 2.0.6:

1. commit и push stable baseline;
2. закрыть ручной regression checklist;
3. исправлять найденные дефекты отдельными небольшими patch-релизами;
4. готовить следующий стабильный patch/minor-релиз по итогам проверки.

## Правила работы

- Стабильные изменения выпускаются из ветки `main`.
- Один ZIP-патч — один логический этап.
- Перед ZIP-патчем согласуется план.
- Не выполнять `npm ci` без необходимости.
- Не добавлять `kubectl.exe` в portable.
- Не использовать `git diff` в инструкциях.
