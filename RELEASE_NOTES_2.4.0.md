# KubeDeck 2.4.0 — Release Notes

Дата подготовки: 2026-07-15

KubeDeck 2.4.0 делает результат ручного обновления данных однозначным во всём приложении. Релиз сохраняет Node-only runtime, систему тем 2.3.2 и существующую Kubernetes-логику: все 50 backend-маршрутов остаются в Node.js, Python-маршрутов — 0.

## Async feedback для Refresh и Reload

- Resource Table, Problems, Audit, Port Forward, Logs, Secrets, YAML, About, Resource Cache Diagnostics и Watch Diagnostics используют единый контракт `idle → pending → success/error`.
- Во время ручного запроса иконка вращается, кнопка блокирует повторный запуск и остаётся в pending не менее 300 мс.
- После успеха кратко показываются `Updated` или `Reloaded`; после ошибки — локализованное failure-состояние без подмены существующего подробного сообщения.
- Ширина кнопки стабильна между состояниями, поэтому смена label не вызывает layout shift.
- Фоновые interval, Resource Watch и Logs follow-mode обновления не включают feedback ручной кнопки.

## Доступность и темы

- Кнопки сохраняют нативную keyboard-семантику и focus, публикуют актуальные accessible name, `aria-busy` и спокойное `aria-live`-уведомление.
- `prefers-reduced-motion: reduce` отключает вращение, сохраняя понятные label и состояние операции.
- Success/error используют общие semantic tokens и работают во всех темах без локальных цветовых исключений.

## Проверка

Обязательный автоматический gate:

```powershell
npm.cmd run verify:release
npm.cmd run verify
```

Gate включает lint, format check, renderer contracts, TypeScript typecheck, production build и gateway contract tests. Runtime остаётся Node-only: Node 50 / Python 0.

## Artifacts

- Windows x64: `apps\desktop\release\KubeDeck-Portable-2.4.0-x64.exe`;
- macOS arm64: `apps/desktop/release/KubeDeck-2.4.0-arm64.dmg` и `.zip`.
