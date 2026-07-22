# KubeDeck 2.5.1 — Release Notes

Дата подготовки: 2026-07-21

KubeDeck 2.5.1 снижает повторную нагрузку больших resource-таблиц и сохраняет названия столбцов при прокрутке. Node-only baseline остаётся неизменным: Node 50 / Python 0.

## Изменения

- Interval polling приостанавливается, пока backend watch и его WebSocket доступны, и возвращается при отказе watch.
- `kubectl watch` запускается с `--watch-only=true`, поэтому существующие pod не создают стартовый burst событий и повторную полную загрузку.
- Заголовок resource-таблицы закреплён внутри существующего scroll-контейнера без клонирования таблицы и JavaScript-синхронизации.
- Начальная загрузка, ручной Refresh, реальные watch-события и пользовательский polling fallback сохранены.

## Artifacts

- Windows x64: `apps\desktop\release\KubeDeck-Portable-2.5.1-x64.exe`;
- macOS arm64: `apps/desktop/release/KubeDeck-2.5.1-arm64.dmg` и `.zip`.
