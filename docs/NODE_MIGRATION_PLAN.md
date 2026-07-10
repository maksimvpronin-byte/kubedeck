# KubeDeck 2.0 — план миграции Python/FastAPI → Node.js/TypeScript (архив)

> Исторический план завершённой миграции. Не использовать как текущую инструкцию по архитектуре или сборке.

**Статус:** проектный план, без изменения рабочего кода  
**Базовая версия:** KubeDeck 1.1.2  
**Цель:** полностью удалить Python runtime, FastAPI, PyInstaller и отдельный backend-процесс, сохранив функциональность и пользовательский интерфейс.

---

## 1. Главный принцип миграции

Переход выполняется постепенно по модели **Strangler Pattern**.

На промежуточных версиях:

```text
React Renderer
      |
      v
ApiClient — существующий REST/WebSocket контракт
      |
      v
Node Gateway внутри Electron main process
      |                         |
      | перенесённые маршруты   | ещё не перенесённые маршруты
      v                         v
Node/TypeScript services     Python/FastAPI legacy backend
      |                         |
      +-----------+-------------+
                  |
               kubectl
```

В финальной версии:

```text
React Renderer
      |
      v
Node Gateway внутри Electron main process
      |
      +-- Config / Clusters
      +-- Kubectl Runtime
      +-- Resources / Normalizers
      +-- Cache / Watch
      +-- Logs / Terminal / Port Forward / SSH
      +-- Relations / Problems / Search
      +-- LLM
      |
      v
   kubectl
```

Node Gateway работает **внутри основного Electron-процесса**, а не отдельным дочерним процессом.

---

## 2. Почему не переписываем всё сразу

Одновременный перенос всего backend создаст слишком большой набор переменных:

- меняется язык;
- меняется runtime;
- меняется обработка процессов;
- меняется WebSocket-реализация;
- меняется упаковка portable;
- меняются тесты;
- легко нарушить форматы ответов frontend;
- легко потерять проверки безопасности;
- сложно определить источник регрессии.

Поэтому после каждого этапа должна существовать запускаемая и проверяемая сборка.

---

## 3. Что уже видно по Graphify

Graphify обнаружил:

- 1228 узлов;
- 2728 связей;
- 74 функциональных сообщества;
- циклических импортов не обнаружено.

Наиболее связанные узлы:

1. `ApiClient`
2. `validate_identifier()`
3. `ResourceRow`
4. `cluster_command()`
5. `ErrorInfo`
6. `build_related_links()`
7. `KubectlCommand`
8. `kubectl_error()`
9. `append_audit_event()`
10. `ConfigStore`

Следовательно, миграция должна начинаться не с отдельных экранов, а с общих контрактов:

```text
Shared Types
    ↓
Error Contract
    ↓
Config Store
    ↓
Kubectl Runtime
    ↓
API Routes
    ↓
Feature Engines
```

---

## 4. Архитектурные решения

### ADR-001. Сохраняем текущий REST/WebSocket контракт

На время миграции frontend продолжает использовать существующий `ApiClient`.

Преимущества:

- React-компоненты почти не меняются;
- можно переносить маршруты по одному;
- проще сравнивать Python и Node;
- меньше риск сломать UI;
- WebSocket-функции остаются совместимыми.

После завершения 2.0 можно отдельно решить, нужен ли переход с HTTP на Electron IPC.

### ADR-002. Node backend запускается внутри Electron main process

Не создаём второй Node child process.

Удаляем в финале:

- запуск `py -3 -m kubedeck_backend.main`;
- запуск `KubeDeck Backend.exe`;
- `backend.pid`;
- поиск свободного порта для Python;
- очистку зависшего Python backend;
- `taskkill` для backend;
- ожидание `/health` отдельного процесса.

### ADR-003. Node Gateway становится единственной точкой входа

Renderer получает только адрес и токен Node Gateway.

Во время миграции Gateway:

- выполняет уже перенесённые маршруты самостоятельно;
- проксирует legacy-маршруты в Python;
- показывает владельца каждого маршрута в диагностике.

### ADR-004. `packages/shared-types` становится каноническим контрактом

В него постепенно переносятся:

- `Settings`;
- `Cluster`;
- `ErrorInfo`;
- `CommandResult`;
- `ResourceRow`;
- запросы и ответы API;
- WebSocket-события;
- подтверждения опасных операций;
- LLM-типы;
- Port Forward и Watch-типы.

Нельзя хранить независимые копии одного типа в Python, renderer и Electron main.

### ADR-005. Формат ошибок сохраняется

Все ошибки Node должны возвращать существующий контракт:

```ts
interface ErrorInfo {
  code: string;
  message: string;
  rawStderr: string;
  commandPreview: string;
}
```

Коды ошибок должны остаться совместимыми:

- `KUBECTL_NOT_FOUND`
- `KUBECTL_INVALID_JSON`
- `KUBECTL_EMPTY_RESPONSE`
- `KUBECTL_COMMAND_FAILED`
- `TIMEOUT`
- `FORBIDDEN`
- `UNAUTHORIZED`
- `NOT_FOUND`
- `CLUSTER_UNAVAILABLE`
- `TLS_ERROR`
- `OUTPUT_TOO_LARGE`
- остальные существующие коды

### ADR-006. UI не переписывается в рамках backend-миграции

Миграция backend и редизайн интерфейса — разные задачи.

В версиях 2.0 alpha/beta разрешены только необходимые изменения UI:

- диагностика миграции;
- исправление несовместимости контрактов;
- новые сообщения об ошибках;
- технические индикаторы для тестирования.

---

## 5. Предлагаемая структура Node backend

```text
apps/desktop/src/main/
├── main.ts
├── backend/
│   ├── bootstrap.ts
│   ├── server.ts
│   ├── router.ts
│   ├── migration/
│   │   ├── routeOwnership.ts
│   │   └── legacyProxy.ts
│   ├── config/
│   │   ├── configStore.ts
│   │   ├── paths.ts
│   │   └── schemas.ts
│   ├── kubectl/
│   │   ├── command.ts
│   │   ├── runner.ts
│   │   ├── errors.ts
│   │   ├── environment.ts
│   │   └── preview.ts
│   ├── security/
│   │   ├── sessionToken.ts
│   │   ├── validation.ts
│   │   ├── confirmations.ts
│   │   └── sanitization.ts
│   ├── audit/
│   │   └── auditStore.ts
│   ├── clusters/
│   ├── resources/
│   │   ├── routes.ts
│   │   ├── normalizers.ts
│   │   └── definitions.ts
│   ├── cache/
│   ├── watch/
│   ├── logs/
│   ├── terminal/
│   ├── portForward/
│   ├── ssh/
│   ├── relations/
│   ├── problems/
│   ├── search/
│   ├── yaml/
│   └── llm/
└── ...
```

Имена каталогов могут быть уточнены после первого технического прототипа, но границы модулей должны сохраниться.

---

## 6. Предлагаемые Node-зависимости

Добавлять зависимости только по мере необходимости.

| Назначение | Предлагаемый инструмент |
|---|---|
| Локальный HTTP API | `fastify` |
| WebSocket | `@fastify/websocket` или совместимый `ws` |
| Runtime-схемы и валидация | `zod` |
| YAML | `yaml` |
| SSH | `ssh2` |
| kubectl-процессы | штатный `node:child_process` |
| Файлы и пути | штатные `node:fs`, `node:path` |
| Сеть и порты | штатный `node:net` |
| LLM HTTP | штатный `fetch` |
| Тесты | Node test runner или Vitest |

Выбор тестового runner нужно зафиксировать один раз в Alpha 1 и не менять по ходу миграции.

---

## 7. Карта переноса Python-модулей

| Python | Будущий TypeScript |
|---|---|
| `core/models.py` | `packages/shared-types` + локальные runtime-схемы |
| `core/paths.py` | `backend/config/paths.ts` |
| `core/config.py` | `backend/config/configStore.ts` |
| `core/audit.py` | `backend/audit/auditStore.ts` |
| `logging_config.py` | `backend/logging.ts` |
| `security.py` | `backend/security/*` |
| `kubectl/command.py` | `backend/kubectl/*` |
| `api/runtime.py` | `backend/runtime.ts` |
| `api/validation.py` | `backend/security/validation.ts` |
| `resources/normalizers.py` | `backend/resources/normalizers.ts` |
| `api/resource_cache.py` | `backend/cache/resourceSnapshotCache.ts` |
| `api/watch_events.py` | `backend/watch/eventHub.ts` |
| `api/watch_manager.py` | `backend/watch/watchManager.ts` |
| `api/workload_logs.py` | `backend/logs/workloadLogs.ts` |
| `api/terminal.py` | `backend/terminal/*` |
| `api/port_forward.py` | `backend/portForward/*` |
| `api/relations.py` | `backend/relations/engine.ts` |
| `api/problems.py` | `backend/problems/engine.ts` |
| `api/search.py` | `backend/search/engine.ts` |
| `llm/client.py` | `backend/llm/client.ts` |
| `llm/context.py` | `backend/llm/context.ts` |
| `llm/prompts.py` | `backend/llm/prompts.ts` |
| `api/routes_*.py` | соответствующие `routes.ts` |
| `main.py` | `backend/bootstrap.ts` + `backend/server.ts` |

---

## 8. Этапы выпуска

# 2.0.0-alpha.1 — фундамент и контракты

### Цель

Создать Node Gateway без переноса пользовательских функций.

### Работы

- создать ветку `feature/v2-node-backend`;
- зафиксировать полный список API и WebSocket-контрактов;
- расширить `packages/shared-types`;
- поднять Fastify внутри Electron main process;
- сохранить session token;
- добавить `/health`;
- добавить `/migration/status`;
- реализовать legacy proxy в Python;
- renderer переключить на Node Gateway;
- все остальные запросы пока проксировать в Python;
- добавить contract tests.

### Результат

Приложение выглядит и работает как 1.1.2, но renderer уже общается с Node Gateway.

### Условие завершения

- portable собирается;
- все текущие функции работают;
- frontend не знает адрес Python;
- Node Gateway корректно останавливается вместе с Electron;
- нет новых утечек секретов в логи.

---

# 2.0.0-alpha.2 — Config, Settings и Clusters

### Переносим

- paths;
- config store;
- config cache;
- settings;
- app info;
- kubectl status;
- import kubeconfig;
- list clusters;
- rename cluster;
- remove cluster;
- open cluster;
- open last cluster;
- namespaces;
- audit logging для этих действий.

### Python-модули

- `core/paths.py`
- `core/config.py`
- часть `core/models.py`
- `core/audit.py`
- `routes_core.py`
- `routes_clusters.py`
- `routes_audit.py`

### Условие завершения

Node и Python должны одинаково читать существующий `%APPDATA%\KubeDeck\config.json`.

Нельзя менять формат config без мигратора и резервной копии.

---

# 2.0.0-alpha.3 — Kubectl Runtime и read-only resources

### Сначала переносим ядро

- `KubectlCommand`;
- argv без shell;
- command preview;
- timeout;
- output limit;
- UTF-8;
- stderr sanitization;
- error classification;
- `NO_PROXY`;
- kubeconfig server host;
- JSON parsing.

### Затем read-only функции

- resources list;
- resource definitions;
- resource YAML;
- resource describe;
- events;
- Pod YAML;
- Pod describe;
- Pod logs без follow;
- normalizers;
- namespace usage/quota.

### Условие завершения

Для одинакового запроса Python и Node возвращают эквивалентный JSON с одинаковыми типами полей.

---

# 2.0.0-alpha.4 — изменяющие операции и безопасность

### Переносим

- YAML dry-run;
- YAML apply;
- delete;
- restart;
- scale;
- redeploy;
- node maintenance actions;
- bulk actions;
- `kubectl auth can-i`;
- typed-name confirmation;
- command-preview hash;
- Secret keys/reveal/copy audit;
- cache invalidation после изменений.

### Критические требования

- ни одна опасная операция не обходится без текущих guards;
- Node не использует `shell: true`;
- namespace, resource и name проходят валидацию;
- Secret data не попадают в логи;
- command preview не раскрывает чувствительные значения.

---

# 2.0.6 — streaming и долгоживущие процессы

### Переносим

- kubectl watch;
- Watch Event Hub;
- Resource Snapshot Cache;
- WebSocket live refresh;
- Pod terminal;
- Pod exec;
- follow logs;
- Deployment logs;
- port-forward registry;
- discovery внешних port-forward;
- Node SSH;
- остановку процессов при закрытии приложения.

### Почему отдельный этап

Это наиболее рискованный слой:

- дочерние процессы;
- WebSocket;
- stdin/stdout;
- отмена;
- reconnect;
- cleanup;
- Windows process management;
- гонки состояния.

### Условие завершения

После закрытия KubeDeck не остаются:

- `kubectl watch`;
- `kubectl logs -f`;
- `kubectl exec`;
- `kubectl port-forward`;
- SSH-сессии;
- занятые локальные порты.

---

# 2.0.6 — бизнес-движки

### Переносим

- Relations Engine;
- Problems Engine;
- cluster search;
- LLM client;
- LLM context builder;
- sanitizer;
- prompts;
- status/test/analyze/preview.

### Порядок внутри этапа

1. Relations
2. Problems
3. Search
4. LLM

### Причина

Эти модули зависят от уже перенесённых:

- типов ресурсов;
- normalizers;
- kubectl runtime;
- cache;
- events;
- logs;
- security sanitization.

---

# 2.0.0-rc.1 — полное удаление Python

### Удаляем

- `apps/backend`;
- FastAPI;
- Uvicorn;
- Paramiko;
- PyInstaller;
- Python venv;
- backend executable;
- backend PID file;
- legacy proxy;
- Python bootstrap в setup;
- Python-проверки из portable build;
- копирование backend в resources;
- Python-разделы документации.

### Изменяем

- `main.ts`;
- Electron Builder config;
- `build-portable-windows.ps1`;
- `setup-windows.ps1`;
- CI/валидацию;
- README;
- architecture docs;
- release checklist.

### Финальная проверка

На чистой Windows-машине для сборки и запуска не должен требоваться Python.

---

# 2.0.0 — стабильный релиз

Релиз разрешён только после прохождения всех parity, security, portable и cleanup-проверок.

---

## 9. Таблица владения маршрутами

В Alpha 1 создаётся явный реестр:

```ts
type RouteOwner = "node" | "python";

interface RouteOwnership {
  method: string;
  path: string;
  owner: RouteOwner;
  migratedIn?: string;
}
```

Пример:

```ts
[
  { method: "GET", path: "/health", owner: "node", migratedIn: "2.0.0-alpha.1" },
  { method: "GET", path: "/config", owner: "python" },
  { method: "GET", path: "/clusters/:id/namespaces", owner: "python" }
]
```

`/migration/status` должен возвращать:

- количество Node-маршрутов;
- количество Python-маршрутов;
- список legacy-маршрутов;
- наличие Python backend;
- активные watch/terminal/port-forward процессы.

Этот endpoint удаляется или закрывается в финальном 2.0.

---

## 10. Тестовая стратегия

### 10.1. Contract tests

Для каждого API-метода фиксируются:

- HTTP method;
- path;
- query;
- request body;
- response body;
- error body;
- status code;
- nullable/optional fields.

### 10.2. Python/Node parity tests

Один и тот же fixture отправляется в обе реализации.

Сравнение игнорирует только объективно нестабильные поля:

- PID;
- timestamp;
- duration;
- случайный ID;
- локальный порт;
- порядок элементов, если контракт его не гарантирует.

### 10.3. Golden fixtures

Нужны обезличенные fixture-файлы:

- Pods;
- Deployments;
- Services;
- Secrets без значений;
- Events;
- CRD;
- RBAC;
- проблемные Pod;
- рестарты контейнеров;
- Deployment с несколькими Pod;
- ошибки kubectl.

### 10.4. Process cleanup tests

Проверяем:

- normal completion;
- timeout;
- cancel;
- Electron shutdown;
- cluster unavailable;
- kubectl crash;
- WebSocket disconnect;
- renderer reload.

### 10.5. Security regression tests

Проверяем:

- path traversal;
- command injection;
- unsafe kubectl path;
- invalid Kubernetes names;
- oversized YAML;
- oversized kubectl output;
- Secret redaction;
- token validation;
- forbidden/unauthorized;
- confirmation bypass.

---

## 11. Правила работы над миграцией

1. Один patch/release — один функциональный блок.
2. Не переносить одновременно UI и backend-логику.
3. Не удалять Python-реализацию до parity-проверки Node.
4. Не менять API-контракт без отдельного решения.
5. Каждая перенесённая функция получает Node-тесты.
6. Каждая опасная операция получает security-тест.
7. После каждого этапа собирается portable.
8. Не добавлять Python-зависимости после начала 2.0.
9. Новые backend-функции писать сразу на Node, если их зависимости уже перенесены.
10. Hotfix для 1.x не смешивать с веткой 2.0.

---

## 12. Основные риски

| Риск | Снижение риска |
|---|---|
| Расхождение типов Python и TS | `packages/shared-types` как источник истины |
| Сломанные ошибки frontend | contract и parity tests |
| Зависшие kubectl-процессы | единый ProcessRegistry |
| Утечка Secret в лог | общий sanitizer + security tests |
| Потеря config | совместимый ConfigStore + backup |
| Регрессия watch/cache | отдельный Beta 1 |
| Сломанный port-forward | registry и cleanup tests |
| Различия Windows quoting | тесты argv и preview |
| Изменение порядка routes | явный route registry |
| Большой долгоживущий branch | маленькие alpha/beta этапы |

---

## 13. Что не делаем в рамках 2.0

- не переписываем React;
- не меняем дизайн приложения;
- не переходим с kubectl на Kubernetes SDK;
- не меняем формат kubeconfig;
- не добавляем автообновление;
- не делаем Linux/macOS сборки;
- не переписываем всё на IPC одновременно;
- не удаляем Python раньше RC.

Эти изменения можно рассматривать после стабилизации 2.0.

---

## 14. Definition of Done для финальной 2.0

Миграция завершена, когда:

- Python не требуется для запуска;
- Python не требуется для portable build;
- нет `backend.exe`;
- нет FastAPI/Uvicorn;
- нет PyInstaller;
- нет Python child process;
- renderer использует только Node Gateway;
- все REST/WebSocket маршруты работают на Node;
- все существующие frontend-функции сохранены;
- security checks перенесены;
- portable проходит smoke test;
- после закрытия приложения не остаются процессы;
- README и architecture docs соответствуют новой архитектуре;
- Graphify не показывает ссылок на удалённый Python backend.

---

## 15. Первый практический шаг

Первый patch для версии 2.0 не должен переносить функции.

Он должен содержать только:

1. `docs/NODE_MIGRATION_PLAN.md`;
2. `docs/NODE_API_CONTRACT.md`;
3. `docs/NODE_ROUTE_OWNERSHIP.md`;
4. расширение `packages/shared-types`;
5. Node Gateway с `/health`;
6. legacy proxy;
7. `/migration/status`;
8. contract test harness.

После проверки этого фундамента начинается перенос Config/Clusters.

---

## 16. Рекомендуемая последовательность веток и тегов

```text
main                         — стабильная 1.x
feature/v2-node-backend      — основная миграция

v2.0.0-alpha.1
v2.0.0-alpha.2
v2.0.0-alpha.3
v2.0.0-alpha.4
v2.0.6
v2.0.6
v2.0.0-rc.1
v2.0.0
```

Hotfix 1.x при необходимости выполняются отдельно и выборочно переносятся в v2.

---

## 17. Решение на текущий момент

Начинаем с **Phase 0 / Alpha 1 foundation**.

До отдельного подтверждения:

- рабочий backend не меняем;
- Python не удаляем;
- API не меняем;
- UI не меняем;
- portable-сборку не ломаем.

Сначала создаём точный API-контракт и Node Gateway, который способен безопасно сосуществовать с Python.
