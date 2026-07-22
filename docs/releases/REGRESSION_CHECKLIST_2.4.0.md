# KubeDeck 2.4.0 — Regression Checklist

Дата: 2026-07-15

## Automated gate

- [x] `npm run verify:release`.
- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`; 19/19 tests.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway`; 70/70 tests.
- [x] Release contracts: Node 50 / Python 0.

## Async feedback contracts

- [x] Pending устанавливается синхронно и длится не менее 300 мс.
- [x] Повторный запуск одной операции во время pending игнорируется.
- [x] Fulfilled и rejected операции переходят в success и error соответственно.
- [x] Cleanup отменяет таймеры и предотвращает поздние обновления состояния.
- [x] Resource Table, Problems, Audit, Port Forward, Logs, Secrets, YAML, About, Resource Cache и Watch Diagnostics используют общий feedback.
- [x] Interval, Resource Watch и Logs follow-mode не запускают ручную анимацию.
- [x] Кнопки используют semantic tokens, `aria-busy`, доступный label и reduced-motion fallback.

## Manual UI smoke

- [ ] Проверить idle, pending, success и error для десяти Refresh/Reload-точек.
- [ ] Проверить быстрый и медленный ответ, отсутствие двойного запуска и layout shift.
- [ ] Проверить Tab, Enter, Space, focus и disabled-состояние.
- [ ] Проверить `prefers-reduced-motion`.
- [ ] Проверить Light, Midnight Blue, Nord Frost, Forest Teal, Plum Graphite и Warm Mocha.
- [ ] Проверить Cluster/namespace navigation, Resource Table, Problems, Audit и Settings без регрессий.
- [ ] Проверить Pod Drawer: Summary, YAML, Logs, Related и Terminal.
- [ ] Проверить LLM preview/analyze: Kubernetes logs не попадают в LLM-контекст.

## Packaged artifacts

- [x] macOS arm64 DMG/ZIP собраны и прошли автоматическую payload-проверку.
- [ ] Windows Portable x64 собран на Windows и прошёл payload-проверку.
- [ ] Ручной packaged smoke отмечается после проверки соответствующей ОС.

## Acceptance

- [x] Все автоматические контракты KubeDeck `2.4.0` выполнены.
- [x] Имена и build metadata macOS/Windows синхронизированы на `2.4.0`.
- [ ] Cross-platform packaged smoke закрывается после ручной проверки artifacts.
