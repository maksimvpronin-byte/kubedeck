# KubeDeck — разделение крупных файлов и снятие структурного долга

Статус: A, B и C выполнены (2.20.1–2.20.3). Дальше — D.

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
  пользы**, D–G — приятно, но не горит. Секция H добавлена по ходу Секции B:
  она нашла корень гонки `!important`, который сама закрыть не могла.
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

## Секция B — снять слой CSS-«хотфиксов»

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
постоянным слоем. Практическое следствие: любое изменение стилей дровера,
related-панели или resource summary требует угадывания, какой из двух файлов
победит, и почти всегда решается добавлением ещё одного `!important`.

### Что показал разбор перед работой

Первоначальная формулировка секции («влить polish обратно в базовые файлы,
снять `!important`») оказалась основана на неверной посылке. Разбор всех 18
таблиц стилей парсером с учётом порядка импорта в `main.tsx` дал другое:

- **`resource-summary-polish.css` вообще не слой переопределений.** Ни один из
  его 75 селекторов не встречается больше нигде. Это единственная таблица
  стилей Resource Summary, просто с неверным именем. Вливать некуда — нужен
  ренейм.
- **`drawer-controls-polish.css` — почти не слой.** 213 селекторов, из них с
  чем-либо пересекаются 8. Влить его в `drawer.css` **нельзя**: он грузится
  после `terminal.css`, и часть его правил сознательно перекрывает
  `.terminal-toolbar button.primary { … !important }`. Переезд на позицию
  `drawer.css` (4-я вместо 16-й) отдал бы победу `terminal.css` и изменил бы
  цвет кнопок в дровере.
- **Настоящий слой переопределений — только `related-panel-polish.css`** над
  `related-panel.css` (27 строк) и `panels.css`: 23 пересекающихся селектора.
  Его и надо схлопнуть.

### Почему `!important` нельзя снять массово

Проверка каждого `!important` против всех правил бандла (та же специфичность,
тот же порядок импорта, общий класс в селекторе) показала: из 406 `!important`
во всей папке безопасно снимаются **126**, а 280 — несущие. Причина в двух
вещах:

1. **Корень гонки — `layout.css`:**

   ```css
   .primary {
     background: var(--primary) !important;
     border-color: var(--primary-border) !important;
     color: var(--text-inverse) !important;
   }
   ```

   `!important` при специфичности 100. Любое более точное правило, которому
   нужен другой цвет primary-кнопки, обязано тоже быть `!important` — и дальше
   они разбираются между собой специфичностью. Отсюда селекторы вида
   `.pod-drawer .drawer-content button.primary:not(.danger):not(.danger-button):hover`.

2. **Внутри polish-файлов `!important` держит их собственный порядок.** Файлы
   писались в стиле «`!important` по умолчанию», поэтому правило с низкой
   специфичностью там штатно побеждает правило с высокой из того же файла.
   Снять `!important` — значит переписать этот порядок, а не почистить шум.

Первая попытка снять всё, что не пересекается с *другими* файлами, дала **1044
перевёрнутых исхода каскада** на проверке. Развязывание этого узла — не
переименование файлов, а переработка каскада кнопок всего приложения, поэтому
оно вынесено в **Секцию H**.

### Задачи

- [x] Инструмент проверки: парсер CSS с учётом вложенных at-rule и запятых
  внутри `:where()/:is()/:not()`, плюс чекер каскадной эквивалентности. Чекер
  берёт каждую пару объявлений, которые задают одно свойство и делят класс в
  селекторе, и сравнивает победителя до и после правки. 18 211 таких пар.
- [x] Снять 126 доказуемо мёртвых `!important` (тех, у кого нет ни одного
  соперника, способного выиграть после снятия): `related-panel-polish` 96,
  `drawer-controls-polish` 8, `terminal` 7, `layout` 5, `modals` 5,
  `diagnostics-panels` 4, `panels` 1.
- [x] `resource-summary-polish.css` → `resource-summary.css`, позиция импорта
  не меняется.
- [x] `drawer-controls-polish.css` → `drawer-controls.css`, позиция импорта не
  меняется; в шапке — почему файл грузится после `drawer.css` и `terminal.css`.
- [x] `related-panel.css` + `related-panel-polish.css` → один
  `related-panel.css` на позиции polish-файла (последней), базовые правила
  первыми.
- [x] Обновить импорты CSS в `main.tsx`.
- [x] `tests/renderer-controllers.contract.test.cjs` читал
  `styles/related-panel-polish.css` и `styles/resource-summary-polish.css` —
  пути обновлены.
- [x] Проверка эквивалентности до/после: **0 перевёрнутых пар, 0 потерянных,
  0 новых**.
- [ ] Регрессия — ручная, обязательна и должна попасть в
  `REGRESSION_CHECKLIST_{version}.md`: дровер (все вкладки, sort-индикаторы
  таблицы), Related-вкладка, Resource Summary — **на каждой из 8 тем**
  (`system, light, midnight, nord, forest, plum, mocha, graphite`).

### Критерий секции

Ни одного файла с суффиксом `-polish` в `renderer/styles/`; 17 файлов вместо
18. Каждый из трёх переименованных начинается с описания того, что он покрывает
и почему грузится там, где грузится. `!important` во всей папке — 280 вместо
406, и оставшиеся несущие: их снятие меняет каскад, что и доказано чекером.
Порог «меньше 60» из первоначальной формулировки достижим только Секцией H.

**Статус: выполнено, выпущено как 2.20.2.**

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

### Что получилось

Семи файлов из первоначальной раскладки не хватило: остаток всё равно тянул на
~1100 строк. Разложено на 12 доменных файлов плюс общий харнесс — по образцу
существующих `watch.contract.test.cjs`, `problems.contract.test.cjs`,
`search.contract.test.cjs`:

```
426  21  renderer-controllers  остаток: cluster rail и controller, LLM-рендерер,
                               manifest compare, Secret reveal, Pod Terminal,
                               async feedback, навигация, popover, error normalizer
314   7  theme                 темы, токены, data-атрибуты, контраст ANSI
309   9  watch-and-loading     reconnect, коалесценция событий, resource loader
260   5  resource-detail       метаданные ноды, адреса Service, ручной запуск CronJob
256  10  resource-table        колонки, сортировка, пагинация, мемоизация
234   6  yaml-editor           фолдинг, правка, поиск, переиспользование в kubeconfig
229   7  release-surface       контракты «поверхность версии X не разъехалась»
180   7  namespace-selection   селектор, recent, per-cluster изоляция
149   8  workspace-tabs        табы, dedup, лимит, закрытие, нижняя workspace
132   5  resource-usage        колонка usage, патч строк, график истории
117   4  drawer-lifecycle      generations, auto-refresh, запомненная вкладка
 93   4  bulk-actions          bulk delete/actions, привязка к кластеру
 79      helpers/renderer.cjs  loadTypeScript, resolveRendererModule, createTestScheduler
```

Отдельный файл `release-surface` появился по ходу: семь тестов вида «2.7.4 /
2.7.5 / 2.7.6 / 2.8.0 / 2.9.0 stay contracted» — это не домен, а слой
версионных проверок, и держать их вместе честнее, чем растаскивать по темам.

### Сколько тестов реально что-то проверяют

Классификация всех 93 по тому, исполняют ли они код рендерера (`loadTypeScript`)
или только читают файл (`readFileSync`):

```
поведение   31
смешанные   12   (исполняют код и дополнительно грепают исходник)
grep         50   ← только текст исходника
```

**Больше половины набора — окаменевший grep.** Все 50 помечены в коде
комментарием `// grep contract: asserts on source text, not behaviour.`, а в
шапке каждого файла с такими тестами объяснено, что этот маркер значит. Это
список на будущее: сами тесты не переписывались, чтобы разбиение осталось
чистым переносом.

### Задачи

- [x] Перенести тесты по доменам без изменения тел утверждений.
- [x] Вынести общий харнесс в `tests/helpers/renderer.cjs` (`loadTypeScript`,
  `resolveRendererModule`, `createTestScheduler`, `rendererRoot`), чтобы он не
  размножился по двенадцати файлам.
- [x] Пометить комментарием тесты, проверяющие текст исходника, а не поведение.
  Не переписывать сейчас — только пометить.
- [x] Сверить, что суммарное число тестов после разбиения = 93 (ни один не
  потерян и не продублирован).
- [x] `apps/desktop/package.json` — `test:renderer` перечисляет все 12 файлов
  явным списком, как это уже сделано для `test:gateway`.
- [x] Документация: не требуется, поведение не меняется.

### Критерий секции

Ни один файл renderer-тестов не длиннее 700 строк (факт: максимум — остаток,
426). `npm run test:renderer` даёт те же 93 прошедших теста. Список
grep-контрактов зафиксирован в комментариях и пригоден для отдельного патча.

Оговорка к первоначальной формулировке «ни один тестовый файл не длиннее 700
строк»: за 700 остаются два **gateway**-файла —
`resource-lists.contract.test.cjs` (798) и `llm.contract.test.cjs` (792). Они
вне области этой секции; разбирать их — отдельная работа, и пока они не мешают,
она не запланирована.

**Статус: выполнено, выпущено как 2.20.3.**

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

## Секция H — развязать каскад кнопок

Добавлена по итогам Секции B. Версия не назначена: делать после C–G, отдельным
релизом, с самой широкой ручной регрессией во всей программе.

### Подтверждённая причина

`layout.css` объявляет:

```css
.primary {
  background: var(--primary) !important;
  border-color: var(--primary-border) !important;
  color: var(--text-inverse) !important;
}
```

Специфичность 100 — и `!important`. Это делает невозможным нормальное
переопределение: правило, которому нужен другой цвет primary-кнопки в дровере,
в терминальном тулбаре или в модалке, обязано тоже быть `!important`, после
чего такие правила разбираются между собой одной специфичностью. Отсюда в
кодовой базе селекторы вида

```
.pod-drawer .drawer-content button.primary:not(.danger):not(.danger-button):hover
```

и `.terminal-toolbar button.primary { … !important }`.

Секция B сняла 126 доказуемо мёртвых `!important` из 406. Оставшиеся 280 —
несущие: их снятие меняет каскад (проверено чекером эквивалентности, первая
наивная попытка дала 1044 перевёрнутых исхода). Пока `.primary` остаётся
`!important` при специфичности 100, число `!important` в папке снизу ограничено.

### Задачи

- [ ] Снять `!important` с `.primary` в `layout.css` и убедиться, что базовый
  вид primary-кнопки держится специфичностью и порядком импорта.
- [ ] Пройти по цепочке сверху вниз: `terminal.css` (14 несущих),
  `drawer-controls.css` (131), `related-panel.css` (132) — на каждом шаге
  снимать `!important`, ставший мёртвым, и проверять чекером эквивалентности.
- [ ] Где после развязки правило действительно должно побеждать — выражать это
  специфичностью, а не `!important`; упрощать селекторы вида
  `:not(.danger):not(.danger-button)`, ставшие нужными только из-за гонки.
- [ ] Регрессия: **каждая кнопка приложения** — primary, secondary, danger,
  icon — в дровере, тулбарах (YAML, Logs, Terminal, SSH), модалках, панели
  настроек, рельсе кластеров, Port forwards и Problems, на всех 8 темах.

### Критерий секции

Ни одного `!important` на селекторе специфичности ниже 200 без комментария,
объясняющего, что именно он перекрывает. Суммарное число `!important` в
`renderer/styles/` — меньше 60. Чекер эквивалентности не используется как
критерий: здесь каскад меняется намеренно, проверка — глазами по списку выше.

### Инструменты

Скрипты разбора и проверки каскада, написанные для Секции B, не коммитились —
они одноразовые. Если Секция H за них возьмётся, восстанавливать придётся три
вещи: парсер CSS с учётом вложенных at-rule и запятых внутри `:where()/:is()/
:not()`; расчёт специфичности; чекер, который для каждой пары объявлений с
общим свойством и общим классом в селекторах сравнивает победителя до и после.
На текущей папке это 18 211 пар.

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
в разделе «Не входит в программу». В `renderer/styles/` нет файлов-хотфиксов
(Секция B) и осталось меньше 60 `!important` (Секция H). Ни один тестовый файл
не длиннее 700 строк. Форматирование величин и геометрия PTY объявлены по
одному разу. Все релизы синхронизированы по `docs/release-checklist.md`, полный
gate зелёный на каждом.
