# KubeDeck 2.4.1

[English](./README.md) | [Русский](./README.ru.md)

KubeDeck — настольная Kubernetes IDE для Windows и macOS. Она объединяет просмотр ресурсов, диагностику, работу с YAML, логи, терминалы, SSH, проброс портов и необязательный анализ через локальную LLM в одном Electron-приложении.

KubeDeck использует **Node-only runtime внутри Electron**. Приложение не запускает и не включает в сборку Python/FastAPI backend, а также не поставляет встроенный `kubectl`.

## Основные возможности

- несколько kubeconfig-файлов и кластеров с сохраняемым ручным порядком;
- фильтрация по namespace и глобальный поиск;
- стандартные Kubernetes-ресурсы и CRD;
- просмотр, редактирование, dry-run и применение YAML;
- Describe, Events, Related Resources и Problems;
- логи Pod и Deployment;
- Pod Terminal, Node SSH и Port Forward;
- delete, restart, redeploy, scale, cordon, uncordon и drain;
- защищённый просмотр Kubernetes Secrets;
- метрики и кэш снимков ресурсов;
- необязательный анализ через OpenAI-совместимую локальную LLM, в которую никогда не передаются Kubernetes-логи;
- русский и английский интерфейс;
- темы Midnight Blue, Nord Frost, Forest Teal, Plum Graphite, Warm Mocha, Light и System.

## Поддерживаемые платформы

| Платформа | Архитектура | Формат | Статус |
|---|---:|---|---|
| Windows 10/11 | x64 | Portable EXE | Поддерживается |
| macOS | Apple Silicon (`arm64`) | DMG и ZIP | Поддерживается, сборка не подписана |
| macOS Intel | x64 | — | Пока не поддерживается |
| Linux | — | — | Пока не поддерживается |

## Архитектура

| Слой | Технологии | Назначение |
|---|---|---|
| Desktop UI | Electron, React, TypeScript | Таблицы ресурсов, drawer, YAML, логи и терминалы |
| Runtime | Node.js в Electron main process | Локальный REST/WebSocket Gateway, запуск kubectl, кэш, watch, поиск, диагностика и LLM |
| Kubernetes CLI | Системный `kubectl` | Доступ к Kubernetes API |
| Нативный терминал | `node-pty` | Pod Terminal и интерактивные сессии |
| SSH | `ssh2` | Подключение к Kubernetes nodes |

Локальный Gateway слушает случайный порт на `127.0.0.1`. Каждый HTTP- и WebSocket-запрос требует session token.

## Требования

- Git;
- Node.js 22.12 или новее;
- npm;
- системный `kubectl` в `PATH` либо абсолютный путь к нему в Settings;
- доступ к Kubernetes-кластеру через kubeconfig.

Python, FastAPI, PyInstaller и встроенный `kubectl` не требуются.

### Windows

- Windows 10/11 x64;
- PowerShell 5.1 или новее.

При необходимости установите `kubectl`:

```powershell
winget install -e --id Kubernetes.kubectl
kubectl version --client
```

### macOS

- Mac с Apple Silicon;
- Xcode Command Line Tools;
- Homebrew;
- `kubectl` и `p7zip`.

```bash
xcode-select --install
brew install node@22 kubectl p7zip
```

## Быстрый старт

Клонируйте репозиторий и установите зафиксированные зависимости из корня проекта.

### Windows

```powershell
git clone https://github.com/maksimvpronin-byte/kubedeck.git
cd kubedeck
npm.cmd ci --no-audit --no-fund
npm.cmd run dev
```

В PowerShell используйте `npm.cmd`, чтобы не зависеть от ограничения Execution Policy для `npm.ps1`.

### macOS

```bash
git clone https://github.com/maksimvpronin-byte/kubedeck.git
cd kubedeck
npm ci --no-audit --no-fund
npm run dev
```

Не переносите `node_modules` между операционными системами: KubeDeck использует нативную зависимость `node-pty`.

## Проверка проекта

Полный source gate:

```bash
npm run verify
```

Отдельные команды:

| Задача | Команда |
|---|---|
| Lint | `npm run lint` |
| Проверка форматирования | `npm run format:check` |
| Проверка TypeScript | `npm run typecheck` |
| Renderer-тесты | `npm run test:renderer` |
| Gateway-тесты | `npm run test:gateway` |
| Production build | `npm run build` |
| Проверка Node-only release | `npm run verify:node-only` |

## Portable-сборка для Windows

```powershell
npm.cmd run package:win
```

Если зависимости ещё не установлены:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-portable-windows.ps1 `
  -InstallNpmDeps
```

Сборщик проверяет Node-only release contract, восстанавливает необходимые нативные компоненты, запускает полный source gate, создаёт portable-пакет и проверяет release payload.

Результат:

```text
apps\desktop\release\KubeDeck-Portable-2.4.1-x64.exe
```

## Сборка для macOS Apple Silicon

```bash
npm run package:mac
```

Результаты:

```text
apps/desktop/release/KubeDeck-2.4.1-arm64.dmg
apps/desktop/release/KubeDeck-2.4.1-arm64.zip
```

macOS-сборка не подписана Apple Developer ID и не notarized. При первом запуске используйте Finder → Applications → Control-click по KubeDeck → Open.

## Решение сетевых проблем

Ошибки `ECONNRESET` или `fetch failed` во время `npm ci` либо загрузки Electron означают обрыв соединения с сетью, proxy или registry. Повторите установку с проверкой кэша и увеличенными таймаутами:

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

Если Node.js должен использовать proxy-переменные для загрузки Electron, включайте поддержку environment proxy только для процесса загрузки. Не оставляйте её включённой для тестов локального Gateway.

## kubectl и kubeconfig

KubeDeck использует `kubectl` из `PATH` либо абсолютный путь к исполняемому файлу, указанный в Settings.

```bash
kubectl version --client
kubectl --kubeconfig /path/to/config get nodes
```

Kubeconfig-файлы, импортированные через интерфейс, копируются в каталог данных приложения. Исходный файл не изменяется.

## Данные приложения

Windows:

```text
%APPDATA%\KubeDeck\
├── config.json
├── kubeconfigs\
└── logs\
    ├── desktop.log
    └── kubectl.log
```

macOS:

```text
~/Library/Application Support/KubeDeck/
├── config.json
├── kubeconfigs/
└── logs/
    ├── desktop.log
    └── kubectl.log
```

## Безопасность

- Gateway доступен только на `127.0.0.1`;
- каждый HTTP- и WebSocket-запрос требует session token;
- Kubernetes Secrets и LLM API key не записываются в логи;
- опасные операции требуют подтверждения;
- команды запускаются через массивы аргументов без shell-интерполяции;
- контекст LLM очищается перед отправкой;
- release-сборки не содержат Python runtime и встроенный `kubectl`.

## Документация

- [Release notes 2.4.1](./RELEASE_NOTES_2.4.1.md)
- [Regression checklist 2.4.1](./REGRESSION_CHECKLIST_2.4.1.md)
- [Статус миграции на Node](./NODE_MIGRATION_PROGRESS.md)
