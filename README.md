# KubeDeck 2.0

KubeDeck — Windows desktop Kubernetes IDE на Electron, React и TypeScript.
Начиная с `2.0.0-alpha.14`, приложение использует **Node-only runtime внутри Electron**:
отдельный Python/FastAPI-процесс больше не запускается и не включается в portable-сборку.

## Архитектура

| Слой | Технологии | Назначение |
|---|---|---|
| Desktop UI | Electron, React, TypeScript | Окно приложения, таблицы ресурсов, drawer, YAML, логи и терминалы |
| Backend runtime | Node.js внутри Electron main process | REST/WebSocket API, kubectl runtime, cache, watch, search, relations и LLM |
| Kubernetes CLI | системный `kubectl` | Доступ к Kubernetes API |

Node Gateway слушает только случайный порт на `127.0.0.1` и требует локальный session token.
Все 49 backend-контрактов выполняются в Node.

## Основные возможности

- несколько kubeconfig и кластеров;
- namespace selector и глобальный поиск;
- стандартные Kubernetes-ресурсы и CRD;
- YAML view/edit с dry-run и apply;
- Describe, Events, Related Resources и Problems;
- Pod и Deployment logs;
- Pod Terminal, Node SSH и Port Forward;
- операции delete/restart/redeploy/scale/cordon/uncordon/drain;
- Secret reveal/copy с защитой от утечек;
- metrics и resource cache;
- локальный OpenAI-compatible LLM-анализ;
- RU/EN, dark/light/system theme.

## Требования

- Windows 10/11 x64;
- PowerShell 5.1+;
- Node.js 20+ и npm;
- `kubectl` в `PATH` либо путь к нему в Settings;
- Git — для работы с репозиторием.

**Python, FastAPI, PyInstaller и встроенный `kubectl.exe` не требуются.**

## Сборка portable

Из корня проекта:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-portable-windows.ps1
```

Скрипт выполняет:

1. проверку Node-only структуры;
2. TypeScript typecheck;
3. desktop/Vite build;
4. Node Gateway contract tests;
5. electron-builder portable packaging;
6. проверку отсутствия `kubectl.exe` и Python backend payload.

Результат:

```text
apps\desktop\release\KubeDeck-Portable-2.0.0-alpha.14-x64.exe
```

Если npm-зависимости ещё не установлены:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-portable-windows.ps1 `
  -InstallNpmDeps
```

## Dev-режим

```powershell
npm.cmd ci --no-audit --no-fund
npm.cmd run dev
```

Dev-режим запускает Vite, TypeScript watch и Electron. Отдельного backend-процесса нет.

## kubectl

KubeDeck намеренно не включает `kubectl.exe` в portable-файл. Используется:

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

Старый `backend.log` может остаться после обновления предыдущей версии, но Alpha 14 его больше не создаёт.

## Local LLM

Поддерживается OpenAI-compatible Chat Completions API, например LM Studio или Ollama.
LLM-анализ запускается только вручную. Перед отправкой контекст очищается от Secret data,
tokens, passwords, private keys и других чувствительных значений.

## Безопасность

- Gateway доступен только на `127.0.0.1`;
- каждый HTTP/WebSocket запрос требует session token;
- Kubernetes Secrets и LLM API key не логируются;
- опасные операции требуют подтверждения;
- команды запускаются через аргументы процесса, без shell-интерполяции;
- portable не содержит `kubectl.exe` и Python runtime.

## Smoke test после сборки

1. Portable запускается без Python.
2. Settings и импорт kubeconfig работают.
3. Кластер и namespaces открываются.
4. Resources, YAML, Describe, Events и Related работают.
5. Logs, Terminal, SSH и Port Forward работают.
6. Problems, Global Search и LLM работают.
7. `/migration/status` показывает `node-only`, Node `49`, Python `0`.
8. В release нет `kubectl.exe`, `resources/backend` и Python DLL.

## Текущая версия

`2.0.0-alpha.14` — Node-only Runtime Cleanup.
