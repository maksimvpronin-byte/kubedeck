# KubeDeck 2.3.2 — Release Notes

Дата подготовки: 2026-07-15

KubeDeck 2.3.2 добавляет полноценную систему цветовых тем поверх стабильного Node-only runtime. Все 50 backend-контрактов остаются в Node.js; Kubernetes-логика и маршруты не менялись.

## Цветовые темы

- Добавлены Midnight Blue, Nord Frost, Forest Teal, Plum Graphite и Warm Mocha; Light и System сохранены.
- Старое значение `dark` автоматически преобразуется в Midnight Blue, неизвестные значения безопасно используют ту же тему.
- System следует светлой/тёмной теме ОС, используя Midnight Blue для dark mode.
- Тема применяется сразу, сохраняется после перезапуска и восстанавливается до первого кадра React.
- В Settings добавлены доступные с клавиатуры карточки с названием, описанием и preview палитры.

## Единый визуальный контракт

- Поверхности, текст, границы, формы, кнопки и состояния переведены на централизованные семантические токены.
- Пагинация First/Prev/Next/Last и page-size selector используют общие normal, hover, active, focus и disabled состояния.
- Pod Terminal и Node SSH Terminal получают цвета из активной темы и обновляются без переподключения.
- Тематизированы панели Resources, Settings, Problems, Audit, Diagnostics, Port Forward, Related Resources, drawers, modals, command palette, scrollbars и resize-индикаторы.

## Проверка

Обязательный автоматический gate:

```powershell
npm.cmd run verify:release
npm.cmd run verify
```

Gate включает lint, format check, renderer contracts, TypeScript typecheck, production build и gateway contract tests. Runtime остаётся Node-only: Node 50 / Python 0.

## Artifacts

- Windows x64: `apps\desktop\release\KubeDeck-Portable-2.3.2-x64.exe`;
- macOS arm64: `apps/desktop/release/KubeDeck-2.3.2-arm64.dmg` и `.zip`.
