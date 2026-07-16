# KubeDeck 2.4.1 — Release Notes

Дата подготовки: 2026-07-15

KubeDeck 2.4.1 устраняет визуальный рывок открытого resource drawer во время фонового обновления таблицы и упрощает результаты YAML-операций. Релиз сохраняет Node-only runtime: все 50 backend-маршрутов работают в Node.js, Python-маршрутов — 0.

## Стабильный resource drawer

- Lifecycle drawer теперь определяется стабильной identity: cluster, resource, namespace, name и uid.
- Новый object reference той же строки после auto-refresh больше не сбрасывает данные и не запускает повторную загрузку активной вкладки.
- Реальная смена ресурса по-прежнему отменяет старые запросы и полностью очищает snapshot.
- Активная вкладка, YAML draft, search, scroll, focus, параметры Logs и ширина drawer сохраняются.
- Обновившиеся поля строки продолжают отображаться в Summary без remount локального UI.

## Чистая YAML-вкладка

- Удалена крупная панель `Reload YAML / Copy output`, дублировавшая состояние кнопки Reload.
- Удалены аналогичные постоянные success-панели Dry-run и Apply.
- Dry-run и Apply показывают компактный локализованный статус возле управляющих кнопок.
- Ошибки Reload, Dry-run и Apply остаются в существующем ErrorPanel вместе с Copy, stderr и command preview.
- YAML editor, dirty-state, Apply confirmation и read-only защита CRD не изменены.

## Проверка

Автоматический gate включает lint, format check, 20 renderer contracts, TypeScript typecheck, production build и 70 Gateway contracts. Release contract подтверждает Node 50 / Python 0 и одинаковую версию artifacts для macOS и Windows.

## Artifacts

- Windows x64: `apps\desktop\release\KubeDeck-Portable-2.4.1-x64.exe`;
- macOS arm64: `apps/desktop/release/KubeDeck-2.4.1-arm64.dmg` и `.zip`.
