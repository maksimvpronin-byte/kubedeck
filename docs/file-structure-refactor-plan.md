# KubeDeck — разделение крупных файлов и снятие структурного долга

Статус: план принят, не начат.

## Контекст

Аудит размеров всей кодовой базы (2.20.0):

```
192 TS/TSX файла · 32 696 строк · в среднем 170 строк/файл
>500 строк: 12 файлов
300–500:    22
150–300:    43
<150:      115   ← 60% кодовой базы
```

Продукт **не страдает от god-файлов**. Декомпозиция уже делалась осознанно:
27 отдельных роут-файлов в `main/backend/routes/`, 19 hooks, 56 компонентов,
доменные папки в backend, следы прошлых расщеплений (`usePodDrawerLogs`,
`usePodDrawerYamlActions`, `PodDrawerChrome`, `PodDrawerModals`,
`resources/quantity.ts` из 2.10.2).

Большого рефакторинга не требуется. Программа закрывает пять файлов с явными
швами и — важнее — две проблемы **вне исходников**, которые дороже любого
длинного `.ts`: постоянный слой CSS-«хотфиксов» и тестовую свалку на 2581 строку.

## Правила программы

- Секции независимы, порядок — по убыванию отдачи. **Секции A–C дают ~80%
  пользы**, D–G — приятно, но не горит.
- Каждая секция — **отдельный релиз** (свой patch-bump, CHANGELOG, release
  notes, regression checklist — см. `docs/release-checklist.md` и
  `release-contract.json`). Не смешивать секции в один коммит.
- Ни одна секция не меняет пользовательское поведение. Если по ходу работы
  выясняется, что меняет — это отдельная запись в CHANGELOG и явный пункт
  в regression checklist.
- Документация правится в том же коммите, что и код. Если секции нечего
  править — это написано в самой секции явно.
- После каждой секции — полный gate (см. блок «Автоматический gate» внизу).
- Предполагаемые номера версий указаны ориентировочно; если между секциями
  выйдет bugfix, номера сдвигаются.

---

## Секция A — `normalizers.ts` → папка с barrel

Предполагаемая версия: 2.20.1. **Первая по очереди: нулевой риск, максимальный
эффект.**

### Подтверждённая причина

`main/backend/resources/normalizers.ts` — 926 строк, 25 экспортов. По сути это
~20 независимых функций `xxxSummary(item)`, по одной на семейство ресурсов,
сваленных в один файл. Наружу при этом используется всего два имени:

- `normalizeResourceItems` — 4 импортёра (`routes/overview.ts`,
  `routes/problems.ts`, `routes/resourceLists.ts`, `search/searchEngine.ts`)
- тип `ResourceRow` — `cache/resourceSnapshotCache.ts`, `resources/metrics.ts`

Всё остальное (`podSummary`, `nodeSummary`, `serviceSummary`, …) — внутренняя
кухня одного файла. Функции чистые, состояния нет, семейства ресурсов между
собой не пересекаются. Классический кандидат на расщепление.

### Целевая структура

```
resources/normalizers/
  index.ts        ← barrel: normalizeResourceItems, normalizerForResource,
                    re-export типов. Путь импорта у всех 6 потребителей
                    НЕ меняется ("../resources/normalizers").
  primitives.ts   ← isRecord, record, records, strings, text, numberValue, meta
  node.ts         ← nodeRoles, nodeAnnotationItems, nodeLabelItems, nodeSummary,
                    NODE_ROLE_PREFIX, NODE_LABEL_ALIASES, HIDDEN_NODE_ANNOTATIONS,
                    formatBytesQuantity
  pod.ts          ← podSummary, podRestartDiagnostics, containerStateSummary,
                    firstRestartDiagnosticValue, formatContainerPorts,
                    containerResource, effectivePodResource
  workload.ts     ← deploymentSummary, jobSummary, workloadConditionItems,
                    WORKLOAD_CONDITION_PRIORITY
  network.ts      ← serviceSummary, ingressSummary, servicePortItems,
                    loadBalancerAddresses, serviceNameFromBackend,
                    ingressBackendServices
  rbac.ts         ← serviceAccountSummary, roleSummary, roleBindingSummary,
                    formatSubjects, formatPolicyRules
  misc.ts         ← storageSummary, crdSummary, eventSummary, keyValueSummary,
                    resourceQuotaSummary, genericSummary
```

Две правки к первоначальной раскладке, сделанные при реализации:
`containerResource`/`effectivePodResource` ушли в `pod.ts`, а не в
`primitives.ts` (их единственный потребитель — `podSummary`, и только они тянут
зависимость на `quantity.ts`); `formatBytesQuantity` ушёл в `node.ts`, а не в
`misc.ts`, по той же причине — его зовёт только `nodeSummary`.

### Задачи

- [x] Создать `resources/normalizers/` и перенести функции по семьям строго
  копированием, без правки тел. Любая правка логики — отдельным коммитом
  после того, как перенос стал зелёным.
- [x] `index.ts` реэкспортирует ровно тот публичный набор, что и сегодня
  (25 функций + 2 типа + 4 интерфейса), чтобы
  `import { … } from "../resources/normalizers"` не пришлось трогать ни в
  одном файле.
- [x] Удалить старый `resources/normalizers.ts`.
- [x] Проверить `grep -rn "resources/normalizers" apps/desktop/src apps/desktop/tests`
  — ни один путь в `src/` не изменился.
- [x] **Найдено при реализации:** `tests/resource-lists.contract.test.cjs`
  требовал `dist/main/backend/resources/normalizers.js` напрямую и
  деструктурировал из него `podSummary`, `nodeSummary`, `keyValueSummary`,
  `deploymentSummary`, `nodeLabelItems`, `nodeRoles`, `nodeAnnotationItems`.
  Путь переписан на `normalizers/index.js`; сам набор импортируемых имён не
  менялся.
- [x] **Найдено при реализации:** `tsc` не чистит `dist/`, поэтому старый
  `dist/main/backend/resources/normalizers.js` остаётся на диске и по правилам
  разрешения CJS побеждает каталог `normalizers/`. Удалён вручную; на чистой
  сборке проблемы нет, но при локальной проверке это надо помнить.
- [x] `docs/architecture.md` — обновить описание слоя нормализации ресурсов.

### Критерий секции

Ни один файл в `resources/normalizers/` не длиннее 250 строк (факт: максимум —
`pod.ts`, 216). Импорты у потребителей в `src/` не изменились ни в одной
строке. `tests/resource-lists.contract.test.cjs` и
`tests/search.contract.test.cjs` зелёные.

**Статус: выполнено, выпущено как 2.20.1.**

---

## Секция B — схлопнуть слой CSS-«хотфиксов»

Предполагаемая версия: 2.20.2. **Самый дорогой источник трения в UI-работе.**

### Подтверждённая причина

```
drawer-controls-polish.css     677 строк   139 !important   /* KubeDeck 1.0.5 sort indicator hotfix */
related-panel-polish.css       654 строки  228 !important   /* KubeDeck 1.1.1 related tab hotfix */
resource-summary-polish.css    516 строк     0 !important   /* KubeDeck 1.0.5 summary layout polish hotfix */
                             ─────────────────────────────
                              1847 строк   367 !important
```

Продукт на 2.20.0, а это временные заплатки версий **1.0.5 и 1.1.1**, ставшие
постоянным слоем переопределений. Для сравнения: во всех остальных 15
CSS-файлах вместе взятых — 39 `!important`.

Отдельный симптом: `related-panel.css` — 27 строк, `related-panel-polish.css` —
654. «Полировка» в 24 раза больше базы.

Практическое следствие: любое изменение стилей дровера, related-панели или
resource summary требует угадывания, какой из двух файлов победит, и почти
всегда решается добавлением ещё одного `!important`.

### Задачи

- [ ] `resource-summary-polish.css` (0 `!important`) — самый безопасный,
  делать первым: слить в базовый файл resource summary, проверить, что
  каскад не изменился.
- [ ] `drawer-controls-polish.css` → влить в `drawer.css`; каждое правило
  снимать с `!important`, если после слияния оно и так побеждает по
  специфичности. Оставшиеся `!important` — только те, что реально нужны,
  с комментарием «почему».
- [ ] `related-panel-polish.css` + `related-panel.css` → один `related-panel.css`
  (228 `!important` — самая тяжёлая часть, делать последней).
- [ ] Обновить импорты CSS в точке входа renderer.
- [ ] Регрессия — ручная, обязательна и должна попасть в
  `REGRESSION_CHECKLIST_{version}.md`: дровер (все вкладки, sort-индикаторы
  таблицы), Related-вкладка, Resource Summary — **на каждой из 8 тем**
  (`system, light, midnight, nord, forest, plum, mocha, graphite`).
- [ ] Проверить `tests/renderer-controllers.contract.test.cjs` — часть тестов
  грепает имена CSS-классов, они могут потребовать правки путей к файлам.

### Критерий секции

Ни одного файла с суффиксом `-polish` в `renderer/styles/`. Суммарное число
`!important` по всей папке — меньше 60, и каждый оставшийся снабжён
комментарием. Визуально ничего не изменилось ни на одной из 8 тем.

---

## Секция C — разбить `renderer-controllers.contract.test.cjs`

Предполагаемая версия: 2.20.3.

### Подтверждённая причина

`apps/desktop/tests/renderer-controllers.contract.test.cjs` — **2581 строка,
93 теста, 189 вызовов `readFileSync`**. Самый большой файл в репозитории.

Это свалка регрессий: в одном файле лежат темы, namespace-селектор, manifest
compare, SSH, кластерный rail, пагинация, коалесценция watch-событий,
bulk-действия, workspace-табы, drawer lifecycle, async action feedback.

189 `readFileSync` означает, что большинство тестов **грепает текст
исходников**, а не проверяет поведение. Такой тест ломается от переименования
CSS-класса и молча проходит при настоящей поломке логики. Разбиение — это ещё
и аудит: станет видно, какие из 93 проверок реальные контракты, а какие —
окаменевший grep.

### Целевая структура

По образцу уже существующих доменных файлов (`watch.contract.test.cjs`,
`problems.contract.test.cjs`, `search.contract.test.cjs`):

```
tests/theme.contract.test.cjs                ← темы, токены, data-атрибуты
tests/namespace-selection.contract.test.cjs  ← селектор, recent, per-cluster изоляция
tests/resource-table.contract.test.cjs       ← колонки, сортировка, пагинация, usage-ячейки
tests/workspace-tabs.contract.test.cjs       ← табы, dedup, лимит, закрытие
tests/bulk-actions.contract.test.cjs         ← bulk delete/actions, привязка к кластеру
tests/drawer-lifecycle.contract.test.cjs     ← generations, auto-refresh, dirty state
tests/renderer-controllers.contract.test.cjs ← остаток: cluster controller, navigation,
                                                async feedback, resource loading
```

### Задачи

- [ ] Перенести тесты по доменам без изменения тел утверждений.
- [ ] Вынести общие хелперы (чтение исходника, парсинг) в
  `tests/helpers/sourceText.cjs`, чтобы 189 `readFileSync` не размножились
  по семи файлам.
- [ ] Пройтись по каждому перенесённому тесту и **пометить** комментарием
  `// grep-контракт:` те, что проверяют текст исходника, а не поведение.
  Не переписывать сейчас — только пометить, чтобы был список на будущее.
- [ ] Сверить, что суммарное число тестов после разбиения = 93 (ни один не
  потерян и не продублирован).
- [ ] Проверить, что `npm run test:renderer` подхватывает новые файлы
  (глоб/скрипт в `apps/desktop/package.json`).
- [ ] Документация: не требуется, поведение не меняется.

### Критерий секции

Ни один тестовый файл не длиннее 700 строк. `npm run test:renderer` даёт то же
число прошедших тестов, что и до разбиения. Список grep-контрактов зафиксирован
в комментариях и пригоден для отдельного патча по замене на поведенческие
проверки.

---

## Секция D — `App.tsx`: `<AppSidebar>` + `<AppSectionRouter>`

Предполагаемая версия: 2.20.4.

### Подтверждённая причина

`renderer/App.tsx` — 1028 строк. Логика уже вынесена в 13 hooks, это хорошо.
Осталось два блока:

- строки **85–611** — тело `App()`: ~525 строк оркестрации между hooks
- строки **612–1028** — один JSX-возврат на 416 строк, внутри которого два
  независимых куска:
  - дерево сайдбара: `sections.map` + CRD-группы + вложенные ресурсы (~140 строк)
  - цепочка `section === "overview" / "help" / "about" / "settings" /
    "problems" / "port-forwards" / placeholder` с обёртками `LazySurface`
    (~120 строк)

Оба куска не читают ничего, кроме уже вычисленных значений — извлекаются
механически, без изменения логики.

### Задачи

- [ ] `components/AppSidebar.tsx` — дерево навигации: `sections.map`,
  `expandedSections`, `expandedCrdGroups`, группировка CRD. Props — явные,
  без прокидывания всего состояния App.
- [ ] `components/AppSectionRouter.tsx` — цепочка `section === …` вместе с
  `LazySurface` и lazy-импортами панелей (`AboutPanel`, `OverviewPanel`,
  `HelpPanel`, `PortForwardsPanel`, `ProblemsPanel`, `SettingsPanel`).
- [ ] Проверить, что code-splitting не сломался: lazy-импорты должны остаться
  в модуле роутера, а не подтянуться в основной бандл. Сверить размеры чанков
  до/после `npm run build`.
- [ ] `App.tsx` после секции — не длиннее 700 строк.
- [ ] `docs/architecture.md` — обновить схему renderer.

### Критерий секции

`App.tsx` ≤ 700 строк, его `return` умещается в один экран логики: rail,
sidebar, router, table, drawer, terminal, palette. Размер основного бандла не
вырос.

---

## Секция E — `PodDrawer.tsx`: `usePodDrawerLlm` + `<PodDrawerTabBody>`

Предполагаемая версия: 2.20.5.

### Подтверждённая причина

`renderer/components/PodDrawer.tsx` — 551 строка, **17 `useState` и ни одного
локального хелпера**. Из них 7 подряд (строки 95–101) — чистое состояние
LLM-вкладки:

```
llmLoading, llmError, llmAnswer, llmModel, llmElapsedMs, llmContextChars, llmTruncated
```

Рядом уже лежат `usePodDrawerLogs`, `usePodDrawerYamlActions`,
`usePodDrawerResourceLifecycle` — шов очевиден и просто повторяет существующий
паттерн. Плюс строки ~380–551 — цепочка `tab === "summary" / "llm" / "logs" /
"yaml" / …`, которая ничего не знает о состоянии дровера сверх переданных props.

### Задачи

- [ ] `hooks/usePodDrawerLlm.ts` — 7 состояний + обработчик запроса к LLM,
  по образцу `usePodDrawerLogs`.
- [ ] `components/PodDrawerTabBody.tsx` — цепочка `tab === …` вместе с
  CRD-нотисами.
- [ ] Проверить, что число `useState` в `PodDrawer.tsx` упало до ≤ 10.
- [ ] `tests/llm.contract.test.cjs` — сверить, что контракт «renderer никогда
  не отправляет логи в LLM» по-прежнему проверяется и указывает на новый файл
  hook'а, если тест грепает исходник.
- [ ] Документация: не требуется, поведение не меняется.

### Критерий секции

`PodDrawer.tsx` ≤ 320 строк. Состояние LLM живёт в hook'е и нигде больше.

---

## Секция F — ячейки `ResourceTable` и модель `ProblemsPanel`

Предполагаемая версия: 2.20.6.

### Подтверждённая причина

Оба файла — «компонент плюс все его ячейки/подпанели в том же файле».

- `ResourceTable.tsx` — 629 строк. Строки **333–629** (ровно половина) —
  ячейки и форматтеры: `AgeCell`, `PodUsageBar`, `NodeResourceUsage`,
  `NamespaceResourceUsage`, `PodResourceUsage`, `WorkloadConditions`,
  `renderContainerStatus`, `normalizeContainerStatusItems`, `containerTone`,
  `rowHealthReason`. Ни одна не нужна снаружи таблицы.
- `ProblemsPanel.tsx` — 578 строк: 5 суб-компонентов (строки 236–447) и ~12
  чистых функций классификации (строки 455–579) — `problemCategory`,
  `summarizeGuidance`, `problemAdvice`, `severityRank`, `normalizeSeverity`,
  `problemOpenLocator`, `problemDiagnosticText`. Сейчас эти функции невозможно
  протестировать отдельно от React-дерева.

### Задачи

- [ ] `components/resourceTable/cells/` — по файлу на группу ячеек
  (`UsageCells.tsx`, `ContainerStatusCell.tsx`, `WorkloadConditionsCell.tsx`,
  `AgeCell.tsx`), `formatCell` остаётся в `ResourceTable.tsx` как диспетчер.
- [ ] `components/problems/problemsModel.ts` — все чистые функции
  классификации и советов.
- [ ] `components/problems/` — 5 суб-компонентов отдельными файлами.
- [ ] Добавить в `tests/problems.contract.test.cjs` поведенческие тесты на
  `problemsModel.ts` (категория/severity/совет по конкретной строке) — это
  первая замена grep-контракта на настоящий, из списка Секции C.
- [ ] Документация: не требуется, поведение не меняется.

### Критерий секции

`ResourceTable.tsx` ≤ 340 строк, `ProblemsPanel.tsx` ≤ 240 строк. Функции
классификации проблем покрыты прямыми тестами.

---

## Секция G — форматтеры величин и геометрия PTY

Предполагаемая версия: 2.20.7. Закрывает два пункта, отложенных ещё в
`dedup-refactor-2.10.2-plan.md` («не входит в патч»).

### Подтверждённая причина 1: форматирование размазано по 7 местам

Парсинг величин консолидирован в 2.10.2 (`resources/quantity.ts`:
`parseCpuMillicores`, `parseMemoryBytes`), а **форматирование — нет**:

```
ResourceSummary.tsx:452     parseKubeQuantity
ResourceTable.tsx:507,513   formatCpuValue, formatByteValue
normalizers.ts:732          formatBytesQuantity
llm/context.ts:336          formatCpu
OverviewPanel.tsx:377       formatCpuCapacity
SecretTab.tsx:283           formatBytes
UsageHistoryChart.tsx:15    formatCpuMillicores
```

В `renderer/utils/` нет ни `formatBytes.ts`, ни `quantity.ts`. Backend и
renderer форматируют одни и те же CPU/память по-разному — разные панели
показывают одно значение с разной точностью округления. Это косметическое
расхождение, не баг, но именно оно и порождает следующие.

### Подтверждённая причина 2: геометрия PTY продублирована и уже разъехалась

```
ssh/nodeSshWebSocket.ts           DEFAULT_ROWS = 30   MIN_ROWS = 8
terminal/podTerminalWebSocket.ts  DEFAULT_ROWS = 24   MIN_ROWS = 5
```

Оба файла независимо объявляют `MAX_CLIENT_MESSAGE_BYTES`, `DEFAULT_COLS`,
`MIN_COLS`, `MAX_COLS`, `MAX_ROWS`. Все значения совпадают, кроме строк — и из
кода неясно, осознанное это решение или разошедшаяся копипаста.

### Задачи

- [ ] `renderer/utils/formatQuantity.ts` — единые `formatCpu`, `formatBytes`,
  `formatCpuMillicores` с явно заданной точностью. Свести к нему все 7 мест.
- [ ] **Перед сведением** зафиксировать, какое округление считается
  правильным, и записать в CHANGELOG как единственный user-visible эффект
  секции (по образцу того, как это сделано в 2.10.2 для парсинга).
- [ ] `backend/terminal/ptyGeometry.ts` — общие `MAX_CLIENT_MESSAGE_BYTES`,
  `DEFAULT_COLS/MIN_COLS/MAX_COLS/MAX_ROWS` + `clampRows`/`clampCols`.
- [ ] Расхождение `DEFAULT_ROWS`/`MIN_ROWS` между SSH и Pod-терминалом —
  **решить явно**: либо свести к одному значению, либо оставить разными и
  снабдить комментарием «почему у SSH 30/8, а у pod exec 24/5».
- [ ] Заодно вынести из `nodeSshWebSocket.ts` (849 строк) чистые валидаторы
  строк 130–350 (`limitedText`, `normalizeHost`, `normalizePort`,
  `normalizeUsername`, `normalizeAuthMethod`, `normalizeConnection`) в
  `ssh/sshPayload.ts` — это ~200 строк, тестируемых без сети и без риска для
  крипто-части. Класс `NodeSshWebSocketServer` не трогать.
- [ ] `docs/security.md` — сверить, что вынос валидаторов не расходится с
  описанным контрактом валидации SSH-payload.

### Критерий секции

CPU и память форматируются одним модулем на renderer и дают одинаковый
результат в таблице, summary, overview и usage-графике. Константы геометрии
PTY объявлены один раз; любое оставшееся расхождение объяснено комментарием.
`nodeSshWebSocket.ts` ≤ 650 строк.

---

## Не входит в программу

- **`gateway.ts` (578 строк, из них 290 — один `handleRequest`).** Плоская
  цепочка `if (method === X && pathname === Y)` на ~35 веток, каждая со своим
  `try/catch` + `writeError`. Замена на таблицу маршрутов убрала бы ~200 строк
  повторов, но это уже отмечалось как nice-to-have в 2.10.2 и по-прежнему
  читается без риска. Делать отдельным chore-патчем, когда число веток
  перевалит за 45 или когда понадобится middleware.
- **`renderer/types.ts` (518 строк).** 40+ DTO-интерфейсов, ноль логики. Один
  файл типов — норма; дробление добавит только импортов.
- **`renderer/api.ts` (470 строк).** Один класс `ApiClient`, ~90 однострочных
  методов. Плоский и предсказуемый.
- **`configStore.ts` (559 строк).** Нормализация конфига плюс `ConfigStore` —
  связная единица, разрывать нечего.
- **`resourceActions.ts` (442), `metrics.ts` (467), `watchManager.ts` (438),
  `relatedResourcesEngine.ts` (426), `llm/context.ts` (463).** В зоне 400–500
  строк, каждый — одна связная ответственность. Трогать только если вырастут
  за 600.

## Автоматический gate (после каждой секции)

- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm --workspace apps/desktop run test:gateway`
- [ ] `npm run verify:release`

## Общий критерий завершения программы

Ни один файл в `apps/desktop/src` не длиннее 700 строк без явного обоснования
в разделе «Не входит в программу». В `renderer/styles/` нет файлов-хотфиксов и
осталось меньше 60 `!important`. Ни один тестовый файл не длиннее 700 строк.
Форматирование величин и геометрия PTY объявлены по одному разу. Все семь
релизов синхронизированы по `docs/release-checklist.md`, полный gate зелёный
на каждом.
