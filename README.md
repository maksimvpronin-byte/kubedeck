# KubeDeck

KubeDeck — Windows desktop Kubernetes IDE.

Проект предназначен для удобной работы с Kubernetes-кластерами из Windows-приложения без необходимости вручную запускать длинные `kubectl`-команды.

Текущая версия проекта: **1.1.2**.

---

## Основная идея

KubeDeck состоит из нескольких частей:

| Часть | Технологии | Назначение |
|---|---|---|
| Desktop UI | Electron, React, TypeScript | Окно приложения, интерфейс, таблицы ресурсов, drawer, YAML, логи |
| Backend | Python, FastAPI | Нормализация данных Kubernetes, health-check, локальные API |
| Kubernetes CLI | kubectl | Реальное взаимодействие с Kubernetes-кластерами |

Backend запускается локально вместе с desktop-приложением и слушает только `127.0.0.1`.

---

## Что умеет приложение

На текущем этапе KubeDeck умеет:

- импортировать kubeconfig через UI;
- хранить kubeconfig-файлы в `%APPDATA%\KubeDeck\kubeconfigs`;
- показывать список кластеров/контекстов;
- переименовывать кластеры в UI;
- открывать последний выбранный кластер;
- выбирать namespace;
- показывать Kubernetes-ресурсы:
  - Pods;
  - Deployments;
  - Services;
  - ConfigMaps;
  - Secrets;
  - Ingresses;
  - Jobs;
  - CronJobs;
  - StatefulSets;
  - DaemonSets;
  - PersistentVolumes;
  - PersistentVolumeClaims;
  - StorageClasses;
  - Nodes;
  - Namespaces;
  - ServiceAccounts;
  - RBAC resources;
  - Events;
  - CRD definitions;
  - CRD instances;
- открывать detail drawer ресурса;
- смотреть YAML ресурса;
- редактировать YAML с dry-run/apply;
- смотреть `kubectl describe`;
- смотреть Events по ресурсу;
- смотреть Related resources;
- смотреть Pod logs;
- смотреть Deployment logs сразу по всем Pod выбранного Deployment;
- выполнять Pod terminal через `kubectl exec`;
- запускать port-forward;
- смотреть Problems dashboard;
- смотреть Secrets с reveal/copy/auto-hide;
- выполнять опасные действия с подтверждениями;
- выполнять bulk delete;
- использовать RU/EN интерфейс;
- использовать dark/light/system theme;
- анализировать ресурсы через локальный OpenAI-compatible LLM API.

---

## Local LLM diagnostics

KubeDeck 1.1.2 может подключаться к локальному OpenAI-compatible Chat Completions API и добавлять ручную диагностику в LLM tab внутри resource drawer.

Поддерживается провайдер:

- `openai_compatible`

Примеры endpoint:

```text
LM Studio: http://127.0.0.1:1234/v1
Ollama OpenAI-compatible: http://127.0.0.1:11434/v1
```

API token опционален. Если поле пустое, KubeDeck не отправляет заголовок `Authorization`.

Настройки хранятся локально в:

```text
%APPDATA%\KubeDeck\config.json
```

API keys маскируются в UI.

Контекст ресурса перед отправкой в локальный endpoint очищается и обрезается. Kubernetes Secret data, bearer tokens, passwords, private keys и sensitive key-like fields редактируются/скрываются.

Анализ никогда не запускается автоматически. Нужно открыть ресурс, выбрать LLM tab и нажать `Analyze resource`.

---

# Быстрый старт для Windows

Этот вариант предназначен для чистой Windows-машины. Скрипт сам поставит нужные зависимости, скачает проект и соберёт portable `.exe`.

## 1. Открой PowerShell от имени администратора

Нажми:

```text
Start -> PowerShell -> Run as administrator
```

## 2. Выполни одну команду

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
$Script = "$env:TEMP\kubedeck-setup.ps1"
Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/maksimvpronin-byte/kubedeck/main/scripts/setup-windows.ps1" -OutFile $Script
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script -Clone -Build
```

## 3. Что сделает скрипт

Скрипт выполнит полный bootstrap:

1. Проверит, что запуск идёт на Windows.
2. Проверит наличие `winget`.
3. Установит недостающие программы:
   - Git;
   - Node.js LTS;
   - Python 3.11;
   - kubectl.
4. Склонирует репозиторий в:

```text
%USERPROFILE%\KubeDeck
```

5. Установит npm-зависимости.
6. Установит Python-зависимости backend.
7. Запустит проверку проекта.
8. Соберёт portable-версию.

## 4. Где будет готовый файл

После успешной сборки portable-файл будет здесь:

```text
%USERPROFILE%\KubeDeck\apps\desktop\release\KubeDeck-Portable-1.1.2-x64.exe
```

Запусти его двойным кликом.

---

# Если проект уже скачан

Если репозиторий уже есть на диске, например:

```text
C:\Users\Fidel\Documents\kubedeck\kubedeck
```

открой PowerShell в этой папке и выполни:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -Build
```

Скрипт не будет заново клонировать проект. Он использует текущую папку.

---

# Требования

Минимально нужны:

| Компонент | Версия | Зачем |
|---|---:|---|
| Windows | 10/11 x64 | Целевая ОС |
| PowerShell | 5.1+ | Запуск скриптов |
| winget | актуальный | Автоматическая установка зависимостей |
| Git | актуальный | Клонирование репозитория |
| Node.js | 20+ / LTS | Сборка desktop-части |
| npm | вместе с Node.js | Установка JS-зависимостей |
| Python | 3.11+ | Backend |
| Python Launcher | `py` | Запуск Python из скриптов |
| kubectl | актуальный | Доступ к Kubernetes |

Проверка вручную:

```powershell
git --version
node --version
npm --version
py -3 --version
kubectl version --client
```

---

# Важное про kubectl

KubeDeck **не кладёт `kubectl.exe` внутрь portable-сборки**.

Это сделано специально. Приложение использует:

1. `kubectl` из системного `PATH`; или
2. путь до `kubectl.exe`, указанный в Settings приложения.

Установить kubectl вручную можно так:

```powershell
winget install -e --id Kubernetes.kubectl
```

Проверить:

```powershell
kubectl version --client
```

Если `kubectl` лежит не в `PATH`, укажи полный путь в настройках KubeDeck, например:

```text
C:\Tools\kubectl\kubectl.exe
```

---

# Первый запуск

После запуска portable `.exe`:

1. Открой Settings.
2. Проверь путь до `kubectl`.
3. Импортируй kubeconfig.
4. Выбери кластер/context.
5. Выбери namespace.
6. Проверь основные разделы:
   - Pods;
   - Deployments;
   - Services;
   - Events;
   - Problems.

---

# Где лежат настройки и логи

KubeDeck хранит пользовательские данные здесь:

```text
%APPDATA%\KubeDeck
```

Основные файлы и папки:

```text
%APPDATA%\KubeDeck\
  config.json
  kubeconfigs\
  logs\
    desktop.log
    backend.log
    kubectl.log
```

| Путь | Назначение |
|---|---|
| `config.json` | Настройки приложения |
| `kubeconfigs\` | Импортированные kubeconfig-файлы |
| `logs\desktop.log` | Логи Electron/Desktop |
| `logs\backend.log` | Логи Python backend |
| `logs\kubectl.log` | Диагностические логи kubectl-вызовов |

---

# Сборка portable вручную

Из корня проекта:

```powershell
npm.cmd ci --no-audit --no-fund
py -3 -m pip install --user -r .\apps\backend\requirements.txt
py -3 -m pip install --user pytest
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable-windows.ps1
```

Результат:

```text
apps\desktop\release\KubeDeck-Portable-1.1.2-x64.exe
```

---

# Запуск в dev-режиме

Из корня проекта:

```powershell
npm.cmd ci --no-audit --no-fund
py -3 -m pip install --user -r .\apps\backend\requirements.txt
npm.cmd run dev
```

Dev-режим запускает:

- Vite dev server;
- TypeScript watch;
- Electron desktop shell;
- локальный Python backend.

---

# Проверка проекта

Актуальная проверка и сборка portable выполняются через общий Windows build script:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable-windows.ps1
```

Проверка включает:

- проверку структуры проекта;
- проверку backend Python-кода;
- backend tests;
- desktop TypeScript/Vite build;
- сборку portable `.exe`;
- проверку, что portable-сборка не содержит `kubectl.exe`.

---

# Структура проекта

```text
kubedeck/
  apps/
    backend/
      kubedeck_backend/
      tests/
      requirements.txt
    desktop/
      src/
      electron/
      release/
  packages/
    shared-types/
    ui/
  scripts/
    setup-windows.ps1
    build-portable-windows.ps1
    repair-7zip-bin.ps1
  docs/
  README.md
  package.json
  package-lock.json
```

---

# Частые ошибки и решения

## PowerShell запрещает запуск скрипта

Ошибка:

```text
running scripts is disabled on this system
```

Решение:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -Build
```

Эта команда меняет policy только для текущего процесса PowerShell.

---

## `npm.ps1 cannot be loaded`

На Windows может блокироваться `npm.ps1`.

Используй `npm.cmd`:

```powershell
npm.cmd ci --no-audit --no-fund
npm.cmd run build
npm.cmd run dev
```

---

## `winget` не найден

Проверь:

```powershell
winget --version
```

Если команды нет, обнови **App Installer** через Microsoft Store. После установки заново открой PowerShell.

---

## `py` не найден

Проверь:

```powershell
py -3 --version
```

Если команды нет:

```powershell
winget install -e --id Python.Python.3.11
```

После установки заново открой PowerShell.

---

## `kubectl executable not found`

KubeDeck не содержит встроенный `kubectl.exe`.

Решение:

```powershell
winget install -e --id Kubernetes.kubectl
kubectl version --client
```

Или укажи путь к `kubectl.exe` в Settings приложения.

---

## `kubectl timed out after 30s`

Проверь эту же команду напрямую в PowerShell:

```powershell
kubectl get pods -A -o json
```

Если в консоли команда работает быстро, проверь:

1. какой kubeconfig импортирован в KubeDeck;
2. какой context выбран;
3. какой `kubectl.exe` использует приложение;
4. нет ли старого пути до `kubectl` в Settings;
5. нет ли проблем с VPN/DNS/Proxy;
6. нет ли зависших процессов KubeDeck.

---

## Ошибка 7zip / electron-builder

Если сборка падает на `7za.exe` или `7zip-bin`, выполни:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\repair-7zip-bin.ps1
```

Если Defender удалил `7za.exe`, проверь карантин или временно добавь исключение для папки проекта.

---

## Release-директория занята

Закрой KubeDeck и Electron-процессы.

Потом повтори сборку:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable-windows.ps1
```

---

# Обновление проекта

Если проект уже склонирован:

```powershell
cd "$env:USERPROFILE\KubeDeck"
git pull --ff-only
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -Build
```

---

# Что нельзя коммитить

Не добавляй в git:

```text
node_modules/
.build-venv/
build/
apps/desktop/dist/
apps/desktop/release/
*.zip
*.7z
*.log
kubectl.exe
```

---

# Безопасность

В проекте приняты следующие правила:

- backend слушает только `127.0.0.1`;
- desktop и backend используют локальный session token;
- доступ к Kubernetes выполняется через локальный `kubectl`;
- kubeconfig-файлы копируются в `%APPDATA%\KubeDeck\kubeconfigs`;
- Secrets не должны сохраняться в логах;
- portable-сборка не должна содержать `kubectl.exe`;
- опасные действия требуют подтверждения в UI.

---

# Release notes 1.1.2

## Документация

- Исправлен `README.md`: восстановлены UTF-8, русская кириллица и нормальная Markdown-разметка.
- Удалены устаревшие release/build notes из актуального сценария проверки.
- Обновлены инструкции сборки portable через `scripts\build-portable-windows.ps1`.

## Local LLM diagnostics

- Добавлена интеграция с локальным OpenAI-compatible Chat Completions API.
- Добавлены настройки локального LLM endpoint, модели и API token.
- Добавлен ручной анализ ресурса из LLM tab в drawer.
- Контекст перед отправкой очищается от sensitive data: Secret data, bearer tokens, passwords, private keys и похожие поля.
- Анализ не запускается автоматически: пользователь явно нажимает `Analyze resource`.

## Logs

- Добавлен просмотр логов Deployment сразу по всем Pod выбранного Deployment.
- Логи остаются ручной диагностической функцией и не требуют дополнительных серверных компонентов.

## Portable build

- Portable-сборка не должна содержать `kubectl.exe`.
- Приложение использует системный `kubectl` из `PATH` или путь, заданный в Settings.

## Smoke test

- Обновлён чек-лист ручной проверки после сборки.
- В smoke test добавлена проверка Deployment logs.
- В smoke test сохранена проверка отсутствия `kubectl.exe` в release-директории.

---

# Smoke test после сборки

После сборки проверь:

1. Запускается portable `.exe`.
2. Settings открываются.
3. Путь до `kubectl` корректный.
4. kubeconfig импортируется.
5. Кластер открывается.
6. Namespace выбирается.
7. Pods/Deployments/Services/Events отображаются.
8. Pod drawer открывается.
9. YAML отображается.
10. Describe работает.
11. Logs работают.
12. Deployment logs работают.
13. Problems dashboard открывается.
14. В release-директории нет `kubectl.exe`.

---

# Команды для разработчика

## Установка зависимостей

```powershell
npm.cmd ci --no-audit --no-fund
py -3 -m pip install --user -r .\apps\backend\requirements.txt
```

## Dev mode

```powershell
npm.cmd run dev
```

## Desktop build

```powershell
npm.cmd run build
```

## Portable package

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable-windows.ps1
```

## Git commit после изменения README

```powershell
git status
git add README.md
git commit -m "docs: update README release notes for 1.1.2"
git push
```
