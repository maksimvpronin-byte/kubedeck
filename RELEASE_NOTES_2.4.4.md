# KubeDeck 2.4.4 — Release Notes

Дата подготовки: 2026-07-16

KubeDeck 2.4.4 исправляет двойную вставку текста в Pod Terminal на Windows. Ввод из clipboard теперь проходит только через штатный механизм xterm и создаёт одно WebSocket-сообщение на одну операцию вставки. Релиз сохраняет Node-only runtime: Node 50 / Python 0.

## Исправление терминала

- Удалено ручное чтение clipboard для `Ctrl+V`, `Ctrl+Shift+V` и `Shift+Insert`.
- Удалён дополнительный DOM-обработчик `paste` на контейнере терминала.
- Единственным источником терминального ввода остаётся `terminal.onData()`.
- macOS-вставка через `Cmd+V` сохраняет штатное поведение xterm.
- Backend и ConPTY-контракт не изменены.
- Добавлен renderer-контракт против повторного появления конкурирующих paste-маршрутов.

## Проверка

Автоматический gate включает lint, format check, 25 renderer contracts, TypeScript typecheck, production build и 70 Gateway contracts. Release contract проверяет Node 50 / Python 0 и одинаковую версию artifacts для macOS и Windows.

## Artifacts

- Windows x64: `apps\desktop\release\KubeDeck-Portable-2.4.4-x64.exe`;
- macOS arm64: `apps/desktop/release/KubeDeck-2.4.4-arm64.dmg` и `.zip`.
