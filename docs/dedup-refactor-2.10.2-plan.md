# KubeDeck 2.10.2 — устранение дублирования в backend и renderer

Статус: план, не реализовано.

## Цель

Патч не меняет пользовательские сценарии — устраняет структурный долг,
найденный при повторном код-ревью (два параллельных агента, backend и
renderer). Кодовая база в остальном чистая: TODO/FIXME/`eslint-disable`/
`@ts-ignore`/`as any` — ноль по всему `apps/desktop/src`. Найденные проблемы —
не мусор, а дублирование одного и того же паттерна в 3–14 местах и один
поведенческий баг (расхождение в округлении CPU/memory).

Секции независимы, порядок — по убыванию критичности. После каждой секции
запускать полный gate (`npm run lint && npm run format:check && npm run
typecheck && npm run build && npm run test:renderer && npm --workspace
apps/desktop run test:gateway`), не смешивать секции в один коммит.

## Правило для этого патча

Каждая секция ниже обязана обновить релевантную документацию в том же
коммите, где меняется код — не отдельным довеском в конце. Если у секции нет
документации для правки, это явно написано в самой секции («документация: не
требуется, поведение не меняется»).

---

## Секция A — общий HTTP-error/route-parsing слой (backend)

### Подтверждённая причина

- `decodePathPart`/`decodePart` — идентичный helper (`decodeURIComponent` +
  `try/catch` → ошибка 400) продублирован в 14 местах: `routes/deploymentLogs.ts`,
  `routes/podExec.ts`, `routes/relatedResources.ts`, `routes/resourceActions.ts`,
  `routes/resourceLists.ts`, `routes/problems.ts`, `routes/search.ts`,
  `routes/resourceDiscoveryEvents.ts`, `routes/yaml.ts`, `routes/resourceDetails.ts`,
  `routes/secrets.ts`, `ssh/nodeSshWebSocket.ts`, `terminal/podTerminalWebSocket.ts`,
  `watch/webSocket.ts`. `gateway.ts` также имеет свою версию (пишет прямо в
  `response` и возвращает `null` вместо throw) — при консолидации сверить, что
  gateway.ts не нужно трогать отдельно или тоже подвести под общий helper.
- `writeRouteError`-диспетчер (`RequestValidationError` → `ClusterNotFoundError`
  → `KubectlError` → generic 500) переизобретён в 12 файлах:
  `deploymentLogs.ts`, `relatedResources.ts`, `resourceLists.ts`, `problems.ts`,
  `search.ts`, `resourceDiscoveryEvents.ts`, `yaml.ts`, `resourceDetails.ts`,
  `secrets.ts`, `podExec.ts`, `resourceActions.ts`, `portForward.ts`. Последние
  три вручную собирают JSON тела вместо вызова `writeError`, хотя итоговый JSON
  идентичен.
- Дублирующиеся классы ошибок с одинаковой формой:
  `RequestValidationError` (`validation.ts`) и `LlmRequestError`
  (`routes/llm.ts`, `constructor(statusCode, code, message)`) — байт-в-байт
  одно и то же под разным именем;
  `ResourceActionError` (`routes/resourceActions.ts`) и `PodExecError`
  (`routes/podExec.ts`, `constructor(statusCode, info: ErrorInfo)`) — тоже
  идентичны друг другу.
- `confirmationString` продублирован в `podExec.ts`, `resourceActions.ts`,
  `yaml.ts` (мелкое, добавить сюда же заодно).

### Задачи

- [ ] Вынести единый `decodePathPart(value, response)` в `errors.ts` (или
  `validation.ts`, рядом с существующими валидаторами) и убрать 14 локальных
  копий, заменив на импорт. Учесть разницу сигнатур (HTTP route — пишет в
  `response`; WebSocket-модули — своя семантика ошибки, без `ServerResponse`) —
  не форсировать одну сигнатуру, если это ломает семантику.
- [ ] Ввести единый параметризуемый `writeRouteError(response, error, log,
  { fallbackCode, fallbackMessage })` в `errors.ts`, убрать 12 локальных копий
  диспетчера, включая три файла, которые вручную собирают JSON.
- [ ] Оставить `RequestValidationError` как канонический класс (уже широко
  используется), убрать `LlmRequestError` из `routes/llm.ts`, использовать
  импорт.
- [ ] Добавить один общий класс для формы `(statusCode, info: ErrorInfo)` в
  `errors.ts` (например `RouteInfoError`), убрать `ResourceActionError` и
  `PodExecError`, обновить оба файла на импорт.
- [ ] Вынести `confirmationString` в `errors.ts` или `validation.ts`, убрать
  3 копии.

### Контракты

- [ ] Каждый затронутый route отвечает тем же JSON/статус-кодом на те же
  некорректные входы, что и до рефакторинга — HTTP-контракт не меняется,
  меняется только источник кода.
- [ ] `npm --workspace apps/desktop run test:gateway` проходит без изменений в
  ассертах (это поведенческие тесты через HTTP, не читают исходники как
  текст — в отличие от renderer-тестов, здесь не ожидается необходимости
  переписывать тесты, но проверить перед коммитом).

### Документация

Не требуется — внутренний рефакторинг, HTTP-контракт и поведение не меняются.

---

## Секция B — унификация парсинга Kubernetes quantity (backend, поведенческий баг)

### Подтверждённая причина

`resources/normalizers.ts` (`cpuMillicores`, `memoryBytes` — не экспортирован)
и `resources/metrics.ts` (`parseCpuMillicores`, `parseMemoryBytes` —
экспортирован) независимо парсят строки CPU/memory quantity. Версия в
`metrics.ts` поддерживает суффиксы `Pi`/`Ei` и делает `Math.trunc` результата;
версия в `normalizers.ts` — нет. Итог: одно и то же значение (например,
`requests.memory` пода) может по-разному округляться/масштабироваться в
зависимости от того, через какой путь оно попало в UI — это расхождение в
отображаемых цифрах, не просто стиль.

### Задачи

- [ ] Вынести оба парсера в новый файл `resources/quantity.ts` без зависимостей
  от `normalizers.ts`/`metrics.ts` (избегаем циклического импорта — `metrics.ts`
  уже импортирует `ResourceRow` из `normalizers.ts`).
- [ ] `resources/quantity.ts` — единая реализация с поддержкой `Pi`/`Ei` и
  консистентным округлением (взять более полную версию из `metrics.ts` как
  основу).
- [ ] `normalizers.ts` и `metrics.ts` импортируют парсер из `quantity.ts`,
  локальные версии удалить.
- [ ] Прогнать `apps/desktop/tests` на предмет ассертов, которые полагались на
  старое (неполное) поведение `normalizers.ts` — при расхождении обновить
  ожидаемые значения теста, а не возвращать старое поведение.

### Контракты

- [ ] Одно и то же значение quantity даёт один и тот же результат независимо
  от того, идёт ли оно через resource-list normalizers или через metrics.
- [ ] `Pi`/`Ei` суффиксы корректно парсятся везде, где раньше это делал только
  `metrics.ts`.

### Документация

CHANGELOG-запись 2.10.2 должна упомянуть это как исправление отображения
CPU/memory — единственная секция патча с user-visible эффектом (небольшая
правка отображаемых цифр в отдельных случаях с `Pi`/`Ei` или дробным
округлением).

---

## Секция C — `watch/webSocket.ts` использует общие WebSocket-хелперы (backend)

### Подтверждённая причина

`webSocketMessages.ts` уже экспортирует `rawDataByteLength`/`rawDataText`/
`clampInteger`/`safeSend`, и `ssh/nodeSshWebSocket.ts` и
`terminal/podTerminalWebSocket.ts` их корректно импортируют.
`watch/webSocket.ts` вместо этого содержит свои локальные копии
`rawDataByteLength`/`rawDataText` — расхождение появилось при более раннем
рефакторинге и не было доведено до конца.

### Задачи

- [ ] `watch/webSocket.ts`: убрать локальные `rawDataByteLength`/`rawDataText`,
  импортировать из `webSocketMessages.ts`.

### Документация

Не требуется.

---

## Секция D — `PodDrawer.tsx`: логи через выделенный hook (renderer)

### Подтверждённая причина

`hooks/usePodDrawerResourceLifecycle.ts` уже централизует fetch/loading/error/
abort для summary/yaml/describe/events/related/metrics. Логи-таб реализован в
обход этого — отдельные `useState` (`logsLoading`, `logsTail`, `logsPrevious`,
`logsTimestamps`, `logsFollow`, `logsQuery`, `logsContainer`, `logsPodFilter`,
`deploymentLogPods`, `deploymentLogContainers`), свой fetch-эффект со своим
`AbortController` и pod/deployment-ветвлением, отдельный polling-эффект и
`downloadFullLogs` — самый большой самостоятельный кусок из 701 строки
`PodDrawer.tsx`.

### Задачи

- [ ] Новый `hooks/usePodDrawerLogs.ts` — забирает весь logs-кластер: fetch,
  follow/polling, pod-vs-deployment ветвление, download. Не пытаться
  впихнуть в `usePodDrawerResourceLifecycle` — у логов достаточно уникального
  поведения (follow, polling, download), чтобы быть отдельным hook, по
  аналогии с тем, как из `App.tsx` выносились независимые куски, а не всё в
  один hook.
- [ ] `PodDrawer.tsx` использует `usePodDrawerLogs`, локальные `useState`/
  эффекты удаляются.
- [ ] Найти в `apps/desktop/tests/renderer-controllers.contract.test.cjs` все
  `fs.readFileSync(..., "components/PodDrawer.tsx")` с ассертами на
  переносимый код (логи) и перенести эти конкретные assert на чтение нового
  hook-файла — по той же процедуре, что применялась при выносе `App.tsx`
  (сверить, какие конкретно regex ломаются, не переписывать тест вслепую).

### Документация

Не требуется — поведение логов не меняется, только расположение кода.

---

## Секция E — общий `useXtermSession` hook для `NodeSshTab`/`TerminalTab` (renderer)

### Подтверждённая причина

Проверено через diff — идентичны байт-в-байт: `disconnectTerminal`,
`terminalStatusClass`, `sendTerminalResizeIfChanged`. Почти идентичны
(тривиальные отличия полей): `copyTerminalSelection`, `parseTerminalMessage`.
Оба файла независимо реализуют один и тот же skeleton жизненного цикла xterm:
создание `XTerm`+`FitAddon`, `open` в `hostRef`, `onSelectionChange` → copy,
`ResizeObserver`+`window resize` → fit+resize, слушатель
`kubedeck-theme-change`, dispose при unmount. Итого ~150 строк дублирования
между двумя из крупнейших файлов renderer (`NodeSshTab.tsx` 493 строки,
`TerminalTab.tsx` 390 строк). Общим у них уже сейчас является только
`terminalThemeFromCss` (`utils/terminalTheme.ts`).

### Задачи

- [ ] Новый `hooks/useXtermSession.ts` (или `utils/xtermSession.ts`, если без
  React-состояния получится обойтись) — владеет: конструированием
  `XTerm`+`FitAddon`, resize/fit-проводкой, copy-on-select, слушателем темы,
  и пятью продублированными функциями (`disconnectTerminal`,
  `terminalStatusClass`, `sendTerminalResizeIfChanged`,
  `copyTerminalSelection`, `parseTerminalMessage`).
- [ ] `NodeSshTab.tsx` и `TerminalTab.tsx` используют общий hook, поверх
  кладут только своё — SSH-сокет vs pod-exec-сокет протокол соединения.
  JSX/verstka не менять без необходимости.
- [ ] В `renderer-controllers.contract.test.cjs` найти ассерты, читающие
  `components/NodeSshTab.tsx`/`components/TerminalTab.tsx` на предмет
  переносимого кода (например тест "hidden terminals never fit or resize the
  PTY" уже явно проверяет `activeRef`/`bounds` паттерн в обоих файлах) и
  перенаправить их на новый hook-файл там, где код туда переехал.

### Документация

Не требуется.

---

## Секция F — удалить мёртвый `EventsTab.tsx` (renderer)

### Подтверждённая причина

`components/EventsTab.tsx` (168 строк) нигде не импортируется — проверено
grep по `apps/desktop/src` и `apps/desktop/tests`. `PodDrawer.tsx` явно
редиректит с `"events"` таба на `"summary"` — события теперь показываются
через `ResourceSummary`. Похоже на остаток до консолидации.

### Задачи

- [ ] Перед удалением ещё раз проверить `grep -rn "EventsTab" apps/desktop/src
  apps/desktop/tests` — ноль совпадений кроме самого файла.
- [ ] Удалить `components/EventsTab.tsx`.
- [ ] Проверить, нет ли забытого `import` в `PodDrawerChrome.tsx`/типах табов
  (`DrawerTab`), который перечисляет `"events"` как валидный, но недостижимый
  таб — если да, не трогать тип (события всё ещё есть как данные, просто не
  как отдельный drawer-таб), только убедиться, что нет мёртвой ссылки на
  компонент.

### Документация

Не требуется.

---

## Секция G — `PodDrawer.tsx`: YAML-действия через выделенный hook (renderer)

### Подтверждённая причина

`runYamlDryRun`/`applyYaml`/`resetYamlDraft`/`reloadYamlFromCluster` —
самодостаточный кластер state+handlers внутри `PodDrawer.tsx`, той же формы,
что состояние, вынесенное из `App.tsx` в этом же цикле работы (bottom
terminals, resource workspace tabs и т.д.).

### Задачи

- [ ] Новый `hooks/usePodDrawerYamlActions.ts` — забирает YAML dry-run/apply/
  reset/reload state и handlers.
- [ ] `PodDrawer.tsx` использует новый hook.
- [ ] Обновить ассерты в `renderer-controllers.contract.test.cjs`, если они
  читают `PodDrawer.tsx` и матчатся на переносимый YAML-код (проверить тест
  "YAML dry-run and apply HTTP contract" и соседние — часть из них тестирует
  backend через HTTP и не тронется, но нужно явно перепроверить renderer-side
  ассерты).

### Документация

Не требуется.

---

## Не входит в патч (nice-to-have, не критично)

- `gateway.ts` — ~13 однотипных `try/catch` блоков вокруг route-веток; можно
  свернуть в `runRoute()`-wrapper, но читаемо и без риска как есть.
- `resourceDiscoveryEvents.ts` смешивает discovery/caching API-ресурсов и
  Kubernetes Events в одном файле — оба GET-хендлера, но не делят логику;
  разделить на `resourceDefinitions.ts` + `resourceEvents.ts` отдельным
  chore-патчем.
- `SecretTab.tsx` — третья независимая реализация fetch/loading/error/abort
  паттерна (после lifecycle hook и logs). Не трогать, пока не появится
  четвёртый случай — тогда обобщить в `useAbortableFetch`.
- Форматирование байтов продублировано 3 раза с разной точностью
  (`ResourceTable.tsx: formatByteValue`, `SecretTab.tsx: formatBytes`,
  `OverviewPanel.tsx: formatMemoryCapacity`/`formatCapacityNumber`) — разные
  панели могут показать одно и то же значение с разной точностью округления.
  Косметическое расхождение, не баг уровня Секции B. Консолидировать в
  `utils/formatBytes.ts` отдельным chore-патчем.

## Release sync 2.10.2

Даже без user-facing фич, проект синхронизирует версию на каждый патч
(см. `docs/release-checklist.md`, `release-contract.json`):

- [ ] Поднять версию до `2.10.2` в `package.json`, `apps/desktop/package.json`
  (и его зависимость `@kubedeck/shared-types`), `packages/shared-types/package.json`,
  пересобрать `package-lock.json`.
- [ ] `CHANGELOG.md` — запись 2.10.2, с явным упоминанием исправления
  CPU/memory округления (Секция B) как единственного user-visible эффекта;
  остальное — "internal cleanup, no behavior change".
- [ ] Создать `docs/releases/RELEASE_NOTES_2.10.2.md` и
  `docs/releases/REGRESSION_CHECKLIST_2.10.2.md` по образцу 2.10.1.
- [ ] README.md/README.ru.md — обновить версию и ссылки на release notes/
  checklist (тот же паттерн, что при 2.10.1).
- [ ] `NODE_MIGRATION_PROGRESS.md` — короткая запись про 2.10.2.
- [ ] `docs/third-party-notices.md` — обновить версию в шапке (зависимости не
  меняются, если не появится новый пакет).

## Автоматический gate

- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm --workspace apps/desktop run test:gateway`
- [ ] `npm run verify:release`

## Критерий завершения

Ни один route/WebSocket-модуль не содержит собственной копии
`decodePathPart`/`writeRouteError`/error-класса, если для них есть общий
эквивалент в `errors.ts`/`validation.ts`. CPU/memory quantity парсится один раз
в `resources/quantity.ts` и даёт одинаковый результат независимо от пути.
`NodeSshTab.tsx`/`TerminalTab.tsx` используют общий `useXtermSession`, без
дублирования xterm-lifecycle кода. `PodDrawer.tsx` не содержит
самостоятельных logs/yaml-action кластеров — они в отдельных hooks.
`EventsTab.tsx` удалён. Версия и release-документы синхронизированы на
`2.10.2`. Полный gate зелёный.
