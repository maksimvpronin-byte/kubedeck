# KubeDeck 2.0

KubeDeck — Windows desktop Kubernetes IDE на Electron, React и TypeScript.

Начиная с `2.0.0-alpha.14`, приложение использует **Node-only runtime внутри Electron**. Отдельный Python/FastAPI-процесс больше не запускается и не включается в portable-сборку.

Текущая версия: **`2.0.0-alpha.15` — Node-only Stabilization**.

## Архитектура

| Слой | Технологии | Назначение |
|---|---|---|
| Desktop UI | Electron, React, TypeScript | Окно приложения, таблицы ресурсов, drawer, YAML, логи и терминалы |
| Backend runtime | Node.js внутри Electron main process | REST/WebSocket API, kubectl runtime, cache, watch, search, relations и LLM |
| Kubernetes CLI | системный `kubectl` | Доступ к Kubernetes API |

Node Gateway слушает случайный локальный порт на `127.0.0.1` и требует session token. Все **49 backend-контрактов** выполняются в Node.

## Основные возможности

- несколько kubeconfig и кластеров;
- namespace selector и Global Search;
- стандартные Kubernetes-ресурсы и CRD;
- YAML view/edit с dry-run и apply;
- Describe, Events, Related Resources и Problems;
- Pod и Deployment logs;
- Pod Terminal, Node SSH и Port Forward;
- delete/restart/redeploy/scale/cordon/uncordon/drain;
- Secret reveal/copy с защитой от утечек;
- metrics и Resource Snapshot Cache;
- локальный OpenAI-compatible LLM-анализ;
- RU/EN и dark/light/system theme.

## Требования

- Windows 10/11 x64;
- PowerShell 5.1+;
- Node.js 20+ и npm;
- `kubectl` в `PATH` либо полный путь в Settings;
- Git — для работы с репозиторием.

**Python, FastAPI, PyInstaller и встроенный `kubectl.exe` не требуются.**

## Установка зависимостей

Из корня проекта:

```powershell
npm.cmd ci --no-audit --no-fund
```

Повторная установка не нужна, если `node_modules` уже исправен.

## Проверка Node-only инвариантов

```powershell
npm.cmd run verify:node-only
```

Проверяется:

- отсутствие `apps/backend` и legacy proxy;
- отсутствие Python/FastAPI/PyInstaller startup и packaging-кода;
- согласованность версий root/desktop;
- владение маршрутами `Node 49 / Python 0`;
- отсутствие `kubectl.exe`, Python DLL и backend executable в release, если release уже собран.

## Сборка portable

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-portable-windows.ps1
```

Если npm-зависимости отсутствуют:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-portable-windows.ps1 `
  -InstallNpmDeps
```

Сборщик выполняет:

1. Node-only verification;
2. TypeScript typecheck;
3. Electron/Vite build;
4. все Node Gateway contract tests;
5. electron-builder portable packaging;
6. повторную проверку source tree и release payload.

Результат:

```text
apps\desktop\release\KubeDeck-Portable-2.0.0-alpha.15-x64.exe
```

## Dev-режим

```powershell
npm.cmd run dev
```

Dev-режим запускает Vite, TypeScript watch и Electron. Отдельного backend-процесса нет.

## Windows bootstrap

Для уже скачанного репозитория:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\setup-windows.ps1 `
  -Build
```

Bootstrap проверяет Git, Node.js, npm и kubectl. Python не устанавливается.

## kubectl

KubeDeck намеренно не включает `kubectl.exe` в portable.

Используется:

1. `kubectl` из системного `PATH`; или
2. полный путь, заданный в Settings.

Установка:

```powershell
winget install -e --id Kubernetes.kubectl
kubectl version --client
```

## Данные и логи

```text
%APPDATA%\KubeDeck\
  config.json
  kubeconfigs\
  logs\
    desktop.log
    kubectl.log
```

Старый `backend.log` может остаться после обновления предыдущей версии, но Node-only runtime его больше не создаёт.

## Local LLM

Поддерживается OpenAI-compatible Chat Completions API, например LM Studio или Ollama. Анализ запускается только вручную. Перед отправкой контекст очищается от Secret data, tokens, passwords, private keys и других чувствительных значений.

## Безопасность

- Gateway доступен только на `127.0.0.1`;
- каждый HTTP/WebSocket запрос требует session token;
- Kubernetes Secrets и LLM API key не логируются;
- опасные операции требуют подтверждения;
- команды запускаются через аргументы процесса без shell-интерполяции;
- portable не содержит `kubectl.exe` и Python runtime.

## Smoke test после сборки

1. Portable запускается без Python.
2. Settings и импорт kubeconfig работают.
3. Кластер и namespaces открываются.
4. Resources, YAML, Describe, Events и Related работают.
5. Logs, Terminal, SSH и Port Forward работают.
6. Problems, Global Search и LLM работают.
7. `/migration/status` показывает `node-only`, Node `49`, Python `0`.
8. В release нет `kubectl.exe`, `resources/backend`, backend executable и Python DLL.
