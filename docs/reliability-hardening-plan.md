# KubeDeck — Reliability and Test Hardening Plan

Цель: усилить защитную сетку на текущем Electron `31.7.7` перед платформенной миграцией. Выполнять сверху вниз. После каждого пункта отмечать результат и короткую фактическую проверку.

Статусы: `TODO` → `IN PROGRESS` → `DONE` или `BLOCKED`.

## 1. Единый автоматический gate — DONE

Статус: `DONE` (2026-07-10).

- [x] Добавить root-команду `npm run verify`.
- [x] Последовательно запускать renderer tests, typecheck, build и gateway tests.
- [x] Команда должна работать на macOS и Windows без Bash/PowerShell-зависимой логики.
- [x] Ошибка любого этапа должна возвращать ненулевой exit code.

Готово, когда:

```bash
npm run verify
```

проходит локально и является единственной основной командой проверки исходников.

Заметка о выполнении: root npm-script использует `&&`, сохраняет exit code упавшего этапа и не зависит от platform shell scripts.

## 2. Renderer tests в packaging — DONE

Статус: `DONE` (2026-07-10).

- [x] Добавить `npm run test:renderer` в `scripts/build-macos.sh`.
- [x] Добавить renderer tests в `scripts/build-portable-windows.ps1`.
- [x] Проверить, что packaging прекращается при падении renderer-теста.
- [x] Не дублировать порядок команд, если packaging может вызывать общий `npm run verify`.

Готово: оба platform builder запускают одинаковый обязательный набор проверок.

Заметка о выполнении: оба builder вызывают общий `npm run verify`; Bash `set -e` и PowerShell `Invoke-Native` немедленно прекращают packaging при ненулевом exit code.

## 3. Renderer lifecycle tests — DONE

Статус: `DONE` (2026-07-10).

Добавить focused-тесты для наиболее рискованных переходов:

- [x] смена drawer resource во время YAML/Describe-загрузки;
- [x] abort старого запроса не изменяет состояние нового ресурса;
- [x] Events/Related reset при смене объекта;
- [x] ResourceTable preferences сохраняют resize/reorder/visibility;
- [x] watch disconnect/reconnect не создаёт параллельные подключения;
- [x] lazy panel можно открыть повторно после ошибки загрузки.

Не требуется полноценный browser E2E. Предпочитать чистые lifecycle/controller тесты и минимальные integration tests.

Готово: каждый перечисленный риск имеет воспроизводимый тест, renderer suite стабилен при повторных запусках.

Заметка о выполнении: добавлены generation guard для drawer requests, единый reset snapshot, table preference patch, single-pending watch reconnect controller и resetKey для lazy boundary. Renderer suite: 9/9 вместе с error normalizer test.

## 4. Error normalization — DONE

Статус: `DONE` (2026-07-10).

- [x] Добавить единый `toErrorInfo(error)` в renderer utilities.
- [x] Убрать повторяющиеся конструкции `error instanceof ApiError`.
- [x] Сохранить `code`, `message`, `rawStderr` и `commandPreview` для `ApiError`.
- [x] Не допускать попадания sensitive values в fallback error и логи.
- [x] Добавить focused-тесты normalizer и redaction.

Готово: компоненты не собирают `ErrorInfo` вручную, поведение error panels не изменилось.

Заметка о выполнении: ручная сборка ErrorInfo удалена из компонентов; fallback message/rawStderr/commandPreview проходят sensitive marker redaction, а структурированный ApiError сохраняется без потери полей.

## 5. Lint и форматирование — DONE

Статус: `DONE` (2026-07-10).

- [x] Выбрать минимальный инструмент: ESLint + Prettier или Biome.
- [x] Добавить `lint` и read-only `format:check`.
- [x] Не делать массовую стилистическую перезапись одновременно с логическими изменениями.
- [x] Исправить найденные warnings отдельным механическим изменением.
- [x] Подключить lint и format check к `npm run verify`.

Минимальные правила: unused imports, unreachable code, promise misuse, React hooks dependencies, consistent formatting.

Готово: `npm run lint` и `npm run format:check` проходят без suppressions, скрывающих реальные ошибки.

Заметка о выполнении: Biome 2.5.3 закреплён в lockfile. Lint охватывает весь source/tests/scripts; formatter вводится инкрементально для reliability-поверхности, чтобы не создавать массовый diff 145 исторических файлов. Исправлены реальные unused/dead-code diagnostics, suppressions не добавлялись.

## 6. Кроссплатформенный release verifier — DONE

Статус: `DONE` (2026-07-10).

- [x] Перенести общие release invariants из PowerShell в Node-скрипт.
- [x] Получать версию из root `package.json`, а не хранить `2.1.0` в коде verifier.
- [x] Вынести ожидаемый Node-only route baseline в один manifest/contract source.
- [x] Проверять синхронизацию package manifests и lockfile.
- [x] Оставить PowerShell/Bash только platform-specific packaging оболочками.
- [x] Сохранить Windows artifact validation и macOS artifact validation.

Готово: одинаковая release-проверка запускается через Node на macOS и Windows.

Заметка о выполнении: `scripts/verify-release.cjs` используется обеими платформами; `release-contract.json` хранит route baseline и required documents. PowerShell verifiers стали тонкими compatibility wrappers. Проверены source invariants и optional macOS/Windows artifacts.

## 7. Минимальный CI — DONE

Статус: `DONE` (2026-07-10).

- [x] Добавить CI workflow для clean install и `npm run verify`.
- [x] Запускать на pull request и push в `main`.
- [x] Закрепить поддерживаемую Node major version.
- [x] Не включать DMG/EXE packaging в обязательный быстрый job.
- [x] При необходимости вынести platform packaging в ручные jobs.

Готово: чистый checkout автоматически подтверждает typecheck, build и все contract tests.

Заметка о выполнении: `.github/workflows/verify.yml` запускает clean `npm ci` и общий gate на Node 20 для push/main, pull request и ручного запуска; platform packaging не блокирует быстрый source job. Reviewed install scripts закреплены через pinned `allowScripts`; platform builders точечно восстанавливают Electron, если npm не завершил postinstall.

## 8. Финальная подготовка к Electron upgrade — DONE

Статус: `DONE` (2026-07-10).

- [x] Выполнить `npm run verify` на Electron `31.7.7`.
- [x] Собрать macOS DMG/ZIP и записать размеры artifacts.
- [x] Проверить packaged startup, Pod Terminal, SSH и Port Forward.
- [x] Зафиксировать Windows baseline либо явно оставить его для Windows-машины.
- [x] Создать отдельный commit подготовки.
- [x] Убедиться, что working tree чистый.

Готово: baseline зафиксирован, после чего можно переходить к `electron-upgrade-plan.md`.

Заметка о выполнении: clean `npm ci` выполнен; lint, format check, renderer 9/9, typecheck, build и gateway 69/69 прошли. Windows packaging/ConPTY явно оставлены для Windows-машины. npm 11 выявил неполный Electron postinstall; добавлен общий `scripts/ensure-electron.cjs`. Пользователь успешно собрал macOS artifacts: DMG 93 MB, ZIP 89 MB; общий Node verifier подтвердил payload и executable spawn-helper. Packaged startup, Terminal, SSH и Port Forward подтверждены пользователем; подготовка зафиксирована отдельным checkpoint commit перед Electron upgrade branch.

## Финальные команды

```bash
npm run lint
npm run format:check
npm run verify
npm run package:mac
git status --short
```

Windows:

```powershell
npm.cmd run verify
npm.cmd run package:win
```
