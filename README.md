# KubeDeck 2.0

KubeDeck — desktop IDE для работы с Kubernetes на **Windows** и **macOS**.

Текущая версия: **`2.1.0`**.

Начиная с ветки 2.0 приложение использует **Node-only runtime внутри Electron**. Отдельный Python/FastAPI backend больше не запускается и не входит в сборку.

## Поддерживаемые платформы

| Платформа | Архитектура | Формат сборки | Статус |
|---|---:|---|---|
| Windows 10/11 | x64 | Portable EXE | Поддерживается |
| macOS | Apple Silicon (`arm64`) | DMG и ZIP | Поддерживается, сборка неподписанная |
| macOS Intel | x64 | — | Пока не поддерживается |
| Linux | — | — | Пока не поддерживается |

## Архитектура

| Слой | Технологии | Назначение |
|---|---|---|
| Desktop UI | Electron, React, TypeScript | Окно приложения, таблицы ресурсов, drawer, YAML, логи и терминалы |
| Runtime | Node.js внутри Electron main process | REST/WebSocket API, kubectl runtime, cache, watch, search, relations, diagnostics и LLM |
| Kubernetes CLI | Системный `kubectl` | Доступ к Kubernetes API |
| Native terminal | `node-pty` | Pod Terminal и интерактивные терминальные сессии |
| SSH | `ssh2` | Подключение к Kubernetes nodes |

Node Gateway слушает случайный локальный порт на `127.0.0.1`. Каждый HTTP/WebSocket-запрос требует session token.

## Основные возможности

- работа с несколькими kubeconfig и кластерами;
- namespace selector и Global Search;
- стандартные Kubernetes-ресурсы и CRD;
- просмотр, редактирование, dry-run и apply YAML;
- Describe, Events, Related Resources и Problems;
- Pod и Deployment logs;
- Pod Terminal, Node SSH и Port Forward;
- delete, restart, redeploy, scale, cordon, uncordon и drain;
- просмотр Kubernetes Secrets с защитой от случайной утечки;
- metrics и Resource Snapshot Cache;
- локальный анализ через OpenAI-compatible LLM;
- русский и английский интерфейс;
- dark, light и system theme.

## Требования

### Общие

- Git;
- Node.js 20 или новее;
- npm;
- системный `kubectl` либо полный путь к нему в Settings;
- доступ к Kubernetes API через kubeconfig.

Python, FastAPI, PyInstaller и встроенный `kubectl` не требуются.

### Windows

- Windows 10/11 x64;
- PowerShell 5.1 или новее;
- Node.js 20+;
- npm;
- `kubectl` в `PATH` или путь к нему в настройках KubeDeck.

Установка `kubectl`:

```powershell
winget install -e --id Kubernetes.kubectl
kubectl version --client
```

### macOS

- Mac с Apple Silicon (`arm64`);
- macOS с установленными Xcode Command Line Tools;
- Node.js 20+, рекомендуется Node.js 22;
- npm;
- Homebrew;
- `kubectl`;
- `p7zip`.

Установка зависимостей:

```bash
xcode-select --install
brew install node@22 kubectl p7zip
```

Для Homebrew на Apple Silicon типовой путь к `kubectl`:

```text
/opt/homebrew/bin/kubectl
```

## Установка npm-зависимостей

Из корня проекта:

### Windows

```powershell
npm.cmd ci --no-audit --no-fund
```

### macOS

```bash
npm ci --no-audit --no-fund
```

Повторная установка не требуется, если `node_modules` уже исправен и соответствует текущей платформе.

`node_modules`, созданный на Windows, нельзя переносить на macOS и наоборот: проект содержит нативную зависимость `node-pty`.

## Устранение проблем npm

### Ошибка `ECONNRESET` при `npm ci`

Если установка зависимостей завершается ошибкой:

```text
npm error code ECONNRESET
npm error network read ECONNRESET
```

соединение с npm registry было прервано. Предупреждения `deprecated` сами по себе не останавливают установку или сборку.

На Windows повторите установку с проверкой кеша, увеличенными таймаутами и дополнительными попытками:

```powershell
npm.cmd cache verify

npm.cmd ci `
  --no-audit `
  --no-fund `
  --prefer-offline `
  --fetch-retries=5 `
  --fetch-retry-mintimeout=20000 `
  --fetch-retry-maxtimeout=120000 `
  --fetch-timeout=300000
```

После успешной установки зависимостей запустите сборку:

```powershell
npm.cmd run package:win
```

Обновление npm для устранения `ECONNRESET` не требуется.

## Dev-режим

Из корня проекта:

```bash
npm run dev
```

Dev-режим запускает Vite, TypeScript watch и Electron. Отдельного backend-процесса нет.

## Проверки

### TypeScript

```bash
npm run typecheck
```

### Production build

```bash
npm run build
```

### Node Gateway contract tests

```bash
npm run test:gateway
```

### Node-only verification на Windows

```powershell
npm.cmd run verify:node-only
```

Проверяются:

- отсутствие legacy Python/FastAPI runtime;
- согласованность версий root и desktop package;
- Node-владение backend-маршрутами;
- отсутствие Python runtime и встроенного `kubectl.exe` в release payload.

### Release verification на Windows

```powershell
npm.cmd run verify:release
```

Проверяется версия `2.1.0`, release baseline и regression invariants.

## Сборка для Windows

Основная команда:

```powershell
npm.cmd run package:win
```

Она запускает:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-portable-windows.ps1
```

Если npm-зависимости ещё не установлены:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-portable-windows.ps1 `
  -InstallNpmDeps
```

Windows-сборщик выполняет:

1. Node-only verification;
2. проверку версий;
3. TypeScript typecheck;
4. Electron/Vite production build;
5. Node Gateway contract tests;
6. восстановление необходимых electron-builder helpers;
7. portable packaging;
8. проверку release payload.

Результат:

```text
apps\desktop\release\KubeDeck-Portable-2.1.0-x64.exe
```

### Windows bootstrap

Для уже скачанного репозитория:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\setup-windows.ps1 `
  -Build
```

Bootstrap проверяет Git, Node.js, npm и `kubectl`. Python не устанавливается.

## Сборка для macOS Apple Silicon

Основная команда:

```bash
npm run package:mac
```

macOS-сборщик выполняет:

1. проверку macOS и архитектуры `arm64`;
2. проверку Node.js, npm, Xcode Command Line Tools, `kubectl` и `7za`;
3. проверку согласованности версий;
4. TypeScript typecheck;
5. Electron/Vite production build;
6. Node Gateway contract tests;
7. пересборку `node-pty` под текущую версию Electron;
8. создание неподписанных DMG и ZIP;
9. проверку готовых артефактов.

Результаты:

```text
apps/desktop/release/KubeDeck-2.1.0-arm64.dmg
apps/desktop/release/KubeDeck-2.1.0-arm64.zip
```

Сборка пока не подписана Apple Developer ID и не notarized. При первом запуске macOS может заблокировать приложение. Используйте:

1. Finder → Applications;
2. Control-click по KubeDeck;
3. Open.

## kubectl

KubeDeck намеренно не включает `kubectl` в сборку.

Используется один из вариантов:

1. `kubectl` из системного `PATH`;
2. полный путь, указанный в Settings.

Проверка:

```bash
kubectl version --client
```

На macOS файл должен иметь право на выполнение:

```bash
chmod +x /path/to/kubectl
```

Рекомендуемый путь при установке через Homebrew:

```text
/opt/homebrew/bin/kubectl
```

## Kubeconfig

Kubeconfig импортируется через интерфейс KubeDeck и копируется в каталог приложения.

Перед импортом рекомендуется проверить конфигурацию системным `kubectl`:

```bash
kubectl --kubeconfig /path/to/config get nodes
```

KubeDeck не изменяет исходный kubeconfig-файл.

## Данные и логи

### Windows

```text
%APPDATA%\KubeDeck\
├── config.json
├── kubeconfigs\
└── logs\
    ├── desktop.log
    └── kubectl.log
```

### macOS

```text
~/Library/Application Support/KubeDeck/
├── config.json
├── kubeconfigs/
└── logs/
    ├── desktop.log
    └── kubectl.log
```

Старый `backend.log` может остаться после обновления с предыдущей версии, но Node-only runtime его больше не создаёт.

## Local LLM

Поддерживается OpenAI-compatible Chat Completions API, например LM Studio или Ollama.

LLM-анализ запускается только вручную. Перед отправкой контекст очищается от:

- Kubernetes Secret data;
- tokens;
- passwords;
- private keys;
- других чувствительных значений.

## Безопасность

- Gateway доступен только на `127.0.0.1`;
- каждый HTTP/WebSocket-запрос требует session token;
- Kubernetes Secrets и LLM API key не логируются;
- опасные операции требуют подтверждения;
- команды запускаются через аргументы процесса без shell-интерполяции;
- сборки не содержат Python runtime;
- сборки не содержат встроенный `kubectl`.

## Известные ограничения 2.1.0

- macOS поддерживается только на Apple Silicon;
- macOS-сборка пока не подписана и не notarized;
- Linux-сборка пока отсутствует;
- приложение использует стандартную Electron icon, пока отдельная иконка KubeDeck не настроена;
- для работы требуется установленный системный `kubectl`.

## Документация 2.1.0

- [Regression checklist 2.1.0](./REGRESSION_CHECKLIST_2.1.0.md)
- [Release notes 2.1.0](./RELEASE_NOTES_2.1.0.md)

## Основные команды

| Задача | Команда |
|---|---|
| Dev-режим | `npm run dev` |
| TypeScript check | `npm run typecheck` |
| Production build | `npm run build` |
| Gateway tests | `npm run test:gateway` |
| Windows portable | `npm run package:win` |
| macOS ARM64 DMG/ZIP | `npm run package:mac` |
