# KubeDeck 2.7.0 — план resource tabs и нескольких terminal tabs

Статус: план подготовлен, реализация не начата. Начинать после ручного принятия и слияния 2.6.0.

## Цель

Добавить привычную модель вкладок для параллельной работы:

1. Открывать несколько Kubernetes resources и быстро переключаться между их drawer.
2. Держать несколько активных Pod Terminal-сессий и переключаться между ними без отключения.

Resource и terminal tabs входят в один релиз, но не обязаны использовать один универсальный state manager: их lifecycle различается.

## Baseline после 2.6.0

- `App` хранит один `selectedTarget`, а `PodDrawer` показывает один resource.
- Выбор другой строки заменяет текущий drawer target.
- Локальные YAML draft, tab, filters и logs state принадлежат одному `PodDrawer`.
- `App` хранит один `pinnedTerminal`.
- `PinnedTerminalPanel` расположен вне drawer navigation и сохраняет один смонтированный `TerminalTab`.
- Запуск terminal для другого target сейчас требует замены первой сессии.

## Границы 2.7.0

В релиз входят:

- resource tab strip над drawer;
- terminal tab strip внутри закреплённой terminal-панели;
- открытие, активация и закрытие вкладок;
- явная identity cluster/resource/namespace/name и cluster/namespace/pod/container;
- защита несохранённого YAML;
- независимый lifecycle нескольких WebSocket terminal-сессий;
- лимиты вкладок и целевые renderer/Gateway contracts.

Не входят:

- восстановление открытых вкладок после перезапуска приложения;
- drag-and-drop reorder вкладок;
- detach во внешнее OS-окно;
- terminal split view;
- несколько одновременно видимых resource drawer;
- общий Redux/state manager, router или новая dependency.

## Часть A — resource tabs

### Поведение

- Первый выбранный resource создаёт активную вкладку.
- Выбор другого resource добавляет вкладку и делает её активной.
- Повторное открытие того же `cluster/resource/namespace/name/uid` активирует существующую вкладку без дубля.
- Вкладка показывает kind, namespace/name и короткую метку cluster.
- Закрытие активной вкладки активирует ближайшую соседнюю.
- Закрытие последней вкладки закрывает drawer.
- Вкладки разных clusters сохраняются и однозначно подписаны.
- Максимум: 10 resource tabs; при достижении лимита новый target не открывается и показывается понятное сообщение.

### Lifecycle

- Хранить только массив resource targets и id активной вкладки.
- Одновременно монтировать один активный `PodDrawer`, чтобы не запускать фоновые Logs, timers и resource requests для скрытых вкладок.
- При возвращении к вкладке drawer заново загружает нужные данные штатным путём.
- Перед переключением или закрытием вкладки с изменённым YAML запросить подтверждение; несохранённый draft нельзя терять молча.
- Действующие action confirmations остаются привязаны к исходному cluster и resource.

### Контракты

- [ ] Добавление target не мутирует исходный массив и не создаёт дубль identity.
- [ ] Активация вкладки обновляет `selectedTarget` атомарно.
- [ ] Закрытие первой, средней, последней и единственной вкладки выбирает корректный target.
- [ ] Cluster switch не переписывает identity уже открытых вкладок.
- [ ] Неактивные resource tabs не монтируют `PodDrawer` и не выполняют background refresh.
- [ ] Dirty YAML блокирует switch/close до выбора пользователя.
- [ ] Drawer actions и Related navigation открывают или активируют правильную вкладку.
- [ ] Лимит 10 обрабатывается без удаления старой вкладки.

## Часть B — несколько terminal tabs

### Поведение

- Запуск terminal для нового `cluster/namespace/pod/container` добавляет terminal tab без закрытия существующих.
- Повторный запуск того же target активирует существующую вкладку.
- Каждая вкладка показывает cluster, namespace/pod, container и connection status.
- Переключение terminal tab не размонтирует её `TerminalTab` и не закрывает WebSocket.
- Закрытие вкладки завершает только соответствующую terminal-сессию.
- `Close all` завершает все terminal-сессии после подтверждения.
- Collapse/expand скрывает или показывает общую панель без размонтирования terminal tabs.
- Общий сохранённый размер панели применяется ко всем terminal tabs.
- Максимум: 5 одновременных terminal sessions; при достижении лимита новый terminal не запускается.

### Lifecycle

- `App` хранит массив terminal targets и id активной terminal tab.
- Для каждой target поддерживается отдельный смонтированный `TerminalTab`.
- Неактивные terminals скрываются CSS, но остаются смонтированными ради WebSocket и scrollback.
- Закрытие terminal tab удаляет ровно один component, вызывая существующий cleanup xterm/WebSocket.
- Смена active cluster/resource не изменяет clusterId ни одной terminal target.

### Контракты

- [ ] Две и более terminal targets создают независимые WebSocket URL.
- [ ] Переключение active terminal не вызывает cleanup неактивной сессии.
- [ ] Закрытие одной вкладки вызывает один WebSocket close/dispose и не затрагивает соседние.
- [ ] Повторное открытие identity не создаёт второй WebSocket.
- [ ] Collapse/expand сохраняет все смонтированные sessions.
- [ ] Cluster identity каждой вкладки неизменна после навигации.
- [ ] Лимит 5 не закрывает существующую сессию автоматически.
- [ ] Paste остаётся на единственном xterm input path каждой terminal instance.

## Двойная проверка до реализации

- [ ] Проверка 1: перечислить все места, которые напрямую вызывают `setSelectedTarget`, и определить add-or-activate semantics.
- [ ] Проверка 2: подтвердить, что resource identity включает cluster/resource/namespace/name/uid и не конфликтует между CRD instances.
- [ ] Проверка 1: подтвердить, что каждый `TerminalTab` полностью владеет своим socket/xterm cleanup.
- [ ] Проверка 2: поднять две тестовые terminal instances и подтвердить отсутствие shared refs/state.
- [ ] Проверить влияние скрытого xterm на ResizeObserver и выполнить fit только при активации вкладки.

## UI и accessibility

- [ ] Active tab визуально различима во всех themes.
- [ ] Полные identity доступны через title/accessible name при усечённой подписи.
- [ ] Tab strip имеет горизонтальный scroll при переполнении.
- [ ] Keyboard navigation поддерживает Tab, Enter/Space и доступную кнопку Close.
- [ ] Закрытие вкладки возвращает focus в новый active tab или resource table.
- [ ] Terminal connection status различим без опоры только на цвет.

## Ручной smoke

- [ ] Открыть Pod, Service и Deployment; переключаться между тремя resource tabs.
- [ ] Открыть resources с одинаковым name в разных namespaces и clusters.
- [ ] Изменить YAML, попробовать switch и close, проверить защиту draft.
- [ ] Запустить два netshoot terminals для разных pods и выполнять команды в обоих.
- [ ] Переключать terminal tabs, свернуть панель, навигировать по resources и вернуться к обеим сессиям.
- [ ] Закрыть один terminal и убедиться, что второй продолжает работать.
- [ ] Проверить лимиты 10 resource tabs и 5 terminal tabs.

## Regression gate

- [ ] `npm run lint`.
- [ ] `npm run format:check`.
- [ ] `npm run test:renderer`.
- [ ] `npm run typecheck`.
- [ ] `npm run build`.
- [ ] `npm --workspace apps/desktop run test:gateway`.
- [ ] `npm run verify:release` после оформления версии 2.7.0.
- [ ] `git diff --check`.

## Критерии приёмки 2.7.0

- [ ] Пользователь быстро переключается между 2–10 открытыми resources.
- [ ] Пользователь одновременно поддерживает до 5 независимых terminal sessions.
- [ ] Resource tabs не создают скрытые background requests.
- [ ] Terminal tabs сохраняют WebSocket и scrollback при переключении.
- [ ] Dirty YAML, cluster identity и cleanup защищены.
- [ ] Новые dependencies и лишние архитектурные слои не добавлены.
- [ ] Автоматический gate и ручной smoke пройдены.
