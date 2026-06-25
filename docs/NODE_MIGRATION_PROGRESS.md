# KubeDeck 2.0 — промежуточный прогресс миграции на Node

Дата фиксации: 2026-06-22  
Ветка: `dev/2.0.0`  
Текущий этап: `2.0.0-alpha.5`

## Цель миграции

Убрать отдельный Python/FastAPI backend-процесс и постепенно перенести backend KubeDeck в Node.js внутри Electron main process.

Миграция выполняется через Node Gateway:

- Renderer обращается только к Node Gateway.
- Уже перенесённые маршруты выполняются в Node.
- Остальные маршруты временно проксируются в Python.
- Python backend пока остаётся в portable-сборке.
- Удаление Python планируется только после миграции и проверки всех маршрутов.

## Текущая архитектура

- Electron main process
- React + TypeScript renderer
- Node Gateway
- Node Kubectl Runtime
- Python/FastAPI legacy backend для оставшихся маршрутов
- Системный или настроенный пользователем `kubectl`
- Один session token для Node Gateway и Python backend

## Выполненные этапы

### `2.0.0-alpha.1`

Добавлен Node Gateway.

Перенесено:

- `GET /health`
- новый диагностический маршрут `GET /migration/status`

Остальные HTTP и WebSocket маршруты проксировались в Python.

### `2.0.0-alpha.2`

На Node перенесены:

- `GET /app/info`
- `GET /config`
- `PUT /settings`
- `GET /audit`

Добавлены Node ConfigStore и AuditStore.

### `2.0.0-alpha.2.1`

На Node перенесены:

- `GET /clusters`
- `POST /clusters/import`
- `PATCH /clusters/{cluster_id}`
- `DELETE /clusters/{cluster_id}`

Сохранена совместимость с существующим `config.json` и каталогом kubeconfig.

### `2.0.0-alpha.3`

Добавлен Node Kubectl Runtime.

На Node перенесены:

- `GET /kubectl/status`
- `POST /clusters/last/open`
- `POST /clusters/{cluster_id}/open`
- `GET /clusters/{cluster_id}/namespaces`

Runtime использует `spawn()` без shell, timeout, ограничение вывода и остановку процессов при завершении приложения.

### `2.0.0-alpha.3.1`

На Node перенесены:

- Resource YAML
- Resource Describe
- Pod YAML
- Pod Describe
- Pod Logs

### `2.0.0-alpha.3.2`

На Node перенесены:

- `GET /clusters/{cluster_id}/resource-definitions`
- `GET /clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/events`

Добавлены resource discovery cache и фильтрация событий по Kubernetes-объекту.

### `2.0.0-alpha.3.3`

На Node перенесены:

- Deployment log targets
- Deployment aggregated logs

Поддержаны несколько Pod, контейнеры и частичные ошибки.

### `2.0.0-alpha.4`

На Node перенесены:

- YAML server-side dry-run
- YAML apply

YAML передаётся через stdin. Содержимое YAML и Secret не логируется.

### `2.0.0-alpha.4.1`

На Node перенесены операции Secrets:

- список ключей
- раскрытие значения
- копирование значения

Secret values не попадают в audit и backend-логи.

### `2.0.0-alpha.4.2`

На Node перенесён Resource Actions:

- delete
- restart / redeploy
- scale
- cordon
- uncordon
- drain

Сохранены подтверждения, `kubectl auth can-i`, audit и очистка кэша.

### `2.0.0-alpha.4.3`

На Node перенесён Pod Exec:

- `POST /clusters/{cluster_id}/pods/{namespace}/{name}/exec`

Поддержаны выбор контейнера, shells `sh`, `bash`, `ash`, typed-name confirmation, timeout и output limit.

### `2.0.0-alpha.5`

На Node перенесены:

- `GET /clusters/{cluster_id}/resources/{resource}`
- `GET /resource-cache/status`
- `POST /resource-cache/clear`

Добавлены:

- Node Resource Snapshot Cache
- нормализация стандартных Kubernetes-ресурсов
- fallback для CRD
- CPU/RAM для Pod
- Namespace usage/quota
- защита от возврата устаревшего кэша при недоступном кластере
- очистка кэша после YAML apply, resource actions и удаления кластера

Текущее владение маршрутами:

- Node: 32
- Python: 17
- Всего существующих маршрутов: 49

## Оставшиеся Python-маршруты

### Диагностика и поиск

- Problems
- Global Search
- Related Resources

### LLM

- LLM status
- LLM connection test
- Prompt preview
- Resource analysis

### Watch и live refresh

- Watch status
- Create watch
- Delete watch
- Stop all watches
- Resource watch WebSocket

### Port Forward

- List port forwards
- Create port forward
- Stop port forward

### Интерактивные WebSocket-сессии

- Pod terminal
- Node SSH

## Текущий статус проверки Alpha 5

Патч Alpha 5 применён после ручного исправления инициализации GatewayServices:

```ts
resourceCache: new ResourceSnapshotCache(),
```

Причина ручного исправления: автоматический patch script не нашёл фактическое форматирование блока создания `GatewayServices`.

Перед коммитом нужно проверить portable-сборку Alpha 5.

## Чек-лист проверки Alpha 5

1. Приложение запускается и открывает сохранённый кластер.
2. Загружаются Pods, Deployments, Services и Nodes.
3. Работают namespace-фильтры:
   - конкретный namespace
   - `all`
   - `_cluster`
4. Refresh действительно обновляет список ресурсов.
5. Pod CPU/RAM отображаются там, где доступны metrics.
6. Namespace usage/quota отображаются без регрессий.
7. Открываются YAML, Describe, Events и Logs.
8. Deployment aggregated logs продолжают работать.
9. После restart, scale, delete или YAML apply список обновляется.
10. При недоступном кластере старые ресурсы не показываются как актуальные.
11. CRD и нестандартные ресурсы отображаются через универсальный fallback.
12. После закрытия приложения не остаются зависшие процессы KubeDeck backend или kubectl.

## Следующий рекомендуемый этап

Следующий крупный блок:

1. Node Watch Manager.
2. Resource watch WebSocket.
3. Live refresh без Python.
4. Port Forward Manager.
5. Pod Terminal WebSocket.
6. Node SSH WebSocket.
7. Problems, Search и Related.
8. LLM routes.
9. Удаление Python backend и PyInstaller из portable-сборки.

## Правила дальнейшей работы

- Работа ведётся в ветке `dev/2.0.0`.
- Перед каждым ZIP-патчем сначала согласуется план.
- Патчи применяются поверх текущего проекта.
- Не использовать `git diff` в инструкциях.
- Не выполнять `npm ci` без необходимости.
- Не добавлять `kubectl.exe` в portable-сборку.
- Каждый этап должен проходить:
  - TypeScript typecheck
  - desktop build
  - Node backend contract tests
  - portable build
  - ручную проверку UI
