# KubeDeck 2.0 — промежуточный прогресс миграции на Node

Дата обновления: 2026-06-22  
Ветка: `dev/2.0.0`  
Базовая проверенная версия: `2.0.0-alpha.11`  
Текущий этап: `2.0.0-alpha.12`

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

### `2.0.0-alpha.9` — Node SSH WebSocket

Проверена вручную и запушена в `dev/2.0.0`.

Перенесён WebSocket `/clusters/{cluster_id}/nodes/{name}/ssh`. Добавлены password/private-key/agent authentication, jump host, интерактивный PTY, resize, lifecycle cleanup и audit без секретов или введённых команд.

### `2.0.0-alpha.10` — Node Problems Engine

Проверена вручную и работает штатно.

Перенесён `GET /clusters/{cluster_id}/problems`. Добавлены Node Problems Engine, параллельная загрузка пяти источников, partial errors, restart threshold, категории, severity, target links, сортировка и дедупликация.

### `2.0.0-alpha.11` — Node Global Search

Проверена вручную и работает штатно.

Перенесён `GET /clusters/{cluster_id}/search`. Добавлены ranking, namespace modes, partial errors, CRD discovery, ограниченный поиск CRD instances и безопасный поиск Secrets.

## Текущий этап `2.0.0-alpha.12` — Node Related Resources

Переносится:

- `GET /clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/related`.

Добавляется:

- отдельный Node Related Resources engine;
- сохранение ответа `{ items, sources, errors }`;
- связи Pod с Node, ServiceAccount, Deployment/CronJob, Service, PVC, ConfigMap и Secret;
- связи workload selector с Pods, Services и ReplicaSets;
- связи Service с Pods, Ingress, Endpoints и EndpointSlices;
- связи Ingress с backend Services;
- связи PVC/PV со StorageClass, Pod и bound volume/claim;
- обратный поиск Pods, использующих ConfigMap или Secret;
- связи ServiceAccount, Role, ClusterRole, RoleBinding и ClusterRoleBinding;
- связи Node с запущенными на нём Pods;
- ограничение результата до 200 элементов;
- дедупликация и стабильная сортировка;
- кеширование одинаковых source-запросов внутри одного HTTP-вызова;
- partial errors: ошибка одного Kubernetes-источника не обрушает остальные связи;
- contract tests для Pod, Service, storage, config, RBAC, partial errors и missing cluster.

## Владение маршрутами после применения Alpha 12

- Node: 45.
- Python: 4.
- Всего существующих контрактов: 49.

## Оставшиеся Python-маршруты

### LLM

- `GET /llm/status`.
- `POST /llm/test`.
- `POST /llm/preview-resource-prompt`.
- `POST /llm/analyze-resource`.

## Проверка Alpha 12

Нужно проверить:

- Related Resources открывается без Python-обработки маршрута.
- У Pod отображаются Deployment, Node, Service, ServiceAccount, ConfigMap, Secret и PVC.
- У Service отображаются Pods, Ingress, Endpoints и EndpointSlices.
- У PVC отображаются PV, StorageClass и использующие claim Pods.
- У ConfigMap/Secret отображаются использующие их Pods.
- У ServiceAccount и RBAC-ресурсов отображаются связанные bindings, roles и subjects.
- У Node отображаются запущенные на нём Pods.
- Ошибка чтения одного типа ресурсов не скрывает остальные связи.
- Gateway contract tests проходят.
- Portable-сборка выполняется успешно.

## Следующий рекомендуемый этап

После ручной проверки и push Alpha 12:

1. Перенести четыре LLM-контракта отдельным этапом.
2. Провести полный regression test без Python-owned маршрутов.
3. Python backend и PyInstaller удалять только на RC-этапе.

## Правила дальнейшей работы

- Работа ведётся в ветке `dev/2.0.0`.
- Один ZIP-патч — один функциональный блок.
- Перед каждым ZIP-патчем сначала согласуется план.
- Патчи применяются поверх текущего проекта.
- Не использовать `git diff` в инструкциях.
- Не выполнять `npm ci` без необходимости.
- Не добавлять `kubectl.exe` в portable-сборку.
- Каждый этап проходит typecheck, desktop build, contract tests, portable build и ручную UI-проверку.
