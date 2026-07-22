# KubeDeck 2.7.0 — resource tabs и встроенные терминалы

Статус: реализовано; автоматические проверки выполнены, ручной smoke ожидает подтверждения.

## Scope

- Один клик открывает ресурс временно, двойной закрепляет его во вкладке.
- До 10 resource tabs с identity `cluster/resource/namespace/name/uid`.
- Переключение сохранённой вкладки не изменяет namespace selector.
- Drawer хранит активную внутреннюю вкладку и защищает несохранённый YAML.
- Loading, Not found и Unavailable не запускают stale activation.
- Только один PodDrawer обслуживает активный ресурс; скрытые resource drawers не монтируются.
- До 5 Pod Terminal sessions живут во вкладках нижней панели под resource list.
- Нижняя панель сохраняет WebSocket, xterm и scrollback при переключении resource tabs.
- Отдельного плавающего terminal window нет.
- Новые зависимости не добавляются.

## Контракты

- Повторный double click не создаёт duplicate resource tab.
- При лимите новая вкладка или terminal session не создаётся.
- Async activation проверяет request generation до обновления UI.
- Переключение resource tab не размонтирует нижнюю terminal panel.
- Скрытый xterm выполняет fit при повторной активации.
- Удаление cluster закрывает связанные resource tabs и terminal tabs.
- Закрытие drawer или приложения освобождает WebSocket, ResizeObserver, timers и xterm buffers.

## Ручной smoke

- [ ] Открыть Pod, Service и Deployment двойным кликом и переключаться между вкладками.
- [ ] Убедиться, что namespace selector не меняется при активации сохранённого ресурса.
- [ ] Изменить YAML и проверить защиту при switch/close.
- [ ] Открыть терминалы в двух Pod, выполнять команды и переключать resource tabs.
- [ ] Проверить сохранение connection и scrollback после возвращения.
- [ ] Проверить лимиты 10 resource tabs и 5 terminal tabs.
- [ ] Удалить cluster с открытыми вкладками и терминалами.

## Regression gate

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [ ] `npm --workspace apps/desktop run test:gateway`.
- [x] `npm run verify:release`.
- [x] `git diff --check`.
