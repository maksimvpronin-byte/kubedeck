# KubeDeck — Electron Upgrade Plan

Цель: изолированно обновить Electron `31.7.7` до поддерживаемой версии без одновременного рефакторинга приложения. Начинать только после завершения `reliability-hardening-plan.md`.

Статусы: `TODO` → `IN PROGRESS` → `DONE` или `BLOCKED`.

## Ограничения миграции

- Не смешивать обновление с рефакторингом Gateway, SSH, Terminal, CSS или новым UX.
- Не менять HTTP/WebSocket-контракты без отдельной причины и теста.
- Не сливать ветку до packaged smoke на macOS и Windows.
- Любую совместимость исправлять минимальным отдельным изменением с проверкой.
- Сохранять `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

## 1. Создание изолированной ветки

Статус: `TODO`.

- [ ] Убедиться, что `main` чистый и reliability plan завершён.
- [ ] Создать ветку `chore/electron-upgrade`.
- [ ] Записать исходные версии Electron, Chromium, Node, `node-pty`, `@electron/rebuild` и electron-builder.
- [ ] Приложить baseline результатов `npm run verify` и размеров artifacts.

Готово: миграция начинается из зелёного воспроизводимого baseline.

Заметка о выполнении: —

## 2. Выбор целевой версии

Статус: `TODO`.

- [ ] Проверить текущие поддерживаемые stable-релизы Electron по официальному schedule.
- [ ] Выбрать поддерживаемую целевую major-версию, предпочтительно не prerelease.
- [ ] Изучить breaking changes от Electron 31 до целевой версии.
- [ ] Проверить требования Node.js, macOS и Windows.
- [ ] Зафиксировать выбранную версию и причину выбора в этом файле.

Выбранная версия: —

Причина: —

## 3. Минимальное обновление зависимостей

Статус: `TODO`.

- [ ] Обновить сначала только `electron` и lockfile.
- [ ] Запустить install без массового обновления остальных packages.
- [ ] Обновлять `@electron/rebuild` только при несовместимости или официальном требовании.
- [ ] Обновлять electron-builder только при подтверждённой необходимости.
- [ ] Проверить отсутствие неожиданных dependency upgrades.

Готово: diff зависимостей минимален и объясним.

Заметка о выполнении: —

## 4. Source и build compatibility

Статус: `TODO`.

- [ ] Выполнить typecheck, renderer tests, gateway tests и build.
- [ ] Проверить Electron main/preload API на deprecations.
- [ ] Проверить BrowserWindow security preferences.
- [ ] Проверить IPC handlers и preload bridge.
- [ ] Проверить блокировку renderer navigation и window opening.
- [ ] Исправлять каждый тип несовместимости отдельным commit при необходимости.

Готово: `npm run verify` проходит на целевом Electron.

Заметка о выполнении: —

## 5. Native module compatibility

Статус: `TODO`.

- [ ] Пересобрать `node-pty` через `@electron/rebuild`.
- [ ] Проверить загрузку `node-pty` через `ELECTRON_RUN_AS_NODE`.
- [ ] Проверить наличие и executable bit у macOS `spawn-helper`.
- [ ] Проверить Windows ConPTY binary/runtime.
- [ ] Проверить, что ASAR unpack содержит необходимые native files.
- [ ] Не обновлять `node-pty`, если текущая версия совместима и тесты проходят.

Готово: native module загружается в dev и packaged runtime на обеих платформах.

Заметка о выполнении: —

## 6. macOS runtime и packaging

Статус: `TODO`.

- [ ] Запустить dev-приложение.
- [ ] Собрать arm64 DMG и ZIP.
- [ ] Проверить packaged startup и clean shutdown.
- [ ] Проверить Settings/file dialogs/About diagnostics.
- [ ] Проверить Pod Terminal input/paste/resize/reconnect.
- [ ] Проверить Node SSH и Port Forward lifecycle.
- [ ] Проверить отсутствие crash/error в `desktop.log`.
- [ ] Сравнить artifact size с baseline и объяснить существенное изменение.

Готово: macOS packaged smoke полностью пройден.

Заметка о выполнении: —

## 7. Windows runtime и packaging

Статус: `TODO`.

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

## 8. Security и regression review

Статус: `TODO`.

- [ ] Подтвердить sandbox/context isolation/node integration settings.
- [ ] Проверить session token для HTTP и WebSocket Gateway.
- [ ] Проверить отсутствие sensitive data в renderer/desktop/audit logs.
- [ ] Проверить Secret и LLM sanitization contracts.
- [ ] Проверить shutdown Watch/Terminal/SSH/Port Forward managers.
- [ ] Просмотреть официальные security/breaking notes целевой Electron-версии.

Готово: security invariants сохранены, все contract tests проходят.

Заметка о выполнении: —

## 9. Завершение миграции

Статус: `TODO`.

- [ ] Обновить README, architecture/security docs и changelog.
- [ ] Записать новые Electron/Chromium/Node версии.
- [ ] Обновить release checklist и evidence.
- [ ] Выполнить финальный `npm run verify`.
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

