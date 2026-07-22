# KubeDeck 2.7.0 — план resource tabs и нескольких terminal tabs

Статус: расширенный план подготовлен после принятия 2.6.0; реализация не начата.

## Цель

Добавить привычную модель вкладок для параллельной работы:

1. Открывать несколько Kubernetes resources и быстро переключаться между их drawer.
2. Держать несколько активных Pod Terminal-сессий и переключаться между ними без отключения.

Resource и terminal tabs входят в один релиз, но не обязаны использовать один универсальный state manager: их lifecycle различается.

## Принятые продуктовые решения

- Resource tab сохраняет identity target и выбранную внутреннюю drawer-tab (`Summary`, `YAML`, `Logs` и т. д.), но не держит скрытый `PodDrawer` смонтированным.
- При возврате Kubernetes-данные перечитываются. Scroll, временные filters и загруженные snapshots могут сброситься; это осознанная граница 2.7.0.
- Несохранённый YAML никогда не теряется молча: switch, close, related navigation и cluster change проходят через один navigation guard.
- Terminal tab — полноценная живая session: все terminal components остаются смонтированными ради WebSocket, xterm buffer и scrollback.
- Один и тот же pod/container может иметь несколько terminal sessions. Их различает уникальный renderer `sessionId`, а не только Kubernetes target.

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
- лимиты вкладок и целевые renderer/Gateway contracts;
- детерминированная cross-cluster activation;
- состояния stale/deleted resource target;
- корректная реакция вкладок на Delete, Restart и удаление cluster.

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
- Каждая вкладка запоминает последнюю выбранную внутреннюю drawer-tab, но не scroll, filters и загруженные Kubernetes snapshots.

### Cross-cluster activation

- Resource tab содержит достаточно данных для восстановления контекста: cluster id/name, section, resource, namespace, name, uid и row snapshot.
- Активация выполняется строго в порядке: navigation generation → `openCluster` → section/resource → namespace scope → live resource reload → drawer target.
- Пока cluster открывается, вкладка показывает Loading и не подставляет target в старый active cluster.
- Поздний ответ предыдущей активации не может перезаписать новую active tab.
- Ошибка открытия cluster оставляет вкладку доступной со статусом Unavailable и действиями Retry/Close.

### Lifecycle

- Хранить только массив resource targets и id активной вкладки.
- Одновременно монтировать один активный `PodDrawer`, чтобы не запускать фоновые Logs, timers и resource requests для скрытых вкладок.
- При возвращении к вкладке drawer заново загружает нужные данные штатным путём.
- Перед переключением или закрытием вкладки с изменённым YAML запросить подтверждение; несохранённый draft нельзя терять молча.
- Действующие action confirmations остаются привязаны к исходному cluster и resource.
- `PodDrawer` сообщает tab manager текущую внутреннюю drawer-tab и dirty YAML flag через минимальные callbacks.
- Один navigation guard обслуживает tab switch, close, table selection, Related/Global Search navigation и cluster switch.

### Freshness и завершение resource lifecycle

- Row snapshot используется только для немедленной подписи и Loading state; после активации он заменяется live response.
- Если live resource не найден по uid или namespace/name, вкладка переходит в `Not found`, не показывая устаревшие данные как актуальные.
- `Not found` предлагает Retry и Close; автоматическое бесконечное повторение запрещено.
- Успешный Delete закрывает именно исходную resource tab и активирует соседнюю.
- Pod Restart закрывает старую UID-вкладку; новый pod открывается только после явного выбора или Related navigation.
- Остальные actions обновляют row snapshot исходной вкладки после штатного reload.

### Контракты

- [ ] Добавление target не мутирует исходный массив и не создаёт дубль identity.
- [ ] Активация вкладки обновляет `selectedTarget` атомарно.
- [ ] Закрытие первой, средней, последней и единственной вкладки выбирает корректный target.
- [ ] Cluster switch не переписывает identity уже открытых вкладок.
- [ ] Cross-cluster activation соблюдает порядок cluster → resource → namespace → reload и отбрасывает stale completion.
- [ ] Неактивные resource tabs не монтируют `PodDrawer` и не выполняют background refresh.
- [ ] Dirty YAML блокирует switch/close до выбора пользователя.
- [ ] Dirty YAML guard применяется также к Related/Search/table/cluster navigation.
- [ ] Drawer actions и Related navigation открывают или активируют правильную вкладку.
- [ ] Delete/Restart закрывают правильную исходную вкладку, даже если async result пришёл после смены active tab.
- [ ] Live reload заменяет snapshot либо переводит вкладку в Not found/Unavailable.
- [ ] Лимит 10 обрабатывается без удаления старой вкладки.

## Часть B — несколько terminal tabs

### Поведение

- Запуск terminal для нового `cluster/namespace/pod/container` добавляет terminal tab без закрытия существующих.
- Если для того же target уже есть session, пользователь выбирает `Перейти к существующей` или `Открыть новую`.
- Новая session получает уникальный `sessionId`, поэтому два terminal одного pod/container работают независимо.
- Каждая вкладка показывает cluster, namespace/pod, container и connection status.
- Переключение terminal tab не размонтирует её `TerminalTab` и не закрывает WebSocket.
- Закрытие вкладки завершает только соответствующую terminal-сессию.
- `Close all` завершает все terminal-сессии после подтверждения.
- Collapse/expand скрывает или показывает общую панель без размонтирования terminal tabs.
- Общий сохранённый размер панели применяется ко всем terminal tabs.
- Максимум: 5 одновременных terminal sessions; при достижении лимита новый terminal не запускается.
- При достижении лимита существующие sessions никогда не закрываются автоматически; интерфейс предлагает активировать или закрыть одну из них.

### Lifecycle

- `App` хранит массив terminal targets и id активной terminal tab.
- Identity terminal component основана на `sessionId`; Kubernetes target используется только для подписи и команды подключения.
- Для каждой target поддерживается отдельный смонтированный `TerminalTab`.
- Неактивные terminals скрываются CSS, но остаются смонтированными ради WebSocket и scrollback.
- Закрытие terminal tab удаляет ровно один component, вызывая существующий cleanup xterm/WebSocket.
- Смена active cluster/resource не изменяет clusterId ни одной terminal target.
- `TerminalTab` сообщает наружу `Connecting`, `Connected`, `Disconnected` и `Error` через `onStatusChange`, не передавая наружу socket/xterm refs.
- При активации ранее скрытого xterm выполняется один fit/resize; скрытые вкладки не пытаются fit в zero-size container.

### Контракты

- [ ] Две и более terminal targets создают независимые WebSocket URL.
- [ ] Переключение active terminal не вызывает cleanup неактивной сессии.
- [ ] Закрытие одной вкладки вызывает один WebSocket close/dispose и не затрагивает соседние.
- [ ] Повторное открытие target предлагает activate/new; new создаёт новый `sessionId` и независимый WebSocket.
- [ ] Две sessions одного pod/container могут одновременно принимать input/output.
- [ ] Collapse/expand сохраняет все смонтированные sessions.
- [ ] Cluster identity каждой вкладки неизменна после навигации.
- [ ] `onStatusChange` обновляет только соответствующую terminal tab.
- [ ] Активация скрытой вкладки выполняет fit без изменения соседних sessions.
- [ ] Лимит 5 не закрывает существующую сессию автоматически.
- [ ] Paste остаётся на единственном xterm input path каждой terminal instance.

## Двойная проверка до реализации

- [ ] Проверка 1: перечислить все места, которые напрямую вызывают `setSelectedTarget`, и определить add-or-activate semantics.
- [ ] Проверка 2: подтвердить, что resource identity включает cluster/resource/namespace/name/uid и не конфликтует между CRD instances.
- [ ] Проверка 1: подтвердить, что каждый `TerminalTab` полностью владеет своим socket/xterm cleanup.
- [ ] Проверка 2: поднять две тестовые terminal instances и подтвердить отсутствие shared refs/state.
- [ ] Проверить влияние скрытого xterm на ResizeObserver и выполнить fit только при активации вкладки.
- [ ] Проверить все успешные Delete/Restart/action completion paths и их привязку к source tab id.
- [ ] Проверить все cluster removal paths и backend cleanup активных terminal sessions.

## Удаление cluster и shutdown

- Перед удалением cluster показать количество его открытых resource tabs и terminal sessions.
- После подтверждения закрыть resource tabs удаляемого cluster.
- Terminal sessions этого cluster закрыть до удаления cluster runtime; sessions других clusters не затрагивать.
- Если удаляемая resource tab активна, выбрать ближайшую вкладку другого cluster либо закрыть drawer.
- Application shutdown закрывает каждую terminal session ровно один раз существующим backend cleanup.
- Renderer refresh/crash не обещает восстановление sessions; это остаётся вне 2.7.0.

### Контракты удаления

- [ ] Cluster removal summary считает resource и terminal tabs без раскрытия kubeconfig path или credentials.
- [ ] Отмена удаления не меняет вкладки и sessions.
- [ ] Подтверждение удаляет только tabs/sessions выбранного cluster.
- [ ] Ошибка cluster removal не оставляет terminal UI в ложном Connected state.
- [ ] Shutdown с 1–5 sessions завершается без duplicate close и hanging process.

## Resource budgets

- Пять xterm instances со `scrollback: 5000` являются жёстким потолком 2.7.0.
- Не увеличивать scrollback и terminal limit без отдельного memory measurement.
- Проверить renderer memory до запуска sessions, после пяти sessions и после `Close all`.
- После закрытия всех sessions WebSocket, ResizeObserver, timers и xterm buffers должны освобождаться.

## UI и accessibility

- [ ] Active tab визуально различима во всех themes.
- [ ] Полные identity доступны через title/accessible name при усечённой подписи.
- [ ] Tab strip имеет горизонтальный scroll при переполнении.
- [ ] Keyboard navigation поддерживает Tab, Enter/Space и доступную кнопку Close.
- [ ] Закрытие вкладки возвращает focus в новый active tab или resource table.
- [ ] Terminal connection status различим без опоры только на цвет.
- [ ] Одинаковые terminal targets получают различимые подписи, например `netshoot · 1` и `netshoot · 2`.
- [ ] Loading, Not found и Unavailable resource tab доступны screen reader и не определяются только цветом.

## Ручной smoke

- [ ] Открыть Pod, Service и Deployment; переключаться между тремя resource tabs.
- [ ] Открыть resources с одинаковым name в разных namespaces и clusters.
- [ ] Активировать вкладку другого cluster во время медленного открытия, затем третью; stale completion не меняет active tab.
- [ ] Удалить или пересоздать resource вне KubeDeck и вернуться к вкладке; проверить Not found/UID replacement.
- [ ] Изменить YAML, попробовать switch и close, проверить защиту draft.
- [ ] Запустить два netshoot terminals для разных pods и выполнять команды в обоих.
- [ ] Запустить два terminals для одного pod/container и подтвердить независимый input/output.
- [ ] Переключать terminal tabs, свернуть панель, навигировать по resources и вернуться к обеим сессиям.
- [ ] Закрыть один terminal и убедиться, что второй продолжает работать.
- [ ] Проверить лимиты 10 resource tabs и 5 terminal tabs.
- [ ] Удалить cluster с открытыми resource/terminal tabs и проверить scoped cleanup.
- [ ] Сравнить renderer memory до пяти terminals, при пяти и после Close all.

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
- [ ] Cross-cluster activation устойчива к async races и unavailable cluster.
- [ ] Delete, Restart, Not found и cluster removal обновляют только правильные tabs/sessions.
- [ ] Несколько sessions одного terminal target поддерживаются через уникальный `sessionId`.
- [ ] Пять закрытых terminal tabs освобождают связанные renderer/backend resources.
- [ ] Новые dependencies и лишние архитектурные слои не добавлены.
- [ ] Автоматический gate и ручной smoke пройдены.
