# KubeDeck Architecture

Этот документ описывает актуальную Node-only архитектуру KubeDeck 2.x. Историю миграции с Python/FastAPI см. в `NODE_MIGRATION_PROGRESS.md`; она не является описанием текущего runtime.

## Process model

KubeDeck состоит из двух runtime-процессов:

- Electron main process создаёт окно, владеет локальным Node Gateway, системными диалогами и ограниченным IPC;
- изолированный React renderer отображает UI и обращается к gateway через HTTP/WebSocket.

Отдельный backend-процесс не запускается. Node Gateway работает внутри Electron main process, слушает случайный порт только на `127.0.0.1` и закрывается вместе с приложением.

Renderer получает `{ baseUrl, token }` через preload bridge. `contextIsolation` включён, `nodeIntegration` выключен. Текущее решение по Chromium sandbox и его ограничения фиксируются в `docs/security.md`.

## Request flow

```text
React renderer
  -> preload IPC: получить адрес и session token
  -> HTTP/WebSocket на 127.0.0.1
  -> Node Gateway route
  -> ConfigStore / AuditStore / KubectlRunner / session manager
  -> системный kubectl, node-pty, ssh2 или внешний LLM endpoint
```

Все HTTP-запросы, кроме `GET /health`, требуют `X-KubeDeck-Token`. WebSocket использует тот же token. Gateway проверяет Origin, а session token генерируется заново при каждом запуске приложения.

## Storage

Локальные данные хранятся в каталоге KubeDeck внутри системного app-data:

- Windows: `%APPDATA%\KubeDeck`;
- macOS и fallback окружения: путь вычисляется Electron либо `~/.kubedeck` для standalone Node-контекста.

Основные данные:

- `config.json` — настройки и список кластеров;
- `kubeconfigs/` — импортированные kubeconfig-файлы, редактируемые из Settings (атомарная запись, права 0600, копия предыдущей версии в `.bak`);
- `logs/` — desktop/backend diagnostic logs;
- `metrics/` — история потребления подов, по файлу на кластер: единственные данные кластера, которые KubeDeck хранит между запусками. Файл ограничен окном в 24 часа и числом серий, пишется атомарно и удаляется вместе с кластером;
- `terminals/` — временные shell scripts, когда они нужны platform integration.

Resource Snapshot Cache, watch events, terminal, SSH и port-forward sessions хранятся только в памяти процесса.

## Backend boundaries

Ключевые модули `apps/desktop/src/main/backend`:

- `gateway.ts` — HTTP/WebSocket composition root и lifecycle сервисов;
- `config/` — пути, валидация и сохранение конфигурации;
- `kubectl/` — безопасная сборка команд, spawn без shell, timeout и output limits;
- `routes/` — HTTP handlers по функциональным областям;
- `cache/` — in-memory snapshots ресурсов;
- `watch/` — lifecycle `kubectl watch`, invalidation cache и WebSocket events;
- `terminal/` — интерактивные Pod Terminal sessions через `node-pty`;
- `ssh/` — Node SSH sessions через `ssh2`;
- `portForward/` — registry и lifecycle управляемых `kubectl port-forward`;
- `resources/` — нормализация строк таблиц, метрики, кэш `kubectl api-resources` (доступные ресурсы и их scope) и история потребления подов: сэмплы снимаются самим KubeDeck, складываются в пятиминутные бакеты и переживают перезапуск через файл на кластер в `metrics/`;
- `search/`, `problems/`, `relations/` — diagnostic engines; `relations/` строит связи от целевого объекта по манифесту и обратные связи через discovery, поэтому CRD-маршруты (Traefik, Gateway API) опрашиваются только на кластерах, где они установлены;
- `llm/` — sanitization, context, prompts и OpenAI-compatible client;
- `audit/` — bounded metadata audit без содержимого Secret.

`gateway.ts` является composition root, но бизнес-логика и построение kubectl-команд должны оставаться в специализированных модулях.

## Kubectl transport

Kubernetes API вызывается через системный `kubectl`, указанный в Settings или доступный через `PATH`. Portable/DMG payload не содержит встроенного kubectl.

Все команды проходят через `KubectlRunner` и command builders. Они обеспечивают:

- запуск без shell;
- timeout и остановку дочерних процессов;
- ограничение stdout/stderr;
- безопасный command preview;
- классификацию ошибок;
- redaction чувствительных данных;
- передачу YAML через stdin.

Долгоживущие watch, terminal и port-forward процессы имеют отдельных владельцев lifecycle и останавливаются при удалении кластера или завершении приложения.

## Renderer structure

Renderer находится в `apps/desktop/src/renderer`:

- `App.tsx` — composition и orchestration верхнего уровня;
- `api.ts` — единый HTTP/WebSocket client;
- `components/` — resource tables, drawer tabs, panels и modals;
- `hooks/` — UI lifecycle и persisted state;
- `utils/` — чистые функции;
- `locales/` — русская и английская локализация;
- `styles/` — темы и стили приложения.

Переключение кластеров живёт в `ClusterRail` — вертикальном рельсе иконок слева от resource navigation. Рельс показывает по одной кнопке на кластер в порядке из `config.clusters`, отмечает активный, открывающийся и недоступный кластер и содержит кнопку импорта kubeconfig. Переименование и удаление кластеров остаются в Settings.

`PodDrawer` координирует вкладки ресурса, а специализированные компоненты владеют Summary, YAML, Describe, Events, Related, Logs и Secret UI. Pod Terminal и Node SSH открываются из drawer в общей нижней `BottomTerminalPanel`.

Нижняя terminal workspace хранит до пяти Pod/SSH targets, оставляет неактивные сессии смонтированными при переключении ресурсов и вкладок и закрывает их только по явному действию, удалению кластера или завершению приложения. Высота панели изменяется Pointer Events или клавиатурой, ограничивается доступным размером окна и сохраняется в локальном UI state. Пароли и passphrase для SSH остаются только в state живого renderer-компонента и не записываются в persisted UI state.

## Cache and live refresh

Resource list responses могут сохраняться в `ResourceSnapshotCache`. Manual refresh обходит cache. Mutating actions, YAML apply и watch events инвалидируют соответствующие snapshots.

Для активной таблицы renderer создаёт watch subscription. `kubectl watch` публикует нормализованные события через локальный WebSocket, после чего renderer выполняет debounced silent refresh. Периодический polling остаётся fallback-механизмом.

Строки таблицы принадлежат scope `(cluster, resource, namespace selection)`. При смене scope renderer очищает строки до отправки запроса, поэтому прерванная или неудачная загрузка не может оставить на экране данные другого namespace. Silent refresh от watch не прерывает выполняющуюся загрузку того же scope: события коалесцируются в один trailing refresh после её завершения. Прерывание остаётся только за ручным refresh и за сменой scope.

## Contract ownership

Существующие HTTP/WebSocket маршруты принадлежат Node runtime. `/migration/status` сохранён как release diagnostic и должен сообщать `node-only`, `56 Node / 0 Python` для текущего contract baseline.

Изменение request/response shape требует синхронного обновления типов renderer/main и соответствующего contract test. План 2.1 предусматривает перенос общих публичных контрактов в `@kubedeck/shared-types`.

## Packaging

- Desktop runtime: Electron 43.1.0, Chromium 150.0.7871.47, Node 24.18.0;
- Windows: Electron portable x64;
- macOS: unsigned arm64 DMG и ZIP;
- main, preload и renderer компилируются из TypeScript;
- production payload не содержит Python/FastAPI runtime и встроенного kubectl;
- `node-pty` является platform-native dependency и должен собираться для целевой платформы.

Актуальные команды и release gate описаны в `README.md` и `docs/release-checklist.md`.
