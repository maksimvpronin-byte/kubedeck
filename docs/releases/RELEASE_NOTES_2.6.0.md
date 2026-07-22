# KubeDeck 2.6.0 — Release Notes

Дата подготовки: 2026-07-21

KubeDeck 2.6.0 добавляет закреплённую Pod Terminal-сессию для диагностики во время навигации по ресурсам. Node-only baseline остаётся неизменным: Node 50 / Python 0.

## Pinned Pod Terminal

- Запущенный terminal живёт независимо от resource drawer и выбранной строки.
- Навигация по Pods, Services, Deployments, Nodes и переключение cluster не закрывают исходную сессию.
- Постоянная панель показывает cluster, namespace, pod и container.
- Панель можно свернуть, развернуть и явно закрыть.
- Панель можно менять по ширине и высоте видимым drag-handle; последний размер сохраняется локально.
- При запуске terminal для другого target требуется подтверждение замены текущей сессии.
- Сохранены действующие xterm, kubectl exec, PTY и единственный paste input path.

## Artifacts

- Windows x64: `apps\desktop\release\KubeDeck-Portable-2.6.0-x64.exe`;
- macOS arm64: `apps/desktop/release/KubeDeck-2.6.0-arm64.dmg` и `.zip`.
