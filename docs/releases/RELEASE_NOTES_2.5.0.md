# KubeDeck 2.5.0 — Release Notes

Дата подготовки: 2026-07-21

KubeDeck 2.5.0 удаляет дважды проверенный неиспользуемый код без изменения действующего поведения и без новых зависимостей. Node-only baseline остаётся неизменным: Node 50 / Python 0.

## Cleanup

- Удалён недостижимый pipes fallback Pod Terminal; встроенный terminal продолжает использовать обязательный PTY transport.
- Удалены неиспользуемые IPC channels `getBackendUrl` и `openPodShell` вместе с устаревшим генератором внешних terminal scripts.
- Удалены три shared migration type без потребителей.
- Удалён старый CSS-блок `restart-diagnostics-*`; действующая карточка `pod-restart-*` сохранена.
- Удалены семь PowerShell repair/validate/finalize scripts старого Python/1.0.x layout.

## Результат

- Подтверждённые production/script удаления: 1 120 строк.
- Renderer CSS bundle уменьшен с 115,44 до 113,20 КБ.
- Проведены два независимых полных прохода по imports, exports, dependencies, scripts, tests, locales, CSS и generated files.
- Неоднозначные dynamic/xterm selectors, dependencies и исторические документы сохранены.

## Artifacts

- Windows x64: `apps\desktop\release\KubeDeck-Portable-2.5.0-x64.exe`;
- macOS arm64: `apps/desktop/release/KubeDeck-2.5.0-arm64.dmg` и `.zip`.
