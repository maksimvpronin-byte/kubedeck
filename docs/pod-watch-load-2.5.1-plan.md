# KubeDeck 2.5.1 — план снижения нагрузки вкладки Pods

Статус: план подготовлен, реализация не начата.

## Цель

Убрать два подтверждённых источника повторных полных загрузок Pods:

1. Не запускать периодический polling таблицы, пока backend watch работает и его WebSocket-соединение доступно.
2. Не получать стартовый поток `ADDED` для всех уже существующих pod при запуске watch.

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

- [ ] Renderer contract подтверждает baseline: auto-refresh interval создаётся независимо от состояния watch.
- [ ] Проверить успешный `startWatch` и открытие WebSocket.
- [ ] Проверить ошибку `startWatch`, ошибку подключения WebSocket и последующий `close`.
- [ ] Проверить смену cluster/resource/namespaces и cleanup старого состояния.

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
- [ ] Настройка refresh `0` остаётся отключённой независимо от watch.

## Изменение B — watch без стартовой полной выдачи

### Проверка до изменения

- [ ] Gateway contract фиксирует текущий аргумент `--watch=true`.
- [ ] Подтвердить, что текущая команда может выдавать стартовый `ADDED` для каждого существующего объекта.
- [ ] Проверить поддержку `kubectl get --watch-only=true --output-watch-events=true` принятой версией kubectl.

### Минимальная реализация

- В `watchArgs()` заменить `--watch=true` на `--watch-only=true`.
- Сохранить `-o json`, `--output-watch-events=true` и текущую namespace-семантику.
- Не фильтровать первые `ADDED` по таймеру или счётчику в renderer: источник не должен присылать initial list.

### Контракты

- [ ] Watch command содержит `--watch-only=true` и не содержит `--watch=true`.
- [ ] `all`, отдельный namespace и cluster-scoped аргументы сохранены.
- [ ] Реальные `ADDED`, `MODIFIED` и `DELETED` продолжают инвалидировать cache и публиковаться в WebSocket.
- [ ] Дедупликация одного watch на cluster/resource/namespace сохранена.
- [ ] Stop, cluster removal и application shutdown продолжают завершать watch process.

## Ожидаемый результат

При стабильном watch открытие Pods выполняет один первоначальный `get + top`, после чего:

- нет повторной полной загрузки из-за initial watch list;
- нет параллельного 10-секундного polling;
- полный `get + top` выполняется только после реального watch-события или ручного Refresh;
- при недоступном watch автоматически возвращается настроенный polling.

## Проверка нагрузки

- [ ] Добавить счётчики вызовов `loadResources` в детерминированный renderer contract.
- [ ] Проверить сценарий `initial load → watch ready → без событий`: повторных загрузок нет дольше одного polling interval.
- [ ] Проверить один burst реальных событий: один debounced refresh.
- [ ] Проверить `watch close → polling fallback`: начинается не более одного interval.
- [ ] На кластере с большим числом pod сравнить число `kubectl get pods` и `kubectl top pods` за одну минуту до/после.
- [ ] Проверить all namespaces и несколько явно выбранных namespaces.

## Regression gate

- [ ] `npm run lint`.
- [ ] `npm run format:check`.
- [ ] `npm run test:renderer`.
- [ ] `npm run typecheck`.
- [ ] `npm run build`.
- [ ] `npm --workspace apps/desktop run test:gateway`.
- [ ] `npm run verify:release` после оформления версии 2.5.1.
- [ ] `git diff --check`.
- [ ] Ручной smoke: Pods загружаются, CPU/RAM видны, реальные изменения появляются, ручной Refresh работает.
- [ ] Ручной fallback smoke: остановить watch и убедиться, что polling возобновляется.

## Критерии приёмки 2.5.1

- [ ] При здоровом watch interval polling таблицы отсутствует.
- [ ] Старт watch не вызывает refresh на каждый существующий pod.
- [ ] При отказе watch данные продолжают обновляться через polling.
- [ ] Реальные watch-события по-прежнему вызывают один debounced refresh.
- [ ] Начальная загрузка, metrics, ручной Refresh и namespace scope не изменены.
- [ ] Новые зависимости и новые архитектурные слои не добавлены.
- [ ] Полный автоматический gate и ручной smoke пройдены.
