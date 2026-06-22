# KubeDeck 2.0 — промежуточный прогресс миграции на Node

Дата обновления: 2026-06-22  
Ветка: `dev/2.0.0`  
Базовая проверенная версия: `2.0.0-alpha.9`  
Текущая проверенная версия: `2.0.0-alpha.9`

## Цель миграции

Убрать отдельный Python/FastAPI backend-процесс и постепенно перенести backend KubeDeck в Node.js внутри Electron main process.

Во время перехода:

- Renderer обращается только к Node Gateway.
- Уже перенесённые маршруты выполняются в Node.
- Остальные маршруты временно проксируются в Python.
- Python backend пока остаётся в portable-сборке.
- Python и PyInstaller удаляются только после миграции и проверки всех контрактов.

## Выполненные этапы

### `2.0.0-alpha.1`

- Node Gateway.
- `GET /health`.
- `GET /migration/status`.
- Legacy HTTP/WebSocket proxy в Python.

### `2.0.0-alpha.2` и `2.0.0-alpha.2.1`

- App info, config, settings и audit.
- Список, импорт, переименование и удаление кластеров.
- Совместимость с существующим `config.json` и каталогом kubeconfig.

### `2.0.0-alpha.3` — `2.0.0-alpha.3.3`

- Node Kubectl Runtime.
- Открытие кластера, namespaces и kubectl status.
- Resource YAML, Describe, Events, Pod Logs.
- Resource discovery cache.
- Deployment log targets и aggregated logs.

### `2.0.0-alpha.4` — `2.0.0-alpha.4.3`

- YAML server-side dry-run и apply.
- Secret keys/reveal/copy без утечки значений в логи.
- Resource actions: delete, restart/redeploy, scale, cordon, uncordon и drain.
- Pod Exec.
- Подтверждения, `kubectl auth can-i`, audit и cache invalidation.

### `2.0.0-alpha.5`

Проверена вручную и запушена в `dev/2.0.0`.

Перенесены resource list и Resource Snapshot Cache, включая CPU/RAM, Namespace usage/quota, CRD fallback и защиту от устаревшего кэша.

### `2.0.0-alpha.6` — Node Resource Watch

Проверена вручную и работает штатно.

Перенесены четыре HTTP watch-контракта и WebSocket resource watch. Добавлены Node Watch Manager, дедупликация, graceful stop, точечная очистка resource cache и Node Event Hub.

### `2.0.0-alpha.7` — Node Port Forward

Проверена вручную и работает штатно.

Перенесены три Port Forward маршрута. Добавлены Node Port Forward Manager, привязка к `127.0.0.1`, автоматический локальный порт, readiness-проверка, дедупликация, graceful stop, audit и cleanup.

### `2.0.0-alpha.8` — Node Pod Terminal

Проверена вручную, portable-сборка выполнена успешно.

Перенесён WebSocket Pod Terminal. Добавлены `kubectl auth can-i`, shell-режимы, Windows ConPTY через `node-pty`, pipe fallback, resize, lifecycle cleanup и audit без введённых команд.

## Выполненный этап `2.0.0-alpha.9` — Node SSH WebSocket

Перенесён:

- WebSocket `/clusters/{cluster_id}/nodes/{name}/ssh`.

Добавлено:

- отдельный Node SSH WebSocket server;
- сохранение существующего Renderer-протокола `connect/input/resize/close` и `output/status/error`;
- password authentication;
- private key и key passphrase;
- SSH-agent или стандартный ключ из пользовательского `.ssh`;
- jump host через отдельное SSH-соединение и `forwardOut`;
- интерактивный `xterm-256color` shell и PTY resize;
- лимиты WebSocket payload, таймаут первого сообщения и SSH connect timeout;
- завершение SSH-сессий при удалении кластера и закрытии Gateway;
- audit открытия, ошибки и закрытия без паролей, passphrase и введённых команд;
- активный Node SSH session count в `/migration/status`.

## Владение маршрутами после применения Alpha 9

- Node: 42.
- Python: 7.
- Всего существующих контрактов: 49.

## Оставшиеся Python-маршруты

### Диагностика и поиск

- Problems.
- Global Search.
- Related Resources.

### LLM

- LLM status.
- LLM connection test.
- Prompt preview.
- Resource analysis.

## Проверка Alpha 9

- TypeScript main и renderer проверки пройдены.
- Desktop build выполнен успешно.
- Gateway contract tests пройдены.
- Portable-сборка выполнена успешно.
- Node SSH проверен вручную.
- Подключение, ввод команд, вывод и закрытие сессии работают.
- Pod Terminal, Resource Watch и Port Forward продолжают работать.
- Этап принят как рабочий.
## Следующий рекомендуемый небольшой этап

После ручной проверки и push Alpha 9:

1. Problems.
2. Затем Global Search и Related Resources небольшими отдельными этапами.
3. После этого — четыре LLM-контракта.
4. Python backend и PyInstaller удалять только на RC-этапе.

## Правила дальнейшей работы

- Работа ведётся в ветке `dev/2.0.0`.
- Один ZIP-патч — один функциональный блок.
- Перед каждым ZIP-патчем сначала согласуется план.
- Патчи применяются поверх текущего проекта.
- Не использовать `git diff` в инструкциях.
- Не выполнять `npm ci` без необходимости.
- Не добавлять `kubectl.exe` в portable-сборку.
- Каждый этап проходит typecheck, desktop build, contract tests, portable build и ручную UI-проверку.
