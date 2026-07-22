# KubeDeck 2.5.2 — Release Notes

Дата подготовки: 2026-07-21

KubeDeck 2.5.2 расширяет управление большими resource-таблицами и упрощает замену выбранного namespace. Node-only baseline остаётся неизменным: Node 50 / Python 0.

## Изменения

- В selector размера страницы добавлено значение `2000`; default остаётся `200`.
- При поиске Namespace Selector сохраняет выбранные namespace рядом с совпавшими результатами.
- Старый namespace можно снять и выбрать новый без очистки поисковой строки.
- Backend-загрузка, watch, polling, multi-select и выбор namespace по cluster не изменены.

## Artifacts

- Windows x64: `apps\desktop\release\KubeDeck-Portable-2.5.2-x64.exe`;
- macOS arm64: `apps/desktop/release/KubeDeck-2.5.2-arm64.dmg` и `.zip`.
