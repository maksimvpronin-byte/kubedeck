# KubeDeck 2.0 — промежуточный прогресс миграции на Node

Дата обновления: 2026-06-22  
Ветка: `dev/2.0.0`  
Базовая проверенная версия: `2.0.0-alpha.12`  
Текущий этап: `2.0.0-alpha.13`

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

### `2.0.0-alpha.12` — Node Related Resources

Проверена вручную и работает штатно.

Перенесён `GET /clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/related`. Добавлены связи workload, network, storage, config и RBAC, дедупликация, кеширование source-запросов и partial errors.

## Текущий этап `2.0.0-alpha.13` — Node LLM Backend

Переносятся:

- `GET /llm/status`.
- `POST /llm/test`.
- `POST /llm/preview-resource-prompt`.
- `POST /llm/analyze-resource`.

Добавляется:

- Node OpenAI-compatible client для `/v1/chat/completions`;
- сохранение текущих кодов ошибок `LLM_*`;
- timeout через `AbortController`;
- поддержка `content`, content parts и reasoning-only ответов;
- извлечение `<kubedeck_final>` и фиксированный пятисекционный результат;
- перенос system prompt и prompt preview без изменений Renderer-контракта;
- безопасный Kubernetes context builder;
- полный Describe, YAML excerpt и previous logs tail-5;
- current logs tail-5 только при отсутствии previous logs;
- status/conditions, container states, events и related resources summary;
- маскирование Secret data/stringData, token, password, API key, bearer, private key и certificate;
- ограничение `maxContextChars`;
- запрет логирования API key, LLM payload и введённого user request;
- contract tests для sanitizer, truncation, prompt, status, test, preview, analyze, reasoning-only и ошибок.

## Владение маршрутами после применения Alpha 13

- Node: 49.
- Python: 0.
- Всего существующих контрактов: 49.
- Режим `/migration/status`: `node-only`.

## Оставшиеся Python-маршруты

Нет. Python backend пока физически остаётся в runtime и portable только до отдельного cleanup-этапа.

## Проверка Alpha 13

Нужно проверить:

- Settings → LLM показывает текущий status.
- Test connection работает с сохранёнными и временными настройками.
- Prompt preview совпадает с prompt, используемым Analyze.
- Analyze Resource возвращает пять секций.
- reasoning-only ответ возвращает понятный `LLM_EMPTY_FINAL_RESPONSE`.
- timeout и недоступный сервер возвращают `LLM_TIMEOUT`/`LLM_UNREACHABLE`.
- Secret data, API key, token, password и private key отсутствуют в preview, app logs и ответе.
- Previous logs ограничены последними пятью строками.
- При превышении `maxContextChars` выставляется `truncated: true`.
- `/migration/status` показывает Node 49 / Python 0 и `node-only`.
- Gateway contract tests проходят.
- Portable-сборка выполняется успешно.

## Следующий рекомендуемый этап

После полного regression test и push Alpha 13:

1. `2.0.0-alpha.14` — удалить запуск Python/FastAPI child process.
2. Удалить Python backend из portable packaging и build scripts.
3. Удалить PyInstaller/runtime artifacts и legacy proxy после проверки rollback-плана.
4. Выполнить финальный node-only regression test перед beta/RC.

## Правила дальнейшей работы

- Работа ведётся в ветке `dev/2.0.0`.
- Один ZIP-патч — один функциональный блок.
- Перед каждым ZIP-патчем сначала согласуется план.
- Патчи применяются поверх текущего проекта.
- Не использовать `git diff` в инструкциях.
- Не выполнять `npm ci` без необходимости.
- Не добавлять `kubectl.exe` в portable-сборку.
- Каждый этап проходит typecheck, desktop build, contract tests, portable build и ручную UI-проверку.
