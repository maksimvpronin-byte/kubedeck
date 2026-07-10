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
- `kubeconfigs/` — импортированные kubeconfig-файлы;
- `logs/` — desktop/backend diagnostic logs;
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
- `search/`, `problems/`, `relations/` — diagnostic engines;
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

`PodDrawer` координирует вкладки ресурса, а специализированные компоненты владеют Summary, YAML, Describe, Events, Related, Logs, Terminal, Secret и SSH UI.

## Cache and live refresh

Resource list responses могут сохраняться в `ResourceSnapshotCache`. Manual refresh обходит cache. Mutating actions, YAML apply и watch events инвалидируют соответствующие snapshots.

Для активной таблицы renderer создаёт watch subscription. `kubectl watch` публикует нормализованные события через локальный WebSocket, после чего renderer выполняет debounced silent refresh. Периодический polling остаётся fallback-механизмом.

## Contract ownership

Существующие HTTP/WebSocket маршруты принадлежат Node runtime. `/migration/status` сохранён как release diagnostic и должен сообщать `node-only`, `49 Node / 0 Python` для текущего contract baseline.

Изменение request/response shape требует синхронного обновления типов renderer/main и соответствующего contract test. План 2.1 предусматривает перенос общих публичных контрактов в `@kubedeck/shared-types`.

## Packaging

- Desktop runtime: Electron 43.1.0, Chromium 150.0.7871.47, Node 24.18.0;
- Windows: Electron portable x64;
- macOS: unsigned arm64 DMG и ZIP;
- main, preload и renderer компилируются из TypeScript;
- production payload не содержит Python/FastAPI runtime и встроенного kubectl;
- `node-pty` является platform-native dependency и должен собираться для целевой платформы.

Актуальные команды и release gate описаны в `README.md` и `docs/release-checklist.md`.
