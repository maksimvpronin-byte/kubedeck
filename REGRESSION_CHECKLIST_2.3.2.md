# KubeDeck 2.3.2 — Regression Checklist

Дата: 2026-07-15

## Automated gate

- [x] `npm run verify:release`.
- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`; 16/16 tests.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway`; 70/70 tests.
- [x] Release contracts: Node 50 / Python 0.

## Theme contracts

- [x] Legacy `dark` и неизвестные значения используют Midnight Blue.
- [x] System разрешается в Light или Midnight Blue по теме ОС.
- [x] Выбор сохраняется и восстанавливается до первого кадра React.
- [x] Shared Theme type содержит все актуальные значения.
- [x] Все темы используют обязательный набор семантических токенов.
- [x] First/Prev/Next/Last используют общие button-токены во всех состояниях.
- [x] Pod Terminal и Node SSH Terminal обновляют палитру без переподключения.

## Manual UI smoke

- [ ] Проверить sidebar и ручной порядок clusters без визуальной регрессии.
- [ ] Проверить каждую тему в Resource Table, toolbar, pagination и namespace dropdown.
- [ ] Проверить Pod Drawer: Summary, YAML, Logs, Related и Terminal.
- [ ] Проверить Settings, Problems, Audit, Port Forward, LLM и модальные окна.
- [ ] Проверить hover, selected, focus-visible, disabled, scrollbars и resize handles.
- [ ] Перезапустить приложение и проверить сохранение выбранной темы.
- [ ] Проверить Light и System без регрессий.

## Packaged artifacts

- [x] macOS arm64 DMG/ZIP собраны и прошли автоматическую payload-проверку.
- [ ] Windows Portable x64 подготовлен и прошёл доступную автоматическую payload-проверку.
- [ ] Ручной packaged smoke отмечается после проверки соответствующей ОС.

## Acceptance

- [x] Все автоматические контракты KubeDeck `2.3.2` выполнены.
- [x] Имена и build metadata macOS/Windows синхронизированы на `2.3.2`; фактический Windows artifact проверяется на Windows.
- [ ] Cross-platform packaged smoke закрывается после ручной проверки artifacts.
