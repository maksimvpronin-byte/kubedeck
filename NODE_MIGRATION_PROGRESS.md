# KubeDeck 2.0 — промежуточный прогресс миграции на Node

Дата обновления: 2026-06-22  
Ветка: `dev/2.0.0`  
Базовая проверенная версия: `2.0.0-alpha.10`  
Текущий этап: `2.0.0-alpha.11`

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

## Выполненный этап `2.0.0-alpha.10` — Node Problems Engine

Проверена вручную и работает штатно.

Перенесён `GET /clusters/{cluster_id}/problems`. Добавлены Node Problems Engine, параллельная загрузка пяти источников, partial errors, restart threshold, категории, severity, target links, сортировка и дедупликация.

## Текущий этап `2.0.0-alpha.11` — Node Global Search

Переносится:

- `GET /clusters/{cluster_id}/search`.

Добавляется:

- отдельный Node Global Search engine;
- сохранение ответа `{ items, summary, errors }`;
- поиск по Pods, Deployments, Services, ConfigMaps, Secrets, Ingresses, PVC, Events, Namespaces и Nodes;
- query normalization и ограничения 2–128 символов;
- `limit` от 1 до 500;
- namespace-режимы `all`, `_cluster` и список до 20 namespace;
- ranking по exact/partial name, namespace, kind, resource, labels, annotations, status и безопасным полям spec;
- обязательное совпадение всех токенов запроса;
- concurrency `3`, kubectl timeout `10s` и общий search timeout `12s`;
- частичный результат при ошибке одного Kubernetes-источника;
- дедупликация и стабильная сортировка;
- CRD definitions и ограниченный поиск CRD instances;
- безопасный поиск Secrets без чтения `data`;
- contract tests для ranking, namespace modes, CRD, partial errors, limits и missing cluster.

## Владение маршрутами после применения Alpha 11

- Node: 44.
- Python: 5.
- Всего существующих контрактов: 49.

## Оставшиеся Python-маршруты

### Relations

- Related Resources.

### LLM

- LLM status.
- LLM connection test.
- Prompt preview.
- Resource analysis.

## Проверка Alpha 11

Нужно проверить:

- Global Search открывается без Python-обработки маршрута.
- Поиск по точному и частичному имени работает.
- Поиск по labels, namespace, kind и status работает.
- Фильтр одного namespace и `all` работает.
- Cluster-scoped ресурсы Nodes и Namespaces находятся.
- При запрете чтения одного типа ресурсов остальные результаты продолжают отображаться.
- CRD definition и CRD instances находятся по имени вида ресурса.
- Secrets не раскрывают значения.
- Gateway contract tests проходят.
- Portable-сборка выполняется успешно.

## Следующий рекомендуемый небольшой этап

После ручной проверки и push Alpha 11:

1. Related Resources отдельным этапом.
2. Затем четыре LLM-контракта.
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
