# KubeDeck — полное техническое задание

## 1. Назначение проекта

**KubeDeck** — Windows desktop-приложение в формате Kubernetes IDE для эксплуатации, диагностики и управления Kubernetes-кластерами через локальный `kubectl`.

Проект является развитием идеи Lens/OpenLens, но основной акцент делается не только на красивом отображении ресурсов Kubernetes, а на рабочем IDE-подходе:

- быстрое переключение между кластерами;
- просмотр и управление Kubernetes-ресурсами;
- вкладки как в IDE;
- глобальный поиск;
- command palette;
- связи между ресурсами;
- диагностическая страница Problems;
- логи, pod terminal, port-forward;
- YAML editor с dry-run/diff/apply;
- CRD browser;
- подготовленный контур для будущего LLM-помощника.

Приложение не должно подключаться к Kubernetes API напрямую как основной механизм работы. Основной транспорт — системный `kubectl`, установленный в Windows.

---

## 2. Целевая платформа

Первая целевая платформа:

```text
Windows Desktop
```

Приложение должно собираться как desktop-приложение под Windows.

Системный `kubectl` не поставляется вместе с приложением. KubeDeck проверяет его наличие при старте и использует системный путь или путь, указанный пользователем в настройках.

---

## 3. Основная концепция

KubeDeck — это не просто dashboard, а Kubernetes IDE.

Основные UX-центры:

```text
ресурсы → связи → диагностика → действия → терминал → логи → diff/apply
```

Приложение должно быть удобно для DevOps/SRE/администраторов, которые привыкли работать с `kubectl`, но хотят получать:

- быстрый визуальный обзор;
- безопасные действия через UI;
- подсказки по проблемам;
- быстрый доступ к связанным объектам;
- встроенные логи и exec;
- управляемый YAML workflow.

---

## 4. Архитектура верхнего уровня

Архитектура приложения:

```text
KubeDeck
├─ Electron desktop shell
│  ├─ React + TypeScript UI
│  ├─ Electron main process
│  ├─ process-heavy kubectl operations
│  ├─ logs streaming
│  ├─ pod exec terminal
│  ├─ port-forward sessions
│  └─ lifecycle Python backend
│
├─ Python FastAPI backend
│  ├─ REST API
│  ├─ WebSocket API
│  ├─ kubectl command abstraction
│  ├─ resource normalization
│  ├─ problems engine
│  ├─ relations engine
│  ├─ CRD discovery
│  ├─ diagnostics context builder
│  └─ LLM bridge placeholder
│
└─ Local storage
   ├─ config.json
   ├─ imported kubeconfigs
   ├─ app logs
   └─ future secure LLM credentials
```

---

## 5. Технологический стек

### 5.1 Frontend/Desktop

```text
Electron
React
TypeScript
Tailwind CSS
TanStack Table
Monaco Editor
xterm.js
node-pty
```

Назначение:

- Electron — desktop shell, запуск backend, доступ к локальным файлам, управление процессами.
- React + TypeScript — основной UI.
- Tailwind — стилизация.
- TanStack Table — таблицы ресурсов.
- Monaco Editor — YAML editor и diff viewer.
- xterm.js — терминал.
- node-pty — интерактивный terminal/exec.
- Electron IPC — связь UI с main process для streaming/process-heavy операций.

### 5.2 Backend

```text
Python
FastAPI
Pydantic
PyYAML или ruamel.yaml
uvicorn
```

Назначение:

- REST API;
- WebSocket API;
- нормализация kubectl JSON;
- построение связей;
- анализ проблем;
- подготовка данных для UI;
- будущий LLM context builder.

---

## 6. Репозиторий

Проект должен быть monorepo.

Рекомендуемая структура:

```text
kubedeck/
├─ apps/
│  ├─ desktop/
│  │  ├─ src/
│  │  │  ├─ main/
│  │  │  ├─ preload/
│  │  │  └─ renderer/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ electron-builder.yml
│  │
│  └─ backend/
│     ├─ kubedeck_backend/
│     │  ├─ main.py
│     │  ├─ api/
│     │  ├─ core/
│     │  ├─ kubectl/
│     │  ├─ resources/
│     │  ├─ problems/
│     │  ├─ relations/
│     │  ├─ diagnostics/
│     │  ├─ crd/
│     │  ├─ metrics/
│     │  ├─ llm/
│     │  └─ logging_config.py
│     ├─ pyproject.toml
│     └─ README.md
│
├─ packages/
│  ├─ shared-types/
│  └─ ui/
│
├─ docs/
│  ├─ architecture.md
│  ├─ api.md
│  ├─ kubectl-commands.md
│  └─ security.md
│
├─ scripts/
│  ├─ dev.ps1
│  ├─ build.ps1
│  └─ package-windows.ps1
│
├─ README.md
└─ KUBEDECK_SPEC.md
```

---

## 7. Жизненный цикл приложения

### 7.1 Запуск

При запуске KubeDeck:

1. Electron стартует desktop window.
2. Electron запускает Python FastAPI backend как child process.
3. Backend слушает только `127.0.0.1`.
4. Порт backend выбирается автоматически или передаётся через переменную окружения.
5. Electron передаёт renderer-процессу фактический backend URL.
6. Выполняется health-check backend.
7. Выполняется проверка `kubectl`.
8. Если есть последний рабочий кластер — приложение пытается открыть его.
9. Если кластер недоступен — показывается экран `Cluster unavailable`.

### 7.2 Завершение

При закрытии приложения:

1. Активные streaming-процессы должны быть остановлены.
2. Активные port-forward процессы должны быть остановлены.
3. Pod terminal процессы должны быть завершены.
4. Python backend child process должен быть корректно остановлен.
5. Логи приложения должны быть сброшены на диск.

---

## 8. Локальное хранение данных

### 8.1 Пути

```text
%APPDATA%\KubeDeck\
├─ config.json
├─ kubeconfigs\
│  ├─ <cluster-id>.yaml
│  └─ ...
└─ logs\
   ├─ desktop.log
   ├─ backend.log
   ├─ kubectl.log
   └─ crash.log
```

### 8.2 config.json

Пример:

```json
{
  "clusters": [
    {
      "id": "8d5a02d5-0e4e-4e39-9f2f-57e5b31cc6e3",
      "displayName": "infra-prod",
      "kubeconfigPath": "%APPDATA%\\KubeDeck\\kubeconfigs\\8d5a02d5-0e4e-4e39-9f2f-57e5b31cc6e3.yaml",
      "lastOpened": true,
      "createdAt": "2026-05-22T10:00:00Z",
      "updatedAt": "2026-05-22T10:00:00Z"
    }
  ],
  "settings": {
    "kubectlPath": "kubectl",
    "language": "system",
    "theme": "system",
    "refreshIntervalSeconds": 10,
    "logsTailLines": 500,
    "secretRevealTimeoutSeconds": 30,
    "restartProblemThreshold": 3,
    "terminalFontSize": 13,
    "logsSince": "",
    "llm": {
      "enabled": false,
      "baseUrl": "",
      "model": "",
      "apiKeyRef": ""
    }
  }
}
```

### 8.3 Что можно сохранять

Сохраняются:

- список кластеров;
- отображаемые имена кластеров;
- путь к импортированному kubeconfig;
- последний открытый кластер;
- настройки UI;
- путь к kubectl;
- настройки языка и темы;
- настройки логов;
- настройки будущего LLM-провайдера без открытого хранения API key.

Не сохраняются:

- кэш Kubernetes-ресурсов;
- открытые вкладки после перезапуска;
- значения Secrets;
- история выполненных действий;
- terminal sessions;
- port-forward sessions;
- содержимое логов Kubernetes, если пользователь явно не скачал файл.

---

## 9. Управление kubeconfig и кластерами

### 9.1 Импорт kubeconfig

Пользователь добавляет kubeconfig через UI:

```text
Add kubeconfig → выбрать файл → приложение копирует файл в %APPDATA%\KubeDeck\kubeconfigs\
```

Требования:

- один kubeconfig = один кластер/context;
- в одном импортируемом kubeconfig ожидается один рабочий context;
- приложение создаёт внутренний `clusterId`;
- пользователь может переименовать кластер;
- отображаемое имя хранится отдельно от имени context;
- при удалении кластера из KubeDeck импортированный kubeconfig удаляется из папки приложения.

### 9.2 Список кластеров

Список должен быть обычным, без групп.

Для каждого кластера показывать:

- display name;
- статус доступности;
- путь к kubeconfig;
- последнее открытие;
- кнопки: open, rename, remove.

### 9.3 Открытие последнего кластера

При старте приложение пытается открыть последний рабочий кластер.

Если кластер недоступен:

```text
Cluster unavailable
Reason: raw/human readable error
Actions:
- Retry
- Open kubeconfig info
- Open local terminal
- Remove cluster from KubeDeck
```

Отдельная кнопка "проверить кластер" в списке не нужна.

---

## 10. Работа с kubectl

### 10.1 Системный kubectl

KubeDeck использует системный `kubectl`.

Startup check:

```bash
kubectl version --client -o json
```

Если `kubectl` не найден:

```text
KUBECTL_NOT_FOUND
```

UI должен показать понятную ошибку и дать возможность указать путь к `kubectl.exe` в Settings.

### 10.2 Проверка кластера

При открытии кластера:

```bash
kubectl --kubeconfig <file> cluster-info
kubectl --kubeconfig <file> get namespaces -o json
```

При ошибке показать:

- human readable message;
- raw stderr;
- command preview;
- copy error.

### 10.3 Единая абстракция команды

Все kubectl-команды должны проходить через единую модель:

```ts
type KubectlCommand = {
  id: string
  clusterId: string
  kubeconfigPath: string
  namespace?: string
  args: string[]
  dangerousLevel: 0 | 1 | 2 | 3
  preview: string
  timeoutSeconds?: number
  stream: boolean
  cancellable: boolean
}
```

Назначение:

- единый command preview;
- единая обработка stderr/stdout;
- таймауты;
- отмена;
- подтверждения;
- интеграция с `kubectl auth can-i`;
- трассировка в app logs.

### 10.4 Таймауты

Дефолтные таймауты:

```text
get/describe/top: 30s
dry-run/diff/apply: 60s
delete: 60s
logs initial load: 30s
logs follow: no timeout
exec terminal: no timeout
port-forward: no timeout
```

Все долгие команды должны иметь возможность Cancel/Stop.

---

## 11. Разделение ответственности Electron и Python

### 11.1 Electron main process

Electron отвечает за process-heavy и streaming-heavy сценарии:

- запуск/остановка Python backend;
- pod terminal через `kubectl exec`;
- `node-pty`;
- `kubectl logs -f`;
- workload combined logs;
- port-forward sessions;
- управление child process;
- открытие локальных файлов/папок;
- открытие браузера для port-forward;
- IPC с renderer.

### 11.2 Python backend

Python backend отвечает за:

- REST API;
- WebSocket API для событий/обновлений, где это удобно;
- нормализацию kubectl JSON;
- Problems engine;
- Relations engine;
- CRD discovery;
- metrics parsing;
- diagnostics context builder;
- LLM bridge placeholder;
- централизованные модели Pydantic;
- backend logs.

---

## 12. Internal API

### 12.1 REST

Примерные endpoints:

```text
GET  /health
GET  /settings
PUT  /settings

GET  /kubectl/status

GET  /clusters
POST /clusters/import
PATCH /clusters/{clusterId}
DELETE /clusters/{clusterId}
POST /clusters/{clusterId}/open

GET  /clusters/{clusterId}/namespaces

GET  /clusters/{clusterId}/resources/{resourceType}
GET  /clusters/{clusterId}/resources/{resourceType}/{namespace}/{name}
GET  /clusters/{clusterId}/resources/{resourceType}/{namespace}/{name}/yaml
GET  /clusters/{clusterId}/resources/{resourceType}/{namespace}/{name}/describe
GET  /clusters/{clusterId}/resources/{resourceType}/{namespace}/{name}/events

POST /clusters/{clusterId}/actions/restart
POST /clusters/{clusterId}/actions/scale
POST /clusters/{clusterId}/actions/delete
POST /clusters/{clusterId}/actions/cordon
POST /clusters/{clusterId}/actions/uncordon
POST /clusters/{clusterId}/actions/drain

POST /clusters/{clusterId}/yaml/dry-run
POST /clusters/{clusterId}/yaml/diff
POST /clusters/{clusterId}/yaml/apply

GET  /clusters/{clusterId}/problems
GET  /clusters/{clusterId}/relations/{resourceType}/{namespace}/{name}
GET  /clusters/{clusterId}/metrics/nodes
GET  /clusters/{clusterId}/metrics/pods

GET  /clusters/{clusterId}/crds
GET  /clusters/{clusterId}/crds/{crdName}/instances

POST /clusters/{clusterId}/diagnostics/collect
```

### 12.2 WebSocket / IPC streaming

Streaming-сценарии:

```text
logs
follow logs
combined workload logs
pod terminal
run command
port-forward status
events live feed
resource updates
```

Для terminal/logs/port-forward предпочтительно использовать Electron IPC + node process management, а не гонять всё через Python.

---

## 13. UI layout

Основной layout:

```text
┌──────────────────────────────────────────────┐
│ Top bar: cluster / namespace / search / status│
├───────────────┬──────────────────────────────┤
│ Sidebar       │ Tabs                         │
│ - Overview    │ Overview | Problems | pod... │
│ - Problems    ├──────────────────────────────┤
│ - Workloads   │ Main content                 │
│ - Network     │                              │
│ - Storage     │                              │
│ - Config      │                              │
│ - CRD         │                              │
│ - Events      │                              │
│ - PortForward │                              │
│ - Terminal    │                              │
│ - Settings    │                              │
└───────────────┴──────────────────────────────┘
```

Стиль:

- dark-first;
- плотный IDE-интерфейс;
- поддержка dark/light/system theme;
- RU/EN интерфейс;
- верхний cluster selector;
- глобальный namespace selector;
- global resource search;
- command palette;
- вкладки.

Вкладки не сохраняются после перезапуска приложения.

---

## 14. Navigation / Sidebar

Разделы:

```text
Overview
Problems

Workloads
├─ Pods
├─ Deployments
├─ StatefulSets
├─ DaemonSets
├─ ReplicaSets
├─ Jobs
└─ CronJobs

Network
├─ Services
├─ Ingresses
├─ Endpoints
└─ NetworkPolicies

Storage
├─ PVC
├─ PV
└─ StorageClasses

Config
├─ ConfigMaps
├─ Secrets
├─ ServiceAccounts
├─ Roles
├─ RoleBindings
├─ ClusterRoles
└─ ClusterRoleBindings

CRD
Events
Port Forwards
Terminal
Settings
```

---

## 15. Namespace selector

Глобальный namespace selector:

```text
All namespaces
<namespace-1>
<namespace-2>
...
```

Поведение:

- влияет на обычные списки ресурсов;
- открытые вкладки конкретных ресурсов остаются привязаны к namespace ресурса;
- избранные namespace не нужны.

---

## 16. Command palette

Должна быть command palette по типу VS Code.

Горячая клавиша:

```text
Ctrl+Shift+P
```

Команды:

```text
Switch cluster
Switch namespace
Open pod
Open deployment
Open service
Open events
Open problems
Restart deployment
View logs
Open pod terminal
Run command in pod
Port-forward service
Apply YAML
Open settings
```

---

## 17. Глобальный поиск

Global search ищет по текущему кластеру и текущему namespace scope.

Поиск должен находить:

- Pods;
- Deployments;
- StatefulSets;
- DaemonSets;
- Services;
- Ingresses;
- ConfigMaps;
- Secrets;
- PVC;
- Nodes;
- CRD instances.

Результат:

```text
kind / namespace / name / status / quick action
```

При клике ресурс открывается во вкладке или drawer.

---

## 18. Таблицы ресурсов

Все таблицы должны поддерживать:

- поиск;
- сортировку;
- фильтры;
- column visibility;
- bulk select;
- context menu;
- refresh;
- open in tab;
- open details drawer;
- виртуализацию для больших кластеров.

Экспорт таблиц в CSV не нужен в первой реализации.

---

## 19. Базовая модель ресурса

Общая нормализованная модель:

```ts
type KubeResource = {
  apiVersion: string
  kind: string
  name: string
  namespace?: string
  uid: string
  labels: Record<string, string>
  annotations: Record<string, string>
  createdAt: string
  statusSummary: string
  raw: unknown
}
```

Для каждого типа ресурса добавляются специализированные поля.

---

## 20. Resource drawer / tabs

При клике на ресурс открывается drawer или вкладка.

Для Pod:

```text
Summary
Containers
Conditions
Events
Logs
YAML
Describe
Related resources
Actions
```

Для Deployment:

```text
Summary
Pods
ReplicaSets
Events
Logs
YAML
Describe
Related resources
Actions
```

Для Service:

```text
Summary
Endpoints
Matching Pods
Ingresses
YAML
Describe
Related resources
Actions
```

`kubectl describe` показывать как raw output в отдельной вкладке/табe.

---

## 21. Bulk actions

Bulk select нужен.

Разрешённые bulk-действия:

### Pods

```text
copy names
delete selected pods
combined logs
describe selected
```

### Workloads

```text
rollout restart selected
scale selected
delete selected with strict confirmation
```

### PVC/PV/Secrets/Namespaces/CRD

Bulk delete по умолчанию выключить.

---

## 22. Уровни опасных действий

### Level 1

```text
restart rollout
scale
delete pod
cordon/uncordon
```

Поведение:

```text
confirm + command preview
```

### Level 2

```text
delete deployment/statefulset/daemonset
delete service/ingress
delete secret
delete configmap
delete CRD instance
```

Поведение:

```text
confirm + command preview + resource name input
```

### Level 3

```text
delete namespace
delete pvc/pv
drain node
edit/apply CRD definition
delete CRD definition
clusterrole/clusterrolebinding changes
```

Поведение:

```text
confirm + command preview + resource name input + cluster name input
```

Для потенциально опасных действий command preview обязателен.

---

## 23. Проверка прав через kubectl auth can-i

Перед Level 2/3 действиями выполнять:

```bash
kubectl --kubeconfig <file> auth can-i <verb> <resource> -n <namespace>
```

Если результат `no`:

- действие блокируется;
- UI показывает понятное сообщение и raw output.

Если `can-i` вернул ошибку:

- показать предупреждение;
- не обязательно блокировать действие, если пользователь явно подтверждает;
- raw stderr должен быть доступен.

---

## 24. YAML editor

YAML workflow:

```text
View YAML
Edit YAML
Dry-run
Diff side-by-side
Apply
```

Команды:

```bash
kubectl --kubeconfig <file> apply --dry-run=server -f <tempfile>
kubectl --kubeconfig <file> diff -f <tempfile>
kubectl --kubeconfig <file> apply -f <tempfile>
```

`replace` — только в advanced mode.

Перед apply:

- side-by-side diff;
- command preview;
- confirmation;
- для dangerous resources — ввод имени/кластера согласно уровню.

### New YAML

Должен быть режим:

```text
New YAML
Paste manifest
Dry-run
Diff
Apply
```

После успешного apply KubeDeck должен попытаться определить созданный ресурс и открыть его во вкладке.

---

## 25. Secrets

Secrets показываются так:

### Таблица

```text
name
namespace
type
age
keys count
```

### Detail

```text
metadata
key names
values hidden
raw YAML
```

Возможности:

- reveal decoded value;
- copy decoded value;
- auto-hide через `secretRevealTimeoutSeconds`, по умолчанию 30 секунд;
- raw YAML доступен;
- decoded edit не обязателен на первом этапе.

Предупреждение при копировании в Windows clipboard не требуется.

---

## 26. Logs viewer

Реализация через `kubectl logs`.

Режимы:

```text
current logs
previous logs
follow logs
workload combined logs
container select
tail lines
since
timestamps
regex search
pause
download
wrap toggle
clear view
```

Примеры команд:

```bash
kubectl --kubeconfig <file> logs -n <ns> <pod> -c <container> --tail=500
kubectl --kubeconfig <file> logs -n <ns> <pod> -c <container> --previous --tail=500
kubectl --kubeconfig <file> logs -n <ns> <pod> -c <container> -f --tail=500
```

Для workload combined logs:

1. определить pods по selector;
2. запустить несколько `kubectl logs -f`;
3. префиксовать строки:

```text
[pod/container] message
```

---

## 27. Pod terminal

Pod terminal через:

```bash
kubectl --kubeconfig <file> exec -it -n <ns> <pod> -c <container> -- /bin/bash
kubectl --kubeconfig <file> exec -it -n <ns> <pod> -c <container> -- /bin/sh
```

Auto mode:

1. попробовать `/bin/bash`;
2. если ошибка — попробовать `/bin/sh`;
3. если ошибка — показать custom command.

Для multi-container pod выбор контейнера обязателен.

Shell preference не сохранять.

---

## 28. Run command

Должна быть отдельная функция:

```text
Pod → Run command
```

Параметры:

```text
container
command
timeout
```

Результат открывается в отдельной вкладке.

Пример:

```bash
kubectl --kubeconfig <file> exec -n <ns> <pod> -c <container> -- env
```

---

## 29. Port-forward

Реализация через:

```bash
kubectl --kubeconfig <file> port-forward -n <ns> svc/<name> <local>:<remote>
kubectl --kubeconfig <file> port-forward -n <ns> pod/<name> <local>:<remote>
```

UI:

```text
Port Forwards
├─ cluster
├─ namespace
├─ resource
├─ local port
├─ remote port
├─ status
├─ copy URL
├─ open browser
└─ stop
```

Поведение:

- local port по умолчанию = remote port;
- если local port занят — предложить следующий свободный;
- опция `Open in browser after start`;
- активные port-forward сессии не сохраняются после перезапуска.

---

## 30. Metrics

Реализация через:

```bash
kubectl --kubeconfig <file> top nodes
kubectl --kubeconfig <file> top pods -A
kubectl --kubeconfig <file> top pod <pod> -n <ns> --containers
```

Поведение:

- если metrics API недоступен, показать `Metrics unavailable`;
- отсутствие metrics-server не считать проблемой кластера;
- мини-графики строить локально;
- точки графиков хранить только in-memory, пока приложение открыто.

---

## 31. Events

Events показываются в трёх местах:

```text
Global Events page
Resource details → Events tab
Problems page → Warning events
```

### Local events feed

Локальная лента событий:

- хранится только пока приложение открыто;
- dedup по involvedObject + reason + message;
- счётчик повторений;
- pause;
- clear;
- export в файл.

---

## 32. Problems engine

Problems page — live dashboard.

Категории и порядок:

### Pods

```text
Pending
CrashLoopBackOff
ImagePullBackOff
Error
OOMKilled
restartCount >= 3
```

### Workloads

```text
Deployment unavailable replicas
StatefulSet unavailable replicas
DaemonSet unavailable pods
Job failed
CronJob suspended
```

### Nodes

```text
NotReady
DiskPressure
MemoryPressure
PIDPressure
NetworkUnavailable
unschedulable
```

### Storage

```text
PVC Pending
PV Released/Failed
volume attach/mount warning events
```

### Network

```text
Service without endpoints
Ingress backend service missing
Endpoints empty
```

### Events

```text
Warning events
repeated warning events
```

Severity:

```text
Critical
Warning
Info
```

Порог рестартов:

```text
restartCount >= 3
```

Порог должен быть настраиваемым в Settings.

---

## 33. Relations engine

Relations engine — одна из ключевых функций KubeDeck.

### Pod relations

```text
Owner ReplicaSet
Owner Deployment/StatefulSet/DaemonSet/Job
Node
PVC
ConfigMaps
Secrets
ServiceAccount
Services by selector
Ingresses through services
Events
NetworkPolicies
PDB
```

### Deployment relations

```text
ReplicaSets
Pods
Services
Ingresses
ConfigMaps
Secrets
PVC through pods
HPA
PDB
Events
```

### Service relations

```text
matching pods
endpoints
ingresses
network policies maybe
```

### PVC relations

```text
pods using PVC
PV
StorageClass
events
```

---

## 34. CRD support

CRD section:

```text
Custom Resources
├─ Groups
│  ├─ argoproj.io
│  ├─ traefik.io
│  ├─ cert-manager.io
│  └─ longhorn.io
└─ Resources
   ├─ applications.argoproj.io
   ├─ ingressroutes.traefik.io
   └─ volumes.longhorn.io
```

Команды:

```bash
kubectl --kubeconfig <file> get crd -o json
kubectl --kubeconfig <file> get <resource>.<group> -A -o json
```

Требования:

- определять namespaced/cluster-scoped из CRD definition;
- CRD definitions — view-only по умолчанию;
- CRD instances — view/edit/delete;
- edit/delete CRD instance требует command preview и ввод имени;
- edit/apply/delete CRD definition относится к Level 3.

---

## 35. RBAC / Forbidden UX

Если у kubeconfig нет прав на ресурс:

```text
Forbidden by RBAC
```

UI должен:

- не скрывать раздел;
- показывать понятную ошибку;
- показывать raw stderr в раскрываемом блоке;
- давать copy error.

---

## 36. Diagnostics package

Функция `Collect diagnostics` не является приоритетом foundation build, но должна быть заложена архитектурно.

Для pod/deployment/namespace в будущем собирать:

```text
yaml
describe
events
logs current
logs previous
related resources
```

Секреты должны санитайзиться.

---

## 37. LLM bridge placeholder

На первом этапе LLM не реализуется полноценно, но архитектурный контур должен быть заложен.

Settings:

```text
LLM Provider
├─ enabled
├─ base URL
├─ API key
├─ model
├─ max log lines
├─ sanitize secrets
└─ test connection
```

API key в будущем хранить через Windows Credential Manager, не открытым текстом в config.json.

LLM context builder должен уметь готовить sanitized context:

```text
pod yaml
events
logs
owner resource
node info
pvc info
related resources
```

Нужно маскировать:

```text
Secret values
tokens
passwords
keys
kubeconfig
bearer tokens
imagePullSecrets
sensitive annotations
```

---

## 38. i18n

Интерфейс должен поддерживать:

```text
RU
EN
system
```

Язык по умолчанию:

```text
если система ru-RU → русский
иначе английский
```

Frontend хранит словари:

```text
locales/ru.json
locales/en.json
```

Backend отдаёт коды ошибок:

```text
KUBECTL_NOT_FOUND
CLUSTER_UNAVAILABLE
FORBIDDEN
TIMEOUT
KUBECTL_COMMAND_FAILED
METRICS_UNAVAILABLE
```

UI переводит их на выбранный язык.

---

## 39. App logs

Логи приложения обязательны, так как они нужны для отладки и исправления кода.

Путь:

```text
%APPDATA%\KubeDeck\logs\
```

Файлы:

```text
desktop.log
backend.log
kubectl.log
crash.log
```

В Settings должна быть кнопка:

```text
Open app logs folder
```

В логах должны быть:

- startup lifecycle;
- backend start/stop;
- kubectl command previews;
- stderr/stdout summaries;
- errors;
- crashes;
- port-forward lifecycle;
- terminal start/stop;
- logs stream errors.

Не логировать значения Secrets и чувствительные данные.

---

## 40. Settings

Минимальные настройки:

```text
kubectl path
refresh interval
theme: dark/light/system
language: ru/en/system
default logs tail
default logs since
terminal font size
secret reveal timeout
restart threshold
LLM API key/base URL/model placeholder
open app logs folder
```

---

## 41. Resource cache

Кэш ресурсов:

- только in-memory;
- не сохраняется на диск;
- используется для таблиц, связей, проблем и поиска;
- обновляется polling/watch-гибридом.

### Initial load при открытии кластера

Сразу грузить:

```text
namespaces
nodes
pods
deployments
statefulsets
daemonsets
services
events
top nodes/pods if available
```

Lazy load при открытии раздела:

```text
secrets
configmaps
roles
rolebindings
clusterroles
pv/pvc
ingress
crd
custom resources
```

---

## 42. Обновление данных

Гибридная модель:

```text
Resource tables:
polling каждые N секунд

Opened resource drawer:
обновление чаще или manual refresh

Logs:
stream через kubectl logs -f

Pod terminal:
stream через kubectl exec -it

Events:
polling/watch hybrid, local feed

CRD:
load on section open, then refresh by user/polling
```

Refresh interval настраиваемый:

```text
5s / 10s / 30s / manual
```

Дефолт:

```text
10s
```

---

## 43. Foundation build

Первая техническая сборка называется **Foundation build**, не MVP.

Цель — построить архитектурный каркас, который не ломает будущую полную задумку.

### 43.1 Desktop shell

```text
Electron window
React layout
dark theme
RU/EN i18n base
Settings screen
```

### 43.2 Backend

```text
Python FastAPI child process
health endpoint
kubectl check
app logs
backend logs
```

### 43.3 Clusters

```text
import kubeconfig
copy to AppData
cluster list
rename cluster
remove cluster
open last cluster
cluster unavailable screen
```

### 43.4 Kubernetes resources

```text
namespace selector
pods table
deployments table
services table
events page
pod details drawer
raw YAML viewer
describe tab
logs current/follow
```

Foundation build acceptance criteria:

- приложение запускается на Windows;
- backend стартует вместе с Electron;
- backend доступен только на localhost;
- приложение проверяет `kubectl`;
- пользователь может импортировать kubeconfig;
- kubeconfig копируется в AppData;
- кластер появляется в списке;
- кластер можно переименовать;
- приложение может открыть кластер;
- namespace selector загружает namespaces;
- pods/deployments/services/events отображаются через `kubectl`;
- pod details drawer показывает summary/YAML/describe/logs;
- ошибки kubectl показываются с raw stderr;
- app logs пишутся в `%APPDATA%\KubeDeck\logs\`.

---

## 44. Последующие этапы после Foundation build

### Stage 2 — Resource Explorer

```text
all workload resources
network resources
storage resources
config resources
bulk select
context menu
tabs
global search
command palette
```

### Stage 3 — Logs / Terminal / Port-forward

```text
previous logs
workload logs
regex search
download logs
pod terminal
run command tab
port-forward panel
```

### Stage 4 — YAML Operations

```text
edit YAML
dry-run
side-by-side diff
apply
new YAML
advanced replace
danger confirmations
kubectl auth can-i
```

### Stage 5 — Problems / Relations / Metrics

```text
Problems live dashboard
severity
relations engine
metrics through kubectl top
in-memory mini graphs
local events feed
```

### Stage 6 — CRD

```text
CRD browser
CRD discovery
custom resource instances
CRD instance edit/delete
CRD definition view-only
```

### Stage 7 — Diagnostics / LLM Placeholder

```text
collect diagnostics
sanitizer
LLM settings
LLM context builder
disabled explain buttons or experimental explain
```

---

## 45. Критические требования качества

1. Не блокировать UI долгими kubectl-командами.
2. Все долгие процессы должны быть cancellable.
3. Не сохранять Kubernetes resource cache на диск.
4. Не логировать secret values.
5. Всегда показывать raw stderr для kubectl ошибок.
6. Все dangerous actions должны иметь command preview.
7. Level 2/3 actions требуют дополнительных подтверждений.
8. Backend должен слушать только localhost.
9. Приложение должно быть работоспособно без metrics-server.
10. Отсутствие прав RBAC должно отображаться как состояние, а не как баг.
11. Таблицы должны быть готовы к большим кластерам через virtualization.
12. UI должен быть RU/EN.
13. App logs обязательны.
14. Системный kubectl является обязательной зависимостью.
15. Архитектура должна оставлять место под будущие integrations/plugins.

---

## 46. Нефункциональные требования

### Производительность

- UI не должен подвисать на больших таблицах.
- Таблицы должны использовать virtualization.
- Поиск должен быть debounced.
- Логи должны стримиться построчно.
- Workload logs должны поддерживать остановку.

### Безопасность

- Backend bind только на `127.0.0.1`.
- Не хранить Secrets на диске.
- Не логировать sensitive values.
- LLM API key в будущем хранить через Windows Credential Manager.
- Для опасных действий обязательны подтверждения.

### Надёжность

- При падении backend UI должен показать ошибку.
- При зависшей kubectl-команде должна быть возможность cancel.
- При закрытии приложения child processes должны завершаться.
- Port-forward и terminal sessions не должны оставаться висеть после выхода.

### Расширяемость

- Problems engine и Relations engine должны быть отдельными модулями.
- CRD support должен быть универсальным.
- LLM bridge должен быть отдельным модулем.
- Integrations/plugins можно добавить позже без переписывания core.

---

## 47. Термины

```text
Cluster
  Внутренняя сущность KubeDeck, соответствующая одному импортированному kubeconfig.

Context
  Kubernetes context внутри kubeconfig. В KubeDeck предполагается один context на один kubeconfig.

Resource
  Kubernetes object: Pod, Deployment, Service, Secret, CRD instance и т.д.

Dangerous action
  Действие, которое может изменить или удалить ресурс.

Relations engine
  Модуль, который строит связи между Kubernetes-ресурсами.

Problems engine
  Модуль, который анализирует текущее состояние ресурсов и формирует список проблем.

Foundation build
  Первая техническая сборка, которая закладывает архитектурный каркас.
```

---

## 48. Итоговая формула проекта

```text
KubeDeck = Windows Kubernetes IDE поверх kubectl

Не просто Lens-клон, а рабочая среда для эксплуатации:
- видеть ресурсы;
- видеть связи;
- видеть проблемы;
- безопасно выполнять действия;
- смотреть логи;
- заходить в pod terminal;
- делать port-forward;
- редактировать YAML через dry-run/diff/apply;
- готовить контекст для будущего LLM-помощника.
```
