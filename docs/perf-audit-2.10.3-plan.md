# KubeDeck 2.10.3 — устранение проблем производительности

Статус: план, не реализовано.

## Цель

По итогам 2.10.2 (устранение дублирования) сделан отдельный проход на
производительность — два параллельных агента (backend, renderer) плюс ручная
перепроверка самых весомых находок. В отличие от 2.10.2 здесь есть минимум
один настоящий баг (утечка в `WatchManager`), а не только «лишняя работа».

Все находки ниже проверены чтением кода (агентами и/или мной лично), не
угаданы по названиям функций. Секции идут по убыванию критичности.
Независимы, после каждой — полный gate, не смешивать секции в один коммит.

## Правило для этого патча

Как и в 2.10.2 — документация обновляется в том же коммите, что и код. Если
у секции нет документации для правки, это явно написано в самой секции.

---

## Секция A — `WatchManager` никогда не удаляет завершённые сессии (backend, БАГ)

### Подтверждённая причина

Проверено лично: `sessions.set()` — ровно один раз (`watchManager.ts:268`).
`sessions.delete()` — ровно один раз, только в `catch` вокруг `waitForSpawn`
(строка 274, т.е. только если процесс вообще не запустился). Ни
`child.on("close", …)` (248-263), ни `stopSession()` (365+), ни `stop()`,
`stopAll()`, `stopCluster()` не удаляют запись из `this.sessions` — они
только меняют `status` на `stopped`/`failed`.

`useResourceWatch.ts:69-79` стартует новый watch при каждом переключении
resource-таба/namespace и никогда явно не останавливает предыдущий watch по
id (полагается на смену WebSocket-подписки, а не на `stop`). Это значит, что
за долгую сессию работы с приложением (переключение вкладок, кластеров,
namespace) `this.sessions` растёт без ограничения, каждая запись держит
`outputTail`/`errorTail` массивы и ссылку на мёртвый child process.
`status()` (`GET /watches/status`, строка 315) каждый раз сортирует и
отдаёт весь список — тоже растёт вместе с картой.

### Задачи

- [x] В `stopSession()` (после перевода в `stopped`/`failed` и ожидания
  `closePromise`) удалять сессию из `this.sessions` — но не раньше, чем
  клиент получит финальный статус (проверить, не читает ли что-то ещё
  `sessions.get(id)` после stop — например, финальный `view()` в `stop()`,
  строка 342, должен успеть отработать до удаления). Реализовано:
  `this.sessions.delete(session.id)` добавлен в конец `stopSession()`,
  после `runningByKey.delete(...)` — `stop()`/`stopAll()`/`stopCluster()`
  всё ещё читают финальный `view()` из локальной ссылки на `session`,
  удаление из `Map` на это не влияет.
- [x] В обработчике `child.on("close", …)` (248-263) — если сессия уже была
  помечена `stoppedByUser` или её `stop()` никто не вызовет (процесс упал
  сам), решить: удалять сразу или оставлять до следующего опроса `status()`
  с TTL очистки. Предпочтительно — простой TTL-based sweep (например, при
  каждом вызове `status()` удалять записи в терминальном статусе старше N
  минут), чтобы не ломать сценарий "посмотреть, почему watch упал" сразу
  после падения. Реализовано: `sweepTerminalSessions()` вызывается в начале
  `status()`, удаляет `stopped`/`failed` записи старше
  `WATCH_TERMINAL_RETENTION_SECONDS` (5 минут).
- [x] Проверить `activeCount()` (327) и `status()` (315) — их семантика не
  должна измениться для активных (`running`/`stopping`) сессий, только
  переставшие расти для завершённых. Подтверждено: `activeCount()` не
  тронут, фильтрует только `running`/`stopping`; изменений в его логике нет.

### Контракты

- [x] После остановки нескольких watch подряд `GET /migration/status` и
  `GET /watches/status` не показывают бесконечно растущий список
  завершённых записей.
- [x] `npm --workspace apps/desktop run test:gateway` (`watch.contract.test.cjs`
  и смежные) проходит; добавить тест на то, что после `stop`/`stopAll` и
  последующего TTL/sweep сессия пропадает из `status()`. Добавлены два новых
  теста: "Node WatchManager removes explicitly stopped sessions from
  status() immediately" и "Node WatchManager sweeps crashed sessions from
  status() only after the retention window" (последний с инжектируемыми
  часами `now()`, симулирует падение процесса и продвигает время на 6
  минут). Все 99 тестов `test:gateway` проходят.

### Документация

`docs/security.md`/release notes — не требуется (не security-relevant), но
`CHANGELOG.md` должен явно упомянуть это как **исправление утечки памяти**
при долгих сессиях — единственная секция патча с реальным user-visible
эффектом (стабильность при долгой работе), наравне с Секцией F. Сделано —
см. `CHANGELOG.md`.

---

## Секция B — убрать ненужный `structuredClone` из resource cache (backend)

### Подтверждённая причина

Проверено лично: единственный потребитель `cache.get()`/`cache.set()` —
`routes/resourceLists.ts`, который передаёт результат напрямую в
`writeJson()` (`http.ts:12-18`, делает `JSON.stringify` и всё). Между
чтением из кэша и сериализацией никто ничего не мутирует. Defensive deep
clone в `cloneResponse()` (`cache/resourceSnapshotCache.ts:35-40`), вызываемый
и на `set()` (63), и на **каждый** `get()`-hit (95) — чистые лишние затраты,
оплачиваемые на каждый cache hit при TTL всего 15 секунд.

### Задачи

- [x] Убрать `structuredClone` из `cloneResponse()` — возвращать `value`
  (или мелкий `{...value, items: value.items}` без глубокого клонирования
  элементов) на `set()` и `get()`. Реализовано: `cloneResponse()` удалена
  целиком, `get()` возвращает `{...entry.value, cached: true,
  cacheTtlSeconds}` (мелкий клон верхнего уровня), `set()` возвращает
  `value` напрямую без клонирования элементов `items`.
- [x] Проверить `apps/desktop/tests` на ассерты, полагающиеся на то, что
  вызывающий код может безопасно мутировать возвращённые из кэша объекты
  in-place (не должно быть, но перепроверить перед удалением). Подтверждено:
  единственный вызывающий код (`routes/resourceLists.ts:94-135`) не
  мутирует `rows`/`cached`/`result` после чтения из кэша — использует их
  только для `writeJson()` (сериализация).

### Контракты

- [x] `GET /clusters/:id/resources/:resource` отдаёт тот же JSON, что и до
  изменения — консольный тест на сериализованный ответ, не на identity
  объектов. `resource-lists.contract.test.cjs` (14 тестов, использует
  `assert.deepEqual` на значения, не identity) проходит без изменений.

### Документация

Не требуется — внутренняя оптимизация, HTTP-контракт не меняется.

---

## Секция C — `routes/search.ts` дублирует discovery-запрос вместо переиспользования кэша (backend)

### Подтверждённая причина

Проверено лично: `routes/search.ts:110` гоняет `kubectl api-resources
--verbs=list -o wide` на каждый (debounced 250ms) поисковый запрос.
`routes/resourceDiscoveryEvents.ts` уже кэширует ровно тот же вызов в
module-level `discoveryCache` (TTL 60s, строки 11, 37, 226-238) — `search.ts`
никак не обращается к этому кэшу.

### Задачи

- [x] Вынести `discoveryCache`-логику (`resourceDiscoveryEvents.ts:37,
  226-238, 275, 277`) в общий модуль (например `resources/discoveryCache.ts`),
  либо экспортировать читающую функцию оттуда. Реализовано как
  `resources/apiResourcesCache.ts` (`getApiResourcesOutput`/
  `clearApiResourcesCache`) — кэширует **сырой stdout** `kubectl
  api-resources`, а не распарсенные `ResourceDefinition[]`: обнаружено, что
  `resourceDiscoveryEvents.ts` и `search/searchEngine.ts` имеют два разных
  `parseApiResources()` с разной логикой извлечения `apiGroup` (первый
  оставляет `"apps/v1"` как есть, второй режет на `"apps"` по `/`) — эти два
  парсера были уже раздельными до этого патча и намеренно не унифицированы
  здесь, чтобы не менять поведение CRD-детекции в глобальном поиске.
- [x] `routes/search.ts`'s `discoverResourceDefinitions()` использует общий
  кэш вместо прямого вызова `runner.run(...)`. Реализовано — теперь вызывает
  `getApiResourcesOutput(...)` и парсит результат своим `parseApiResources`
  (без изменений в парсинге).
- [x] Убедиться, что инвалидация кэша (`discoveryCache.delete`/`.clear()`,
  строки 275/277 — вероятно на смену/удаление кластера) по-прежнему
  затрагивает оба потребителя. `resourceDiscoveryEvents.ts`'s
  `clearResourceDefinitionCache` (используется в `gateway.ts` при
  удалении/обновлении кластера) теперь — тонкая обёртка над
  `clearApiResourcesCache`, тем же примитивом, который читает `search.ts` —
  один источник правды на оба потребителя.

### Контракты

- [x] Глобальный поиск и просмотр CRD/discovery продолжают видеть новые
  CRD в течение 60 секунд после их появления (тот же TTL, что и раньше у
  `resourceDiscoveryEvents.ts`) — не длиннее и не короче для обоих путей.
  TTL не менялся (`API_RESOURCES_CACHE_TTL_MS = 60_000` в новом модуле).
  Добавлен тест "Global Search reuses the shared api-resources discovery
  cache across calls" (`search.contract.test.cjs`), проверяющий: (1) второй
  `buildSearchResponse()` для того же кластера не делает повторный
  `runner.run()` (переиспользует кэш); (2) `clearApiResourcesCache(clusterId)`
  — тот же примитив, к которому делегирует `clearResourceDefinitionCache` —
  форсирует новый discovery-запрос. Все 10 тестов `search.contract.test.cjs`
  и `resource-discovery-events.contract.test.cjs` проходят; полный
  `test:gateway` (100 тестов) проходит.

### Документация

Не требуется.

---

## Секция D — N+1 kubectl-вызовов на каждый poll обзора кластера (backend)

### Подтверждённая причина

`resources/metrics.ts` `applyNodeDiskMetrics()` (123-137) на каждый вызов
`routes/overview.ts` (строка 46, без кэширования) делает по одному
`kubectl get --raw=.../proxy/stats/summary` **на каждую ноду**
(concurrency-limited до 6). Overview-панель поллит каждые
`refreshIntervalSeconds` (по умолчанию 10s). Для кластера с N нодами — N
дополнительных kubectl-подпроцессов каждые 10 секунд только ради диска в
donut-диаграмме capacity.

### Задачи

- [x] Завести короткий TTL-кэш (например 30-60s, по аналогии с
  `resourceSnapshotCache`/`discoveryCache`) для disk-metrics по ноде в
  `resources/metrics.ts` или на уровне `routes/overview.ts`. Реализовано в
  `resources/metrics.ts`: `nodeDiskCache` (30s TTL), ключ
  `clusterId + nodeName`, читается/пишется в `loadNodeDiskMetrics()`. Кэш
  общий для обоих потребителей — `applyNodeDiskMetrics()` (bulk-путь из
  `routes/overview.ts`) и прямого вызова `loadNodeDiskMetrics()` из
  `routes/resourceDetails.ts` (`operation === "metrics"`, срабатывает при
  развороте диска конкретной ноды в UI) — второй теперь тоже получает
  выгоду от кэша, если попадает в то же окно, что и последний overview-poll.
  Добавлен `clearNodeDiskMetricsCache(clusterId?)`, подключён в
  `gateway.ts` рядом с `clearResourceDefinitionCache`/`resourceCache.clear`
  при удалении кластера — иначе кэш держал бы записи per-node вечно после
  удаления кластера.
- [x] Не кэшировать дольше, чем имеет смысл для "живого" отображения
  capacity — согласовать TTL с ожиданиями UI (сейчас обновляется каждые
  10s, кэш не должен делать эти обновления бессмысленными). Выбран TTL 30s
  (3 × стандартный 10s poll-интервал) — заметно сокращает число
  kubectl-подпроцессов, но capacity всё ещё обновляется несколько раз в
  минуту, а не раз в час.

### Контракты

- [x] Capacity-панель по-прежнему обновляет disk usage при развороте
  дискового пространства ноды, просто не чаще TTL. Добавлены тесты в
  `resource-lists.contract.test.cjs`: "node disk metrics are cached per
  node for a TTL, then refetched, and can be cleared" (с инжектируемыми
  часами — проверяет hit/miss/expiry/clear) и "applyNodeDiskMetrics reuses
  the per-node cache across a bulk overview poll" (второй poll в течение
  TTL не делает новых kubectl-вызовов). Полный `test:gateway` (102 теста)
  проходит.

### Документация

Не требуется.

---

## Секция E — `Set` пересобирается на каждый под в цикле селектора (backend)

### Подтверждённая причина

`routes/deploymentLogs.ts` `matchingDeploymentPods()` (111-138) для каждого
пода в namespace вызывает `selectorMatches()` (74-97), которая для каждого
`matchExpression` делает `new Set(expression.values.map(...))` (строка 86) —
пересобирает идентичный (loop-invariant относительно списка подов) Set на
**каждый** под. N подов × M matchExpressions лишних аллокаций на каждое
открытие Logs для deployment.

### Задачи

- [x] Вынести построение `Set` из `matchExpressions` селектора наружу цикла
  по подам (посчитать один раз в `matchingDeploymentPods()`, передать
  готовую структуру в `selectorMatches()` или инлайнить один проход).
  Реализовано: новый `compileSelector()` строит `matchLabels` +
  `matchExpressions`-с-предпостроенными-`Set` **один раз**;
  `matchesCompiledSelector()` использует готовую структуру внутри цикла по
  подам в `matchingDeploymentPods()`. Публичный `selectorMatches()` остался
  с прежней сигнатурой/поведением (тонкая обёртка: `compileSelector` +
  `matchesCompiledSelector` за один вызов) — используется как раньше в
  юнит-тестах.

### Контракты

- [x] `matchingDeploymentPods`/`selectorMatches` дают тот же список подов
  для тех же входных данных — юнит-тест на `In`/`NotIn`/`Exists`/
  `DoesNotExist` сценарии до и после. Добавлен тест "selector matching
  covers In, NotIn, Exists and DoesNotExist across many pods" со всеми 4
  операторами в одном селекторе и 6 подами (2 проходят, 4 отсеиваются по
  разным причинам) — `deployment-logs.contract.test.cjs` (3 теста), полный
  `test:gateway` (103 теста) проходят.

### Документация

Не требуется.

---

## Секция F — O(n²) фильтр выбранных строк в таблице ресурсов (renderer)

### Подтверждённая причина

`hooks/useResourceTableState.ts:164`:
```js
useEffect(() => setSelected((current) => new Set(Array.from(current).filter((key) => new Set(rows.map(rowKey)).has(key)))), [rows]);
```
`new Set(rows.map(rowKey))` пересобирается **внутри** `.filter()` — на
каждый элемент `current`. O(selected × rows) вместо O(rows + selected).
Срабатывает на каждое обновление `rows` (каждый poll/watch-рефреш) при
активном выборе строк.

Дополнительно там же (194-195): `selectedRows`/`selectedPageRows` считаются
в теле хука (не в `useMemo`) и пересчитываются на **каждый** рендер —
`ResourceTable` тикает раз в секунду через `useUiClock` для отображения
возраста ресурсов (`ResourceTable.tsx:130-133`), так что это полное
сканирование `visibleRows`/`renderedRows` происходит раз в секунду
независимо от того, менялись ли данные.

### Задачи

- [x] `useResourceTableState.ts:164` — вынести `new Set(rows.map(rowKey))`
  один раз перед `.filter()`. Реализовано.
- [x] Обернуть `selectedRows`/`selectedPageRows` (194-195) в `useMemo` с
  зависимостями `[visibleRows, renderedRows, selected]`, чтобы ежесекундный
  `useUiClock`-тик не пересчитывал их без реальных изменений данных/выбора.
  Реализовано с более точными зависимостями, чем в плане:
  `selectedRows` → `[visibleRows, selected]`, `selectedPageRows` →
  `[renderedRows, selected]` (каждый мемо зависит только от того, что
  реально использует — иначе `selectedRows` пересчитывался бы при смене
  страницы, хотя `visibleRows`/`selected` не менялись). Дополнительно
  обнаружено и исправлено: `renderedRows = visibleRows.slice(...)` сам не
  был мемоизирован — каждый рендер создавал новый массив, что свело бы на
  нет мемоизацию `selectedPageRows` (зависящую от identity `renderedRows`).
  Обёрнут в `useMemo(() => visibleRows.slice(pageStart, pageStart +
  pageSize), [visibleRows, pageStart, pageSize])`.

### Контракты

- [x] Поведение bulk-выбора (checkbox "select all on page", снятие выбора
  при исчезновении строки из `rows`) не меняется — только не пересчитывается
  зря. Хук использует stubbed `useEffect`/`useState` в тестовом харнессе
  `loadTypeScript` (`renderer-controllers.contract.test.cjs`) — они не
  выполняются, так что полноценный behavioral-тест через этот харнесс
  невозможен для этого файла (существующий паттерн для таких хуков в этом
  файле — структурные regex-проверки на исходный код). Добавлен тест
  "resource table selection pruning and derived row lists avoid O(n^2) and
  re-render churn", подтверждающий: анти-паттерн `new Set(rows.map(rowKey))`
  внутри `.filter()` отсутствует, `rowKeys` вычисляется один раз, и все три
  производных списка (`renderedRows`/`selectedRows`/`selectedPageRows`)
  обёрнуты в `useMemo` с ожидаемыми зависимостями. Полный `test:renderer`
  (52 теста) и `test:gateway` (103 теста, не затронуты) проходят.

### Документация

CHANGELOG — упомянуть вместе с Секцией A как "performance/stability fixes",
без деталей реализации.

---

## Секция G — немемоизированные тяжёлые вычисления в renderer (renderer)

### Подтверждённая причина

Четыре независимых, но однотипных находки — вычисление, которое должно быть
`useMemo`, выполняется в теле компонента на каждый рендер:

- `App.tsx:487` — `buildResourceTableColumns(t)` вызывается заново на каждый
  рендер `App` (включая каждую печатаемую букву в global search, т.к.
  `useGlobalSearch`'s `query` живёт в `App()` напрямую) и передаёт новый
  `columns` reference вниз, что инвалидирует `visibleRows`-memo в
  `useResourceTableState.ts:166-186` (там `columns` — часть dependency array)
  — полный re-filter+re-sort текущей таблицы при вводе в поиск, даже если
  таблица не видна/не менялась.
- `components/YamlTab.tsx:344-353` `countMatches()` — `text.toLowerCase()` и
  `query.toLowerCase()` пересчитываются на каждой итерации `while`-цикла
  вместо одного раза до цикла; вызывается прямо в теле компонента (строка
  ~53), пересчитывается на каждый рендер `YamlTab`, не только на изменение
  `yamlQuery`/`yamlDraft`.
- `components/ManifestCompare.tsx:240-255` — `cleanManifest`
  (YAML parse+sort+stringify) и `buildManifestDiff` (`diffLines`) выполняются
  безусловно в теле рендера, не в `useMemo`; любой локальный state (например
  `toggleFold`/`setCollapsed`, 256-262) триггерит полный re-parse+re-diff
  обоих манифестов.
- `components/LogsTab.tsx:73-76` — `content.split("\n")` +
  `.filter(...includes...)` + `.join("\n")` выполняются на каждый рендер, не
  в `useMemo`, независимо от того, менялись ли `content`/`query`.

### Задачи

- [x] `App.tsx` — обернуть `tableColumns` в `useMemo(() =>
  buildResourceTableColumns(t), [t])` (t меняется только при смене языка).
  Реализовано.
- [x] `YamlTab.tsx` — вынести `text.toLowerCase()`/`query.toLowerCase()` из
  цикла в `countMatches`; обернуть вызов `countMatches(...)` в `useMemo` по
  `[yamlDraft, yamlQuery]` (или что там реально входит). Реализовано —
  `countMatches` теперь считает `lowerText`/`lowerQuery` один раз до
  `while`-цикла; вызов обёрнут в `useMemo` с зависимостями
  `[yamlDraft, yamlQuery]`.
- [x] `ManifestCompare.tsx` — обернуть `cleanManifest`+`buildManifestDiff`
  результат (переменная `rows`) в `useMemo` по фактическим входам (`left`,
  `right`, `raw`), не пересчитывать на fold/collapse-изменения. Реализовано
  как единый `useMemo` возвращающий `{ left, right, rows, renderError }` с
  зависимостями `[currentYaml, targetYaml, raw, error]` (реальные примитивные
  входы — `left`/`right`/`rows` раньше были производными от них, но
  `rows` пересобирался как новый массив на каждый рендер, что уже
  обесценивало downstream `useMemo(foldRanges)`/`useMemo(displayedRows)`,
  зависящие от `rows` по identity — теперь и они получают пользу от фикса).
- [x] `LogsTab.tsx` — обернуть `lines`/`visibleLines`/`visibleText` в
  `useMemo` по `[content, normalizedQuery]`. Реализовано.

### Контракты

- [x] Ни одно из четырёх мест не меняет видимый результат — только частоту
  пересчёта. Renderer-тесты (`renderer-controllers.contract.test.cjs`)
  проходят без изменений в ассертах, если они не читают конкретные строки
  внутри этих функций текстом (проверить и обновить при необходимости — по
  той же процедуре, что в 2.10.2). Добавлен новый тест "resource table
  columns, YAML match count, manifest diff and log filtering are memoized",
  подтверждающий все 4 места структурно (полное поведенческое тестирование
  через `loadTypeScript`-харнесс невозможно для JSX-компонентов — тот же
  ограничение, что и в Секции F). Существующий тест "manifest compare marks
  equal, changed, added, and removed lines" (проверяет `buildManifestDiff`
  напрямую как чистую функцию) не затронут — сама функция не менялась,
  изменился только её call site. Полный `test:renderer` (53 теста) и
  `test:gateway` (103 теста, не затронуты) проходят.

### Документация

Не требуется — user-visible эффект (отзывчивость UI), не функциональность;
уже покрыт общей CHANGELOG-записью патча.

---

## Не входит в патч (nice-to-have / отдельная задача)

- `routes/resourceDiscoveryEvents.ts:243-271` — `writeResourceEvents()`
  тянет **все** события namespace/кластера (`kubectl get events -A -o json`,
  без `--field-selector`) и фильтрует на стороне сервера под один ресурс.
  Низкий приоритет — вызывается один раз при открытии resource-details
  drawer, не поллится.
- `PAGE_SIZE_OPTIONS` до 2000 без виртуализации DOM в `ResourceTable.tsx` —
  реальный риск только если пользователь сам выберет большой page size
  (дефолт 200). Добавление виртуализации (react-window или аналог) — это
  новая зависимость и архитектурное решение, не однострочный фикс;
  отдельный патч, если вообще понадобится.

## Release sync 2.10.3

- [x] Версия `2.10.3` в `package.json`, `apps/desktop/package.json` (и
  `@kubedeck/shared-types`), `packages/shared-types/package.json`,
  пересобрать `package-lock.json`.
- [x] `CHANGELOG.md` — запись 2.10.3: Секция A (утечка watch-сессий) и
  Секция F (лишние пересчёты в таблице) как user-visible fixes
  (стабильность/отзывчивость при долгой работе); остальное — internal
  performance cleanup.
- [x] `docs/releases/RELEASE_NOTES_2.10.3.md` и
  `docs/releases/REGRESSION_CHECKLIST_2.10.3.md` по образцу 2.10.2.
- [x] README.md/README.ru.md — версия и ссылки на release notes/checklist.
- [x] `NODE_MIGRATION_PROGRESS.md` — короткая запись про 2.10.3.
- [x] `docs/third-party-notices.md` — версия в шапке.

## Автоматический gate

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (53 теста)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway` (103 теста)
- [x] `npm run verify:release`
- [ ] Ручная проверка: запустить приложение, несколько раз переключить
  resource-таб/namespace (создать несколько watch-сессий), остановить их,
  убедиться через `GET /watches/status`, что список не растёт бесконечно
  (Секция A — единственная секция, которую стоит проверить вручную, а не
  только автотестами, т.к. это утечка, проявляющаяся со временем).
  **Не выполнено** — решено закрыть без ручной проверки: приложение
  требует реального kubeconfig/кластера для запуска, недоступного в этой
  среде; поведение покрыто только автотестами
  (`watch.contract.test.cjs`, включая тест с инжектируемыми часами,
  симулирующий TTL-sweep). Отражено честно в
  `docs/releases/REGRESSION_CHECKLIST_2.10.3.md` как невыполненный пункт,
  а не помечено выполненным.

## Критерий завершения

`WatchManager` не накапливает завершённые сессии бесконечно. Resource-кэш не
делает лишний `structuredClone`. `search.ts` переиспользует
`discoveryCache` вместо дублирования kubectl-вызова. Overview не делает N
лишних kubectl-вызовов на нодах каждые 10 секунд без кэша. Выбор строк в
таблице ресурсов — O(rows), не O(selected × rows), и не пересчитывается
каждую секунду от тика часов. `App.tsx`, `YamlTab.tsx`, `ManifestCompare.tsx`,
`LogsTab.tsx` не выполняют тяжёлые вычисления повторно на каждый
несвязанный рендер. Версия и release-документы синхронизированы на 2.10.3.
Полный gate зелёный.
