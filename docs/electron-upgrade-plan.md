# KubeDeck — Electron Upgrade Plan

Цель: изолированно обновить Electron `31.7.7` до поддерживаемой версии без одновременного рефакторинга приложения. Начинать только после завершения `reliability-hardening-plan.md`.

Статусы: `TODO` → `IN PROGRESS` → `DONE` или `BLOCKED`.

## Ограничения миграции

- Не смешивать обновление с рефакторингом Gateway, SSH, Terminal, CSS или новым UX.
- Не менять HTTP/WebSocket-контракты без отдельной причины и теста.
- Не сливать ветку до packaged smoke на macOS и Windows.
- Любую совместимость исправлять минимальным отдельным изменением с проверкой.
- Сохранять `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

## 1. Создание изолированной ветки — DONE

Статус: `DONE` (2026-07-10).

- [x] Убедиться, что `main` чистый и reliability plan завершён.
- [x] Создать ветку `chore/electron-upgrade`.
- [x] Записать исходные версии Electron, Chromium, Node, `node-pty`, `@electron/rebuild` и electron-builder.
- [x] Приложить baseline результатов `npm run verify` и размеров artifacts.

Готово: миграция начинается из зелёного воспроизводимого baseline.

Заметка о выполнении: baseline commit `46da382`; Electron 31.7.7 / Chromium 126 / Node 20.18, node-pty 1.1.0, @electron/rebuild 4.0.4, electron-builder 24.13.3. `npm run verify` зелёный: renderer 9/9, gateway 69/69. macOS arm64 baseline: DMG 93 MB, ZIP 89 MB.

## 2. Выбор целевой версии — DONE

Статус: `DONE` (2026-07-10).

- [x] Проверить текущие поддерживаемые stable-релизы Electron по официальному schedule.
- [x] Выбрать поддерживаемую целевую major-версию, предпочтительно не prerelease.
- [x] Изучить breaking changes от Electron 31 до целевой версии.
- [x] Проверить требования Node.js, macOS и Windows.
- [x] Зафиксировать выбранную версию и причину выбора в этом файле.

Выбранная версия: `43.1.0` (Chromium 150.0.7871.47, Node 24.18.0).

Причина: актуальный stable с поддержкой до 2027-01-05; Electron 41 имеет слишком короткий оставшийся срок поддержки, Electron 44 ещё prerelease и повышает минимальную macOS до 13. Для KubeDeck релевантны C++20 native modules, host Node 22.12+ для install/build tooling и изменение default folder dialogs; удалённые API проекта не затронуты. Windows x64 и macOS 12+ сохраняются.

## 3. Минимальное обновление зависимостей — DONE

Статус: `DONE` (2026-07-10).

- [x] Обновить сначала только `electron` и lockfile.
- [x] Запустить install без массового обновления остальных packages.
- [x] Обновлять `@electron/rebuild` только при несовместимости или официальном требовании.
- [x] Обновлять electron-builder только при подтверждённой необходимости.
- [x] Проверить отсутствие неожиданных dependency upgrades.

Готово: diff зависимостей минимален и объясним.

Заметка о выполнении: обновлён только Electron 31.7.7 → 43.1.0 и его download/extraction transitive tree; node-pty 1.1.0, @electron/rebuild 4.0.4 и electron-builder 24.13.3 оставлены без изменений. allowScripts pin обновлён на Electron 43.1.0. CI и platform builders требуют host Node 22.12+.

## 4. Source и build compatibility — DONE

Статус: `DONE` (2026-07-10).

- [x] Выполнить typecheck, renderer tests, gateway tests и build.
- [x] Проверить Electron main/preload API на deprecations.
- [x] Проверить BrowserWindow security preferences.
- [x] Проверить IPC handlers и preload bridge.
- [x] Проверить блокировку renderer navigation и window opening.
- [x] Исправлять каждый тип несовместимости отдельным commit при необходимости.

Готово: `npm run verify` проходит на целевом Electron.

Заметка о выполнении: `npm run verify` проходит на Electron 43.1.0: lint/format, renderer 9/9, typecheck, build и gateway 69/69. Electron 43 type definitions не выявили удалённых main/preload API; sandbox/contextIsolation/navigation policies не менялись. Recovery helper адаптирован к новому `@electron-internal/extract-zip` с fallback для Electron 31.

## 5. Native module compatibility — IN PROGRESS

Статус: `IN PROGRESS`: macOS runtime подтверждён, Windows ConPTY ожидает Windows acceptance.

- [x] Пересобрать `node-pty` через `@electron/rebuild`.
- [x] Проверить загрузку `node-pty` через `ELECTRON_RUN_AS_NODE`.
- [x] Проверить наличие и executable bit у macOS `spawn-helper`.
- [ ] Проверить Windows ConPTY binary/runtime.
- [x] Проверить, что ASAR unpack содержит необходимые native files.
- [x] Не обновлять `node-pty`, если текущая версия совместима и тесты проходят.

Готово: native module загружается в dev и packaged runtime на обеих платформах.

Заметка о выполнении: Electron runtime 43.1.0 / Node 24.18.0 / Chromium 150.0.7871.47 arm64 загружает node-pty 1.1.0; spawn доступен, darwin-arm64 spawn-helper executable. Windows x64 prebuild присутствует, но runtime/ConPTY проверяется только на Windows.

## 6. macOS runtime и packaging — DONE

Статус: `DONE` (2026-07-10): пользователь собрал, запустил и подтвердил работу macOS-приложения на Electron 43.

- [x] Запустить dev-приложение.
- [x] Собрать arm64 DMG и ZIP.
- [x] Проверить packaged startup и clean shutdown.
- [x] Проверить Settings/file dialogs/About diagnostics.
- [x] Проверить Pod Terminal input/paste/resize/reconnect.
- [x] Проверить Node SSH и Port Forward lifecycle.
- [x] Проверить отсутствие crash/error в `desktop.log`.
- [x] Сравнить artifact size с baseline и объяснить существенное изменение.

Готово: macOS packaged smoke полностью пройден.

Заметка о выполнении: packaged Electron 43 запущен; Gateway, cluster, namespaces, watch, Pod Terminal PTY, Logs, Events, Describe, YAML и Related подтверждены в desktop.log. Пользователь подтвердил исправную работу UI, Settings/dialogs, SSH и Port Forward. DMG вырос 93 → 116 MB, ZIP 89 → 112 MB из-за Chromium 126 → 150 и нового Electron runtime.

## 7. Windows runtime и packaging — BLOCKED

Статус: `BLOCKED`: требуется реальная Windows x64 машина; macOS не может подтвердить portable/ConPTY runtime.

- [ ] Выполнить `npm.cmd run verify`.
- [ ] Собрать portable x64 artifact.
- [ ] Проверить startup и shutdown portable-приложения.
- [ ] Проверить таблицы, drawer, dialogs и lazy panels.
- [ ] Проверить Terminal copy/paste, Backspace/Delete, arrows, Home/End.
- [ ] Проверить terminal resize и `stty size`.
- [ ] Проверить reconnect и отсутствие orphan processes.
- [ ] Проверить Node SSH и Port Forward.

Готово: Windows artifact и ConPTY-поведение подтверждены на Windows x64.

Заметка о выполнении: —

## 8. Security и regression review — DONE

Статус: `DONE` (2026-07-10).

- [x] Подтвердить sandbox/context isolation/node integration settings.
- [x] Проверить session token для HTTP и WebSocket Gateway.
- [x] Проверить отсутствие sensitive data в renderer/desktop/audit logs.
- [x] Проверить Secret и LLM sanitization contracts.
- [x] Проверить shutdown Watch/Terminal/SSH/Port Forward managers.
- [x] Просмотреть официальные security/breaking notes целевой Electron-версии.

Готово: security invariants сохранены, все contract tests проходят.

Заметка о выполнении: sandbox/contextIsolation/nodeIntegration/navigation invariants сохранены; HTTP/WebSocket auth и origin contracts проходят; Secret/LLM redaction и manager shutdown покрыты gateway 69/69. Официальные breaking notes 32–43 просмотрены; релевантны C++20 native modules и новое default расположение file dialogs, удалённых используемых API нет.

## 9. Завершение миграции — IN PROGRESS

Статус: `IN PROGRESS`: документация и macOS baseline обновлены; финальный commit/merge ожидают Windows acceptance.

- [x] Обновить README, architecture/security docs и changelog.
- [x] Записать новые Electron/Chromium/Node версии.
- [x] Обновить release checklist и evidence.
- [x] Выполнить финальный `npm run verify`.
- [ ] Убедиться, что macOS и Windows acceptance закрыты.
- [ ] Создать итоговый commit и только после этого сливать ветку.

Готово: новая Electron-версия воспроизводимо собирается и работает на macOS arm64 и Windows x64.

Заметка о выполнении: —

## Порядок диагностики при поломке

```text
install/lockfile
→ typecheck
→ renderer tests
→ gateway tests
→ Vite/main build
→ Electron dev startup
→ node-pty rebuild/load
→ packaged macOS
→ packaged Windows/ConPTY
```

Не переходить на следующий уровень, пока причина ошибки текущего уровня не зафиксирована.
