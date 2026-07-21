# KubeDeck 2.5.1 — план снижения нагрузки Pods и закрепления заголовков таблицы

Статус: реализация и автоматический regression gate завершены; ожидается ручной smoke.

## Цель

Убрать два подтверждённых источника повторных полных загрузок Pods и сохранить заголовки большой resource-таблицы при вертикальной прокрутке:

1. Не запускать периодический polling таблицы, пока backend watch работает и его WebSocket-соединение доступно.
2. Не получать стартовый поток `ADDED` для всех уже существующих pod при запуске watch.
3. Закрепить строку с названиями столбцов внутри текущего scroll-контейнера таблицы.

Изменение не должно убирать первоначальную загрузку таблицы, реакцию на реальные watch-события, ручной Refresh или polling fallback при отказе watch.

## Подтверждённый baseline

При открытии Pods сейчас выполняются:

- `kubectl get pods ... -o json`;
- `kubectl top pods ... --no-headers`;
- `kubectl get pods ... -o json --watch=true --output-watch-events=true`;
- повторный полный `get + top` после burst стартовых watch-событий;
- дополнительный полный `get + top` каждые 10 секунд по умолчанию.

Для нескольких выбранных namespaces resource list и metrics запускаются отдельно на каждый namespace с параллелизмом два. Cache для основной таблицы намеренно отключён, поэтому каждый refresh обращается к Kubernetes API.

## Границы 2.5.1

В релиз входят только:

- управление polling по фактическому состоянию watch;
- запуск watch в режиме `watch-only`;
- sticky header для всех resource-таблиц;
- целевые renderer/Gateway contracts;
- release metadata и документы 2.5.1 после реализации.

Не входят:

- изменение частоты `kubectl top`;
- частичное обновление одной строки вместо полной таблицы;
- включение resource cache для live-таблиц;
- backend cancellation для прерванного HTTP resource request;
- новая библиотека, state manager или отдельный scheduler.

Эти улучшения рассматриваются только после отдельного измерения оставшейся нагрузки.

## Изменение A — polling только как fallback

### Проверка до изменения

- [x] Renderer contract подтвердил baseline: auto-refresh interval создавался независимо от состояния watch.
- [x] В реализации проверены успешный `startWatch` и открытие WebSocket.
- [x] Ошибка `startWatch`, ошибка подключения WebSocket и последующий `close` сохраняют polling fallback.
- [x] Смена cluster/resource/namespaces выполняет cleanup старого состояния.

### Минимальная реализация

- `useResourceWatch` возвращает признак работоспособного live watch.
- Watch считается работоспособным только когда backend `startWatch` завершился успешно и текущий WebSocket перешёл в `OPEN`.
- При `error`, `close`, cleanup или смене watch identity признак немедленно сбрасывается.
- Auto-refresh effect в `App` не создаёт interval, пока live watch работоспособен.
- Если watch не запустился или соединение разорвано, polling использует текущую пользовательскую настройку `0/10/30/60` секунд.
- Первоначальная загрузка при входе, ручной Refresh и refresh по watch-событию не меняются.

Не добавлять отдельный глобальный watch store: локального boolean-состояния достаточно.

### Контракты

- [ ] Успешный backend watch без открытого WebSocket ещё не отключает polling.
- [ ] Успешный backend watch плюс `WebSocket.OPEN` отключает interval polling.
- [ ] Ошибка или close WebSocket возвращает polling fallback.
- [ ] Ошибка `startWatch` сохраняет polling fallback.
- [ ] Cleanup старого watch не изменяет состояние нового поколения.
- [x] Настройка refresh `0` остаётся отключённой независимо от watch.

## Изменение B — watch без стартовой полной выдачи

### Проверка до изменения

- [x] Gateway contract зафиксировал исходный аргумент `--watch=true` до реализации.
- [x] Подтверждено, что исходная команда могла выдавать стартовый `ADDED` для каждого существующего объекта.
- [x] Использован штатный аргумент kubectl `--watch-only=true` вместе с `--output-watch-events=true`.

### Минимальная реализация

- В `watchArgs()` заменить `--watch=true` на `--watch-only=true`.
- Сохранить `-o json`, `--output-watch-events=true` и текущую namespace-семантику.
- Не фильтровать первые `ADDED` по таймеру или счётчику в renderer: источник не должен присылать initial list.

### Контракты

- [x] Watch command содержит `--watch-only=true` и не содержит `--watch=true`.
- [x] `all`, отдельный namespace и cluster-scoped аргументы сохранены.
- [x] Реальные `ADDED`, `MODIFIED` и `DELETED` продолжают инвалидировать cache и публиковаться в WebSocket.
- [x] Дедупликация одного watch на cluster/resource/namespace сохранена.
- [x] Stop, cluster removal и application shutdown продолжают завершать watch process.

## Изменение C — закреплённые названия столбцов

### Подтверждённый baseline

- На таблице с сотнями pod вертикальная прокрутка происходит внутри `.table-scroll`.
- `<thead>` расположен внутри того же контейнера и сейчас прокручивается вместе с `<tbody>`.
- После прокрутки примерно 20 строк названия столбцов больше не видны, что подтверждено пользовательским скриншотом.
- Ширины столбцов уже общие для header/body через один `<table>`, `<colgroup>` и `table-layout: fixed`.

### Минимальная реализация

- Сделать существующие `.resource-table th` sticky относительно `.table-scroll`: `position: sticky` и `top: 0`.
- Задать header cells непрозрачный theme background и достаточный `z-index`, чтобы строки не просвечивали и не перекрывали заголовки.
- Сохранить текущие column resize/drag/sort controls; sticky `th` остаётся positioning context для `.column-resizer`.
- Не создавать вторую таблицу, cloned header или JavaScript-синхронизацию ширины колонок.
- Применить исправление ко всем resource-таблицам, поскольку они используют общий компонент и scroll-контейнер.

### Контракты

- [x] Renderer/CSS contract подтверждает `position: sticky`, `top: 0`, background и `z-index` у header cells.
- [x] Единственный `<table>` и существующий `<colgroup>` сохраняются.
- [ ] Горизонтальная прокрутка двигает header и body синхронно.
- [ ] Resize, drag-and-drop, sort indicator и select-all checkbox остаются доступными.
- [ ] Header не перекрывается строками в тёмных, светлой и System themes.
- [ ] Empty state и короткие таблицы визуально не меняются.

### Ручной smoke

- [ ] Открыть Pods с количеством строк больше высоты таблицы и прокрутить вниз минимум на 20 строк: названия столбцов остаются сверху.
- [ ] Проверить 710+ pod и переход между страницами.
- [ ] Проверить вертикальную и горизонтальную прокрутку одновременно.
- [ ] Изменить ширину и порядок столбцов после прокрутки.
- [ ] Повторить на Nodes и ещё одной namespaced resource-таблице.

## Ожидаемый результат

При стабильном watch открытие Pods выполняет один первоначальный `get + top`, после чего:

- нет повторной полной загрузки из-за initial watch list;
- нет параллельного 10-секундного polling;
- полный `get + top` выполняется только после реального watch-события или ручного Refresh;
- при недоступном watch автоматически возвращается настроенный polling.

При прокрутке большой таблицы строка названий столбцов остаётся закреплённой у верхней границы `.table-scroll`, сохраняя общую горизонтальную прокрутку и ширины body-ячеек.

## Проверка нагрузки

- [ ] Добавить счётчики вызовов `loadResources` в детерминированный renderer contract.
- [ ] Проверить сценарий `initial load → watch ready → без событий`: повторных загрузок нет дольше одного polling interval.
- [ ] Проверить один burst реальных событий: один debounced refresh.
- [ ] Проверить `watch close → polling fallback`: начинается не более одного interval.
- [ ] На кластере с большим числом pod сравнить число `kubectl get pods` и `kubectl top pods` за одну минуту до/после.
- [ ] Проверить all namespaces и несколько явно выбранных namespaces.

## Regression gate

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer` — 29/29.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway` — 73/73.
- [x] `npm run verify:release` после оформления версии 2.5.1.
- [x] `git diff --check`.
- [ ] Ручной smoke: Pods загружаются, CPU/RAM видны, реальные изменения появляются, ручной Refresh работает.
- [ ] Ручной fallback smoke: остановить watch и убедиться, что polling возобновляется.
- [ ] Ручной table smoke: header остаётся видимым при вертикальной прокрутке и синхронным при горизонтальной.

## Критерии приёмки 2.5.1

- [x] При здоровом watch interval polling таблицы отсутствует по renderer contract.
- [x] Старт watch не запрашивает initial list существующих pod.
- [x] При отказе watch polling разрешён согласно пользовательской настройке.
- [x] Реальные watch-события по-прежнему используют существующий debounced refresh.
- [x] Начальная загрузка, metrics, ручной Refresh и namespace scope не изменены в реализации.
- [ ] Названия столбцов остаются видимыми при прокрутке больших resource-таблиц.
- [ ] Resize, reorder, sort и horizontal scroll столбцов не регрессировали.
- [x] Новые зависимости и новые архитектурные слои не добавлены.
- [ ] Полный автоматический gate и ручной smoke пройдены.
