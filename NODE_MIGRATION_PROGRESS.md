# KubeDeck 2.0 — промежуточный прогресс миграции на Node

Дата обновления: 2026-06-22  
Ветка: `dev/2.0.0`  
Базовая проверенная версия: `2.0.0-alpha.6`  
Текущая проверенная версия: `2.0.0-alpha.6`

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

Перенесены:

- `GET /clusters/{cluster_id}/resources/{resource}`.
- `GET /resource-cache/status`.
- `POST /resource-cache/clear`.

Добавлены:

- Node Resource Snapshot Cache.
- Нормализация стандартных Kubernetes-ресурсов и CRD fallback.
- Pod CPU/RAM.
- Namespace usage/quota.
- Защита от возврата устаревшего кэша при недоступном кластере.
- Очистка кэша после YAML apply, resource actions и удаления кластера.

## Выполненный этап `2.0.0-alpha.6` — Node Resource Watch

Переносится один связанный блок:

- `GET /watches/status`.
- `POST /clusters/{cluster_id}/watches`.
- `DELETE /watches/{watch_id}`.
- `POST /watches/stop-all`.
- WebSocket `/clusters/{cluster_id}/resources/{resource}/watch-events`.

Добавляется:

- отдельный Node Watch Manager для долгоживущих `kubectl watch` процессов;
- дедупликация по cluster/resource/namespace;
- состояния `running`, `stopping`, `stopped`, `failed`;
- ограниченные stdout/stderr tails;
- graceful stop и принудительное завершение по таймауту;
- остановка watch-процессов при закрытии Gateway;
- остановка watch-процессов удаляемого кластера;
- точечная очистка соответствующих resource snapshots;
- Node Event Hub;
- ограниченная очередь WebSocket-клиента с удалением самого старого события;
- совместимые сообщения `status`, `heartbeat`, `pong`, `resource.changed`;
- прежняя фильтрация `all`, `_cluster` и конкретного namespace;
- WebSocket auth/origin checks через общий Node Gateway security layer.
- Отображение активного Node watch count в `/migration/status` с process source `hybrid`.

Terminal и Node SSH WebSocket в этом этапе остаются в Python.

## Владение маршрутами после применения Alpha 6

- Node: 37.
- Python: 12.
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

### Port Forward

- List port forwards.
- Create port forward.
- Stop port forward.

### Интерактивные WebSocket-сессии

- Pod Terminal.
- Node SSH.

## Проверка Alpha 6

- Portable-сборка выполнена успешно.
- Ручная проверка пройдена.
- Node Resource Watch работает штатно.
- Этап принят как рабочий.
## Следующий рекомендуемый небольшой этап

После ручной проверки и push Alpha 6:

1. Node Port Forward Manager.
2. Затем Pod Terminal WebSocket.
3. Затем Node SSH WebSocket.
4. После process-heavy блока — Problems, Search, Related и LLM.
5. Python backend и PyInstaller удалять только на RC-этапе.

## Правила дальнейшей работы

- Работа ведётся в ветке `dev/2.0.0`.
- Один ZIP-патч — один функциональный блок.
- Перед каждым ZIP-патчем сначала согласуется план.
- Патчи применяются поверх текущего проекта.
- Не использовать `git diff` в инструкциях.
- Не выполнять `npm ci` без необходимости.
- Не добавлять `kubectl.exe` в portable-сборку.
- Каждый этап проходит typecheck, desktop build, contract tests, portable build и ручную UI-проверку.
