# KubeDeck 2.8.0 — графические ресурсы Namespaces и Disk для Nodes

Статус: реализовано. Автоматические проверки пройдены 23 июля 2026 года; ручной визуальный smoke-check остаётся открытым.

## Контекст

В 2.7.6 список Nodes получил компактные полосы CPU и RAM. Они быстрее считываются, чем строка вида `used / free`, различаются цветом и сохраняют точные значения в tooltip.

Список Namespaces всё ещё показывает длинную строку:

`CPU 9m / no quota; RAM 183Mi / no quota`

Из-за этого:

- CPU и RAM трудно сравнивать между namespaces;
- строка становится широкой и визуально тяжелее остальных колонок;
- `no quota` многократно повторяется;
- представление одного и того же типа данных отличается от Nodes.

Дополнительно в Nodes не хватает третьей полосы Disk. При её добавлении нельзя вернуть исправленную в 2.7.6 проблему: массовый запуск отдельного `kubectl ... /stats/summary` для каждой ноды блокировал список и создавал высокую нагрузку на CPU.

## Цель 2.8.0

1. Заменить текстовую колонку `CPU/RAM` в Namespaces на компактные полосы CPU, RAM и Storage.
2. Переиспользовать визуальный язык и компонент `ResourceUsageBar` из Nodes.
3. Добавить в список Nodes третью полосу Disk.
4. Чётко различать фактическое потребление, quota и отсутствие quota.
5. Не блокировать первое отображение таблиц дополнительными disk-запросами.
6. Не запускать неограниченное число процессов `kubectl`.
7. Сохранить точные значения и объяснение источника данных в tooltip и `aria-label`.
8. Устранить моргание всего приложения при первом открытии SSH/терминала и других лениво загружаемых панелей.
9. Заменить отдельные текстовые CPU/Memory колонки Pods на две компактные полосы Usage без Disk.
10. Добавить сворачивание YAML-групп (`metadata`, `spec`, `status` и вложенных maps/sequences) во всех полноценных представлениях manifests.

## Термины и смысл данных

### Namespace CPU и RAM

- `used` — сумма фактического потребления Pods из одного `kubectl top pods -A`;
- `limit` — суммарный соответствующий `status.hard` ResourceQuota namespace;
- процент вычисляется только при наличии quota;
- отсутствие quota не означает `0%` и не означает отсутствие потребления.

### Namespace Storage

Kubernetes Metrics API не предоставляет фактическое использование файловой системы на уровне namespace. Поэтому полоса Storage означает использование ResourceQuota, а не реально занятые байты на дисках нод.

- `used` — сумма `status.used` storage-ресурсов ResourceQuota;
- `hard` — сумма соответствующих `status.hard`;
- это зарезервированный/учтённый Kubernetes storage;
- tooltip явно использует формулировку `Storage quota`;
- при отсутствии storage quota показывается `No quota`;
- UI не называет это значение фактическим disk usage.

В расчёт Storage входят:

- `requests.storage`;
- `requests.ephemeral-storage`;
- `limits.ephemeral-storage`;
- при наличии — scoped storage-class quota keys вида `<storage-class>.storageclass.storage.k8s.io/requests.storage`.

Один и тот же ресурс не должен учитываться дважды. Общий `requests.storage` и scoped storage-class quotas отображаются раздельно в tooltip, а основная полоса использует общий лимит, если он существует. Если существует только один scoped limit, допускается использовать его. При нескольких scoped limits без общего лимита основная полоса показывает агрегат с пояснением `combined storage-class quotas`.

### Node Disk

Для Node полоса Disk означает фактическое использование node filesystem из kubelet stats summary:

- `used`;
- `available`;
- `capacity`, если источник её вернул;
- процент `used / capacity`.

Capacity вычисляется как `used + available`, только если явная capacity отсутствует. Отсутствие stats не подменяется данными `allocatable.ephemeral-storage`, потому что allocatable и фактически свободное место имеют разный смысл.

## 1. Представление Namespaces

Колонка `CPU/RAM` переименовывается в `Usage`.

В каждой строке находятся три компактные полосы:

1. `CPU`;
2. `RAM`;
3. `Storage`.

Используется существующий `ResourceUsageBar`:

- одинаковая геометрия с Nodes;
- CPU сохраняет текущий CPU color token;
- RAM сохраняет текущий memory color token;
- Storage/Disk использует третий theme-aware color token;
- высота строки остаётся стабильной;
- полосы не получают отдельные карточки или тяжёлые рамки;
- chart library и новая dependency не добавляются.

### Namespace с quota

Полоса заполнена на `used / hard`.

Tooltip:

`CPU: 250m used · 2 cores quota · 12.5%`

`RAM: 1.5 GiB used · 8 GiB quota · 18.75%`

`Storage quota: 12 GiB used · 100 GiB quota · 12%`

В строке процент округляется до целого, точные исходные и человекочитаемые значения остаются в tooltip.

### Namespace без quota

Если metrics доступны, но quota отсутствует:

- label ресурса остаётся видимым;
- track имеет нейтральное состояние без процента;
- справа отображается `No quota`, а не `N/A` и не `0%`;
- tooltip показывает фактический `used` и объясняет, что процент без quota не вычисляется.

Пример:

`RAM: 183 MiB used · no quota`

### Metrics Server недоступен

Для CPU/RAM:

- показывается `N/A`;
- quota, если она существует, остаётся доступна в tooltip;
- UI не показывает ложный `0 used`;
- ошибка metrics не блокирует список Namespaces.

Storage quota загружается независимо от Metrics Server и продолжает отображаться.

## 2. Данные Namespaces

`applyNamespaceMetrics` продолжает использовать фиксированное число общих запросов:

1. один `kubectl top pods -A --no-headers`;
2. один `kubectl get resourcequota -A -o json`.

Дополнительные запросы на каждый namespace не добавляются.

Normalizer/metrics enrichment сохраняет числовые значения отдельно от display text:

- `namespaceCpuUsedValue`;
- `namespaceCpuQuotaValue`;
- `namespaceCpuUsagePercent`;
- `namespaceMemoryUsedValue`;
- `namespaceMemoryQuotaValue`;
- `namespaceMemoryUsagePercent`;
- `namespaceStorageUsedValue`;
- `namespaceStorageQuotaValue`;
- `namespaceStorageUsagePercent`.

Названия полей могут быть сокращены при реализации, если существующий `ResourceRow` уже допускает более простой контракт. Обязателен смысл:

- renderer не парсит готовую строку `namespaceResources`;
- проценты считаются backend/helper-функцией из исходных quantities;
- старое поле `namespaceResources` можно оставить временно для совместимости, но новая ячейка на него не опирается.

Memory/storage форматируются тем же formatter, что ResourceQuota в 2.7.6:

- bytes;
- KiB;
- MiB;
- GiB;
- TiB;
- максимум два знака после запятой;
- без незначащих нулей.

## 3. Disk в списке Nodes

В `Usage` после CPU и RAM добавляется третья строка `Disk`.

Список Nodes должен сначала отображаться без ожидания disk metrics:

- `kubectl get nodes` и единый `kubectl top nodes` остаются критическим путём;
- первая отрисовка показывает Disk в состоянии loading/unknown;
- disk enrichment выполняется после появления строк;
- CPU/RAM не очищаются во время загрузки Disk;
- ошибка одной ноды не ломает остальные строки.

### Ограничение нагрузки

Запрещено возвращать `Promise.all(rows.map(runKubectl))`.

Минимальный безопасный контракт:

- одновременно выполняется не более 2 disk probes;
- загружаются только ноды текущей страницы;
- смена страницы или ресурса отменяет/игнорирует устаревшую очередь;
- результаты кэшируются по `clusterId + node uid/name`;
- TTL disk cache — 60 секунд;
- повторная сортировка или фильтрация не запускает новый probe при свежем кэше;
- ручной refresh инвалидирует либо явно обновляет disk cache текущей страницы;
- закрытие кластера очищает его cache;
- ошибки имеют короткий negative cache, чтобы UI не повторял падающий запрос на каждом render.

Размер страницы по умолчанию остаётся прежним. Переход на страницу с 2000 Nodes не должен мгновенно запускать 2000 процессов: очередь остаётся ограниченной, а запросы выполняются только пока пользователь находится на этой странице.

Если renderer уже знает видимые строки внутри текущей страницы без нового observer, используется этот список. `IntersectionObserver`, виртуализация и новый state manager в 2.8.0 не добавляются.

### Endpoint

Переиспользуется добавленный в 2.7.6 node metrics endpoint и parser stats summary. Второй disk parser и новый backend route не создаются.

Batch endpoint допустим только как тонкая обёртка над существующим parser, если он заметно уменьшит renderer orchestration. Он обязан:

- ограничивать concurrency;
- возвращать partial results;
- не удерживать ответ до бесконечного timeout одной ноды;
- не запускать shell interpolation;
- валидировать имена нод.

Предпочтение отдаётся существующему single-node endpoint плюс небольшой очереди на renderer, если этого достаточно.

### Состояния Disk

- loading — нейтральный track без ложного процента;
- available — процент и третий цвет;
- unavailable — `N/A` с причиной в tooltip;
- stale cached value — старое значение может оставаться видимым во время фонового refresh с отметкой в tooltip;
- значение выше 100% ограничивается визуально до 100%, исходные числа сохраняются в tooltip.

## 4. Представление ресурсов Pods

В таблице Pods отдельные колонки `CPU` и `Memory` заменяются одной колонкой `Usage`.

В каждой строке находятся две полосы:

1. `CPU`;
2. `RAM`.

Disk для Pods в 2.8.0 не добавляется:

- Metrics Server не предоставляет filesystem usage Pod;
- kubelet stats потребовал бы дополнительные запросы к нодам и сопоставление containers;
- ephemeral-storage requests/limits не являются фактически занятым диском;
- показывать reservation под названием Disk было бы вводящим в заблуждение.

Используется тот же `ResourceUsageBar`, что для Nodes и Namespaces. Геометрия, CPU/RAM colors, tooltip и состояния должны совпадать.

### Знаменатель

Для Pod процент показывает фактический usage относительно effective Pod limit:

- CPU usage / effective CPU limit;
- RAM usage / effective memory limit.

Если limit отсутствует:

- фактическое значение из Metrics Server остаётся видимым в tooltip;
- track получает состояние `No limit`;
- процент не вычисляется;
- request не подменяет limit;
- ресурсы Node не используются как знаменатель для отдельного Pod.

Request может быть показан дополнительной строкой tooltip, но не влияет на заполнение полосы. Это сохраняет однозначный смысл: заполненная полоса отвечает на вопрос «какая часть разрешённого Pod limit уже используется».

### Effective requests и limits

Значения вычисляются из Pod JSON без дополнительных API-запросов.

Для обычных containers:

- CPU requests/limits суммируются;
- memory requests/limits суммируются.

Для init containers учитывается Kubernetes pod scheduling semantics:

- берётся максимум request/limit одного init container;
- effective значение Pod — максимум между суммой обычных containers и максимумом init containers;
- `spec.overhead`, если присутствует, добавляется к effective request/limit;
- отсутствующий limit хотя бы у одного одновременно работающего обычного container означает, что общий Pod limit для соответствующего ресурса неограничен;
- restartable init/sidecar containers учитываются согласно поддерживаемой Kubernetes semantics; если текущий normalizer не может надёжно определить их режим, контракт покрывается fixture-тестом до реализации UI.

Renderer не суммирует quantities из container arrays. Normalizer сохраняет готовые числовые и display значения:

- `podCpuRequest`;
- `podCpuLimit`;
- `podCpuUsagePercent`;
- `podMemoryRequest`;
- `podMemoryLimit`;
- `podMemoryUsagePercent`.

Точные имена могут следовать существующему `ResourceRow`, но расчёт должен находиться в одном backend/helper-контракте.

### Состояния

Metrics доступны, limit есть:

- показывается процент;
- tooltip: `CPU: 125m used · 500m limit · 25%`;
- request при наличии: `250m requested`.

Metrics доступны, limit отсутствует:

- `No limit`;
- tooltip: `RAM: 183 MiB used · no limit`;
- request показывается только как справочная информация.

Metrics недоступны:

- `N/A`, а не `0%`;
- известные request/limit остаются в tooltip;
- отсутствие Metrics Server не блокирует список Pods.

Pod в `Pending`, завершённый или удаляемый Pod без metrics:

- `N/A`;
- UI не интерпретирует отсутствие строки в `kubectl top` как нулевое потребление;
- Phase остаётся отдельным источником состояния Pod.

### Columns и совместимость

- две колонки `cpuUsage` и `memoryUsage` заменяются одной видимой колонкой `podResources`/`Usage`;
- миграция сохранённых Columns включает новую Usage, если раньше была видна хотя бы одна из CPU/Memory;
- если обе старые колонки были скрыты, новая Usage остаётся скрытой;
- sorting по CPU/Memory не смешивается в одну неочевидную сортировку;
- при необходимости sort menu предоставляет отдельные `CPU usage` и `RAM usage`, не добавляя новые table columns;
- Filter продолжает находить исходные CPU/RAM values и состояния `no limit` / `metrics unavailable`;
- ширина таблицы уменьшается на одну колонку.

## 5. Сворачивание групп YAML manifests

### Область применения

Folding добавляется во все поверхности, где KubeDeck показывает полный Kubernetes manifest:

- вкладка YAML любого встроенного ресурса;
- YAML custom resources;
- read-only YAML;
- редактируемый YAML draft;
- обе стороны Manifest Compare;
- Clean и Raw режимы Compare.

Короткие command previews, фрагменты ошибок, Describe, Logs и YAML внутри LLM context не считаются полноценным manifest viewer и не получают folding.

### Какие группы можно свернуть

Fold control показывается у строк, содержащих YAML collection:

- mapping: `metadata:`, `spec:`, `status:`, `labels:`, `annotations:`;
- sequence: `containers:`, `volumes:`, `conditions:`;
- элементы sequence с вложенным mapping;
- любые вложенные пользовательские поля CRD;
- корневой документ не сворачивается целиком.

Пустые значения не считаются группой:

- `securityContext: {}`;
- `items: []`;
- `value: null`;
- scalar и block scalar.

Свёрнутая строка остаётся видимой и получает компактный маркер:

`metadata: … 12 lines`

или для последовательности:

`containers: … 3 items`

Количество строк/items справочное и не изменяет YAML.

### Источник структуры

Используется уже установленный пакет `yaml` 2.8.x:

- документ парсится с сохранением CST/range;
- range узла переводится в начальную и конечную строку;
- общий helper возвращает fold regions;
- один helper используется YAML tab и Manifest Compare;
- regex/ручной parser отступов не создаётся;
- Monaco, CodeMirror и новая dependency не добавляются.

Fold region содержит минимум:

- стабильный path, например `spec.template.spec.containers`;
- start line;
- end line;
- collection type;
- child/item count;
- display label.

Для sequence path включает стабильный индекс только внутри текущего YAML. После изменения draft fold state пересчитывается и сохраняется по path, если такой path ещё существует.

### Ошибочный или незавершённый YAML

Редактируемый draft может временно быть невалидным.

- parse error не блокирует обычное редактирование;
- последняя структура не применяется к изменившемуся тексту с несовпадающими ranges;
- fold controls временно скрываются;
- уже свёрнутые группы автоматически раскрываются;
- существующая подсветка, dry-run и Apply продолжают работать как сейчас;
- после восстановления валидного YAML fold regions появляются снова.

Folding не становится дополнительной YAML validation и не заменяет server dry-run.

### Управление

В gutter слева от номера строки находится маленькая кнопка:

- chevron down — группа раскрыта;
- chevron right — группа свёрнута;
- кнопка присутствует только у начала fold region;
- размер строки и номера не прыгают при появлении control;
- tooltip: `Collapse metadata` / `Expand metadata`;
- клик по chevron не устанавливает caret в textarea.

В toolbar YAML добавляются две компактные icon-only кнопки в существующем стиле:

- `Collapse all`;
- `Expand all`.

У кнопок обязательны tooltip и `aria-label`. `Collapse all` сворачивает только верхнеуровневые группы, чтобы не создавать невидимое вложенное состояние, которое невозможно понять после раскрытия родителя. Повторное ручное сворачивание вложенных групп допускается.

Keyboard contract:

- fold button доступна через Tab;
- `Enter`/`Space` переключают группу;
- `Alt+[` сворачивает группу в текущей строке;
- `Alt+]` раскрывает группу;
- shortcuts не перехватываются, если конфликтуют с системным вводом; обязательными остаются доступные gutter buttons.

### Редактируемый YAML и сохранность данных

Текущий YAML editor — синхронизированные `<pre>` и `<textarea>`. Обычный textarea не умеет скрывать произвольные строки с безопасным отображением caret/selection.

Для 2.8.0 выбирается минимальный безопасный контракт:

- source of truth всегда остаётся полный `yamlDraft`;
- сворачивание никогда не удаляет строки из draft;
- при наличии свёрнутых групп manifest показывается через существующий highlighted read view;
- перед первым вводом/вставкой или явным переходом к редактированию все группы раскрываются;
- после раскрытия возвращается обычный textarea с исходным полным текстом;
- Apply, Dry-run, Reset, Reload и Compare всегда получают полный draft;
- Copy YAML, если действие существует, копирует полный manifest, а не видимые строки;
- поиск выполняется по полному YAML и при переходе к совпадению раскрывает содержащую его группу.

Не создаётся собственный contenteditable code editor и сложное отображение caret между скрытыми строками. Если в будущем потребуется редактирование несвёрнутых областей при одновременно скрытых соседних блоках, это отдельный переход на полноценный editor component.

### Состояние folding

- fold state локален конкретному resource identity и YAML surface;
- переключение вкладки Summary/YAML не обязано сбрасывать состояние, пока drawer открыт;
- Reload сохраняет folds по YAML path, если path остался;
- Reset пересчитывает regions и сохраняет существующие path;
- переход к другому ресурсу не переносит `spec`/`metadata` folds автоматически;
- закрытие drawer очищает временное состояние;
- folding не записывается в kubeconfig и не меняет resource YAML;
- глобальная persistence между запусками в 2.8.0 не добавляется.

### Manifest Compare

Compare продолжает использовать общий `ManifestDiffRow[]` и сохраняет построчное выравнивание.

- fold control доступен на строках начала групп;
- сворачивание группы с одной стороны скрывает соответствующий диапазон diff rows сразу в обеих panes;
- добавленные/удалённые строки внутри диапазона скрываются вместе с группой;
- вместо диапазона остаётся одна aligned summary row;
- line numbers после группы сохраняют исходные номера;
- независимое скрытие строк только слева или только справа запрещено, поскольку оно разрушит выравнивание;
- scroll synchronization продолжает работать по оставшимся visual rows;
- переключение target, Clean/Raw и новый diff сбрасывает либо пересчитывает folds по path;
- группы с несовместимой структурой сворачиваются только если диапазон можно однозначно сопоставить с diff rows;
- неоднозначный region остаётся раскрытым.

### Визуальный контракт

- gutter получает фиксированную ширину;
- chevrons спокойные и не конкурируют с YAML syntax colors;
- collapsed summary использует muted tone;
- changed/added/removed tone Compare остаётся видимым на summary row;
- горизонтальная прокрутка и nowrap сохраняются;
- сворачивание не меняет ширину editor и drawer;
- раскрытие не сбрасывает `scrollLeft`;
- если текущий viewport исчез внутри collapsed range, начало группы остаётся в видимой области.

### Доступность

- fold button имеет полное имя группы и состояние;
- задаётся `aria-expanded`;
- связь с диапазоном задаётся через `aria-controls`, где это практически возможно;
- collapsed summary сообщает число скрытых строк/items;
- цвет и chevron не являются единственным источником состояния;
- focus ring не обрезается gutter;
- screen reader получает полный YAML через отдельное доступное текстовое представление либо textarea при переходе к редактированию, а не только набор видимых строк.

## 6. Общий компонент полосы

`ResourceUsageBar` расширяется только теми состояниями, которые нужны обоим спискам:

- `percent`;
- `used`;
- `free` либо `quota`;
- `capacity/allocatable`;
- `loading`;
- `unbounded` (`No quota`);
- `unavailable` (`N/A`);
- понятный tooltip/aria text.

Не создаются отдельные `NamespaceUsageBar`, `NodeDiskBar` и `QuotaUsageBar`, если один существующий компонент покрывает различия props.

Смысл denominator задаётся текстом:

- Node CPU/RAM — `allocatable`;
- Node Disk — `capacity`;
- Namespace CPU/RAM/Storage — `quota`.

## 7. Фильтрация, сортировка и Columns

- колонка Namespaces переименовывается из `CPU/RAM` в `Usage`;
- существующая настройка видимости колонки мигрирует по прежнему key, если возможно;
- старый key `namespaceResources` предпочтительно сохраняется, чтобы не сбрасывать пользовательские Columns;
- фильтр продолжает находить `no quota`, `metrics unavailable`, CPU/RAM/Storage и исходные display values;
- сортировка `Usage`, если она уже доступна, остаётся детерминированной;
- сортировка не должна меняться по мере прихода disk metrics без явного выбора пользователем;
- Node Disk участвует в filter/search только после загрузки значения;
- скрытая колонка Usage не запускает node disk enrichment.

## 8. Responsive и визуальная плотность

- три полосы помещаются в существующую строку без горизонтального расширения таблицы;
- ширина колонки Usage одинакова для Nodes и Namespaces;
- labels не обрезаются до неоднозначных `C`, `R`, `D`;
- на узкой ширине track сокращается раньше, чем label и состояние;
- tooltip рендерится существующим портальным механизмом и не прячется под drawer/table;
- hover, focus и keyboard tooltip работают одинаково;
- striped/selected row background не ухудшает контраст tracks.

## 9. Доступность

- известный процент получает `role="progressbar"`;
- задаются `aria-valuemin=0`, `aria-valuemax=100`, `aria-valuenow`;
- `aria-label` объясняет used и denominator;
- `No quota`, `N/A` и loading доступны текстом, а не только цветом;
- CPU, RAM и Disk/Storage различаются label, не только цветом;
- focus tooltip не закрывает соседние controls;
- темы light, midnight, nord, forest, plum и mocha сохраняют достаточный контраст.

## 10. Стабильность UI без полноэкранного моргания

### Наблюдаемое поведение

После запуска приложения первый переход к SSH, терминалу Pod или некоторым другим панелям иногда кратковременно заменяет весь интерфейс. Похожий эффект может появляться во время отдельных фоновых событий и обновлений.

### Найденная причина

В `App.tsx` один общий `Suspense` сейчас оборачивает почти весь `.app-shell`, включая:

- sidebar;
- topbar;
- resource tabs;
- основную таблицу;
- drawer;
- bottom terminal.

`PodDrawer`, `BottomTerminalPanel`, `ProblemsPanel`, `SettingsPanel` и другие панели загружаются через `React.lazy`. Если первый импорт любого такого chunk приостанавливает render, ближайший общий `Suspense` показывает единственный `.panel-loading`. В результате стабильный shell вместе с уже загруженной таблицей временно размонтируется/скрывается, хотя загружается только одна локальная панель.

Открытие SSH или Pod Terminal особенно часто проявляет проблему сразу после старта, потому что соответствующий lazy chunk ещё отсутствует в renderer cache.

### Новый контракт Suspense

Постоянный shell не должен находиться под fallback ленивой feature-панели.

Стабильными остаются:

- sidebar;
- topbar;
- resource navigation;
- открытая таблица;
- workspace layout;
- уже открытые drawer/terminal surfaces, не относящиеся к новому chunk.

Локальные `Suspense` boundaries размещаются непосредственно вокруг lazy surface:

- content panel для About/Help/Settings/Problems/Audit/Port Forwards;
- resource drawer;
- bottom terminal;
- Manifest Compare внутри YAML.

Fallback занимает только геометрию загружаемой области:

- drawer показывает skeleton/`Loading resource…` внутри drawer;
- bottom terminal показывает компактное loading-состояние в terminal panel;
- основная feature page показывает loading только в content panel;
- sidebar/topbar/table не исчезают;
- размеры workspace не должны схлопываться и повторно расширяться.

`LazyPanelBoundary` также локализуется вместе с соответствующей feature-панелью. Ошибка загрузки одного chunk не заменяет весь app shell.

Новый глобальный state manager, ручной dynamic-import registry и preload framework не добавляются.

### SSH и терминалы

- первый клик Terminal у Pod не скрывает resource table и drawer;
- открытие нижнего терминала сохраняет высоту и положение верхней области;
- переключение вкладки SSH у Node не пересоздаёт drawer chrome;
- подключение, reconnect, disconnect и terminal resize меняют только состояние terminal/SSH surface;
- xterm instance не размонтируется из-за unrelated loading или watch event;
- terminal fit/resize выполняется после появления локального panel, без полноэкранного layout jump.

Preload lazy chunks после первого idle допустим только как дополнительная оптимизация. Он не заменяет правильные локальные Suspense boundaries: на медленном диске или после обновления chunk всё равно должен загружаться локально.

### Фоновые события и refresh

Глобальный `loading` не должен очищать или заменять уже отображённые данные.

- watch refresh и interval refresh остаются silent;
- ручной refresh показывает состояние на локальной кнопке/таблице, сохраняя текущие rows до успешного ответа;
- открытие drawer использует собственный loading lifecycle;
- загрузка Details, Events, Related, YAML, Logs, SSH и terminal не меняет loading основной таблицы;
- обновление config/backend status не размонтирует workspace;
- stale response не переключает loading новой выбранной поверхности;
- при ошибке сохраняются последние успешно загруженные данные, если cluster всё ещё доступен.

Полноэкранное loading-состояние допустимо только до первой готовности самого renderer shell либо при действительно глобальном переходе, когда старый workspace больше невалиден. Обычная Kubernetes операция таким переходом не считается.

### Геометрия и CSS

- fallback получает размер родительской локальной области;
- не используется `display: none` для всего workspace во время запроса;
- loading overlay не изменяет ширину drawer и высоту bottom terminal;
- scrollbar не исчезает на один frame из-за замены всей страницы;
- focus не сбрасывается с таблицы/terminal при unrelated background refresh;
- prefers-reduced-motion соблюдается; маскировать layout reset анимацией запрещено.

### Цельная геометрия resource и terminal tabs

Активная сохранённая resource tab должна визуально быть верхней частью открытого drawer, а active bottom terminal tab — верхней частью своей terminal panel, как активные вкладки браузера.

Текущая проблема:

- `.resource-workspace-tabs` рисует общую нижнюю границу по всей ширине;
- active tab пытается перекрыть её через `margin-bottom: -1px` и `border-bottom-color`;
- тот же tab-strip использует `overflow-x: auto`;
- область переполнения может обрезать отрицательный выступ active tab;
- между активной вкладкой и drawer остаётся горизонтальный шов.

В terminal используется тот же неустойчивый приём:

- `.bottom-terminal-header` рисует общий `border-bottom`;
- `.bottom-terminal-tab.active` получает `margin-bottom: -1px`;
- `.bottom-terminal-tabs` имеет `overflow-x: auto`;
- линия остаётся между active terminal tab и controls/terminal body.

Новый контракт:

- под активной вкладкой общей горизонтальной линии нет;
- нижний фон active tab совпадает с фоном поверхности drawer;
- внешняя левая, верхняя и правая границы вкладки остаются видимыми;
- линия tab-strip продолжается слева/справа от active tab;
- drawer header начинается непосредственно от нижнего края active tab;
- active tab имеет корректный `z-index`, но не перекрывает текст/кнопки соседних tabs;
- hover/focus не возвращают нижнюю границу;
- переключение active tab переносит разрыв линии без скачка высоты;
- первая, средняя и последняя вкладки работают одинаково;
- горизонтальная прокрутка tabs не обрезает соединение;
- при единственной transient drawer без сохранённых tabs верхняя граница остаётся обычной.

Для terminal tabs дополнительно:

- под active terminal tab горизонтального шва нет;
- фон нижней границы tab совпадает с фоном terminal body/controls;
- baseline остаётся видимой под collapse control и свободной частью header;
- collapsed terminal сохраняет понятную нижнюю границу header;
- expand/collapse не возвращает двойную линию;
- переключение terminal sessions не сдвигает controls и xterm;
- active terminal tab не перекрывает resize/collapse controls.

Предпочтительная CSS-структура:

- scroll отвечает только внутренний контейнер с tabs;
- декоративная baseline рисуется отдельным слоем;
- active tab либо перекрывает baseline собственным нижним фоном, либо baseline состоит из участков вокруг active tab;
- отрицательный margin не является единственным механизмом соединения через overflow boundary.

Один общий CSS-подход применяется к resource и terminal strips. Не добавляются canvas, JS-измерение ширины вкладок или observer только ради рамки. Достаточно устойчивой CSS-геометрии с существующей DOM-структурой либо одним внутренним wrapper на strip.

Визуально active tab остаётся спокойной:

- без яркой заливки;
- без accent-линии снизу;
- без двойной рамки;
- с тем же muted surface, что drawer;
- неактивные tabs остаются легче active tab.

### Диагностика

Перед реализацией сценарий воспроизводится в production build с очищенным chunk cache:

1. запустить приложение;
2. открыть Pod;
3. впервые открыть Terminal;
4. открыть Node и впервые перейти в SSH;
5. дождаться watch refresh/reconnect;
6. записать React Profiler и Performance trace.

Проверяется именно unmount/remount стабильного shell, а не только количество React renders. Обычный render без изменения DOM/layout не считается морганием.

## 11. Производительность

### Namespaces

- O(1) команд относительно числа namespaces;
- не более одного `top pods` и одного `get resourcequota` на fresh request;
- форматирование и aggregation выполняются за O(N + Q), где N — строки metrics, Q — quota items;
- renderer не пересчитывает Kubernetes quantities на каждый tick.

### Nodes

- первая таблица не ждёт disk;
- одновременно не более 2 probes;
- отсутствует неограниченный `Promise.all`;
- cache не растёт бесконечно: очищается по cluster lifecycle и имеет TTL;
- один failed node не создаёт retry loop;
- при быстром переключении cluster/resource старые ответы не обновляют текущую таблицу.

### Pods

- сохраняется существующий единый `kubectl top pods` на выбранный namespace scope;
- requests/limits берутся из уже загруженного Pod JSON;
- дополнительные запросы на Pod или container не добавляются;
- effective limits вычисляются один раз при normalizer/enrichment;
- renderer не парсит Kubernetes quantities на каждый render;
- две полосы вместо двух текстовых колонок не увеличивают число DOM-узлов непропорционально размеру страницы.

### YAML folding

- fold regions вычисляются только при изменении YAML text;
- scroll, hover и selection не запускают повторный parse;
- один parse result переиспользуется для highlighting/folding там, где это не усложняет текущий renderer;
- folding работает линейно по числу YAML nodes/lines;
- свёрнутые строки не монтируются как отдельные visible line elements;
- manifests в несколько тысяч строк не создают state на каждую строку;
- Compare не перестраивает diff при каждом scroll/fold toggle: применяется visibility model к готовым diff rows.

## 12. Автоматические контракты

- [ ] Namespaces Usage рендерит CPU, RAM и Storage через общий `ResourceUsageBar`.
- [ ] Старый текст `CPU ...; RAM ...` больше не является содержимым ячейки.
- [ ] CPU/RAM namespace percentage считается относительно quota.
- [ ] Storage percentage считается по `ResourceQuota status.used / status.hard`.
- [ ] CPU/RAM без quota показывают `No quota`, сохраняя фактический used.
- [ ] Недоступный Metrics Server показывает `N/A`, а не `0%`.
- [ ] Storage quota продолжает работать без Metrics Server.
- [ ] CPU, memory и storage quantities форматируются правильными единицами.
- [ ] ResourceQuota aggregation не удваивает stable/scoped storage keys.
- [ ] Загрузка Namespaces использует фиксированное число общих команд.
- [ ] Nodes Usage показывает CPU, RAM и Disk.
- [ ] Первая загрузка Nodes не ждёт disk probes.
- [ ] Hidden Usage column не запускает disk probes.
- [ ] Одновременно выполняется не более 2 node disk probes.
- [ ] Загружаются только строки текущей страницы.
- [ ] Fresh cache предотвращает повторные probes после сортировки/фильтрации.
- [ ] Смена cluster/resource игнорирует устаревшие ответы.
- [ ] Ошибка одной ноды возвращает partial result и не ломает таблицу.
- [ ] Нет `Promise.all(rows.map(...stats/summary...))`.
- [ ] Node Disk использует существующий stats-summary parser/endpoint.
- [ ] Loading, `N/A` и stale states не показывают ложный процент.
- [ ] CPU, RAM и Disk/Storage имеют три различимых theme-aware цвета.
- [ ] Pods показывают CPU и RAM в одной колонке Usage.
- [ ] Отдельные текстовые CPU и Memory колонки Pods удалены из стандартного представления.
- [ ] Pod Disk не добавлен и не симулируется через ephemeral-storage requests.
- [ ] Pod usage percentage считается относительно effective limit.
- [ ] Request не используется как знаменатель полосы.
- [ ] Pod без limit показывает `No limit`, сохраняя фактический used.
- [ ] Pod без metrics показывает `N/A`, а не `0%`.
- [ ] Pending/completed Pod без строки `kubectl top` не получает ложный нулевой usage.
- [ ] Обычные container limits суммируются.
- [ ] Init container limits учитываются по effective Pod semantics.
- [ ] Pod overhead включается в effective requests/limits.
- [ ] Partial container limits не создают ложный общий Pod limit.
- [ ] Pod usage не добавляет Kubernetes-запросов сверх существующего `top pods`.
- [ ] Миграция Columns сохраняет намерение пользователя для старых CPU/Memory columns.
- [ ] Tooltip и `aria-label` объясняют источник и denominator.
- [ ] Колонка Namespaces сохраняет совместимость пользовательской настройки Columns.
- [ ] App shell не находится под fallback lazy feature-панелей.
- [ ] PodDrawer имеет локальный Suspense/error boundary.
- [ ] BottomTerminalPanel имеет локальный Suspense/error boundary.
- [ ] Lazy content pages загружаются внутри основной content area.
- [ ] Первый lazy render не скрывает sidebar, topbar и уже отображённую таблицу.
- [ ] Открытие Terminal/SSH не размонтирует стабильный drawer/workspace chrome.
- [ ] Background watch/interval refresh сохраняет текущие rows.
- [ ] Drawer/tab loading не изменяет global table loading.
- [ ] Ошибка lazy chunk остаётся локальной для соответствующей поверхности.
- [ ] Под активной resource tab отсутствует горизонтальный шов с drawer.
- [ ] Baseline tab-strip остаётся видимой только вне ширины active tab.
- [ ] Hover/focus active tab не восстанавливают нижнюю границу.
- [ ] Первая, средняя и последняя active tabs соединяются с drawer одинаково.
- [ ] Горизонтальный scroll tabs не обрезает нижнее соединение.
- [ ] Исправление tab seam не использует JS-измерение геометрии.
- [ ] Под active bottom terminal tab отсутствует шов с terminal panel.
- [ ] Terminal baseline остаётся видимой вне active tab.
- [ ] Expand/collapse terminal не создаёт двойную нижнюю линию.
- [ ] Переключение terminal sessions не сдвигает controls и xterm.
- [ ] Resource и terminal tabs используют один устойчивый CSS-подход к baseline.
- [ ] YAML fold regions строятся через установленный `yaml` parser, без regex-parser отступов.
- [ ] `metadata`, `spec`, `status`, nested maps и sequences получают fold controls.
- [ ] Scalars, `{}`, `[]` и block scalars не получают ложные fold controls.
- [ ] Folding не изменяет полный `yamlDraft`.
- [ ] Apply, Dry-run, Copy и Compare получают полный YAML при свёрнутых группах.
- [ ] Невалидный draft автоматически раскрывается и остаётся редактируемым.
- [ ] Начало редактирования безопасно раскрывает свёрнутые группы.
- [ ] Search находит текст внутри свёрнутой группы и раскрывает её.
- [ ] Reset/Reload пересчитывают regions и сохраняют folds по существующим paths.
- [ ] Переход к другому ресурсу не переносит чужой fold state.
- [ ] Collapse all сворачивает только верхнеуровневые groups.
- [ ] Fold buttons имеют tooltip, `aria-label`, `aria-expanded` и keyboard activation.
- [ ] Compare скрывает один общий aligned range в обеих panes.
- [ ] Compare сохраняет исходные line numbers после collapsed range.
- [ ] Added/removed/changed tones сохраняются на collapsed summary.
- [ ] Folding Compare не ломает synchronized vertical/horizontal scroll.
- [ ] Clean/Raw и смена target безопасно пересчитывают fold state.
- [ ] Большой YAML не парсится повторно на scroll/render без изменения текста.
- [ ] Добавить backend contracts для namespace quota aggregation.
- [ ] Добавить renderer contracts для трёх namespace bars.
- [ ] Добавить renderer/backend contract на bounded node disk queue и cache.
- [ ] Добавить normalizer contracts для Pod requests/limits, init containers и overhead.
- [ ] Добавить renderer contracts для двух Pod usage bars и состояний `No limit`/`N/A`.
- [ ] Добавить renderer contract на локальные Suspense boundaries.
- [ ] Добавить unit contracts для YAML fold regions, invalid YAML и nested sequences.
- [ ] Добавить renderer contracts для YAML gutter, full-draft safety и Compare alignment.
- [ ] Запустить `npm run lint`.
- [ ] Запустить `npm run format:check`.
- [ ] Запустить `npm run test:renderer`.
- [ ] Запустить `npm run typecheck`.
- [ ] Запустить `npm run build`.
- [ ] Запустить `npm --workspace apps/desktop run test:gateway`.
- [ ] Запустить `npm run verify:release`.
- [ ] Запустить `git diff --check`.

## 13. Ручной smoke

- [ ] Namespace с CPU/RAM quota показывает корректные проценты.
- [ ] Namespace без quota показывает used и `No quota`.
- [ ] Namespace без Pods показывает `0 used`, но не ложный quota.
- [ ] Недоступный Metrics Server показывает CPU/RAM `N/A`.
- [ ] Storage quota отображает MiB/GiB/TiB и точный tooltip.
- [ ] Несколько ResourceQuota в одном namespace корректно суммируются.
- [ ] Несколько storage-class quotas не учитываются дважды.
- [ ] Список Namespaces сохраняет плотность на узком drawer.
- [ ] Список Nodes сначала появляется с CPU/RAM, затем дозаполняет Disk.
- [ ] На странице из 200 Nodes одновременно нет более двух disk probes.
- [ ] Сортировка и фильтрация не повторяют свежие probes.
- [ ] Переключение страницы прекращает работу старой очереди.
- [ ] Переключение cluster во время загрузки не смешивает результаты.
- [ ] Нода с недоступным kubelet показывает Disk `N/A`.
- [ ] Повторный refresh обновляет stale disk value.
- [ ] Проверить три полосы во всех поддерживаемых темах.
- [ ] Pod с CPU/RAM limits показывает корректные проценты.
- [ ] Pod без limits показывает used и `No limit`.
- [ ] Pod с requests без limits не рисует процент от request.
- [ ] Pod с несколькими containers использует сумму limits.
- [ ] Pod с init containers использует effective Pod limit.
- [ ] Pod с overhead корректно включает его в tooltip и denominator.
- [ ] Pending и Completed Pods без metrics показывают `N/A`.
- [ ] Недоступный Metrics Server не очищает Pod rows.
- [ ] Проверить миграцию сохранённых CPU/Memory Columns в Usage.
- [ ] Проверить сортировку/фильтрацию Pods после объединения колонок.
- [ ] Проверить две полосы Pods во всех поддерживаемых темах.
- [ ] Проверить mouse и keyboard tooltips.
- [ ] Сравнить CPU и время первого отображения Nodes с 2.7.6.
- [ ] После чистого запуска впервые открыть Pod Terminal без моргания sidebar/topbar/table.
- [ ] После чистого запуска впервые открыть Node SSH без моргания всего drawer/workspace.
- [ ] Открыть About, Help, Settings, Problems, Audit и Port Forwards впервые.
- [ ] На медленном lazy chunk убедиться, что fallback виден только внутри целевой панели.
- [ ] Во время watch event убедиться, что текущие rows и scroll position сохраняются.
- [ ] Во время interval refresh убедиться, что таблица не очищается и не схлопывается.
- [ ] Во время ручного refresh убедиться, что моргает только локальный progress action.
- [ ] Оставить активный xterm и вызвать unrelated refresh: terminal не размонтируется.
- [ ] Проверить отсутствие layout shift при открытии и закрытии bottom terminal.
- [ ] Повторить сценарии в development и production build на macOS и Windows.
- [ ] Проверить соединение active resource tab с drawer без горизонтального шва.
- [ ] Переключить первую, среднюю и последнюю вкладки.
- [ ] Проверить hover, focus-visible и close button активной вкладки.
- [ ] Открыть достаточно вкладок для горизонтального scroll tab-strip.
- [ ] Проверить соединение при минимальной и максимальной ширине drawer.
- [ ] Проверить active tab во всех поддерживаемых темах.
- [ ] Проверить соединение active bottom terminal tab с terminal controls/body.
- [ ] Переключить первую, среднюю и последнюю terminal tab.
- [ ] Проверить horizontal scroll при большом числе terminal sessions.
- [ ] Свернуть и раскрыть bottom terminal без появления двойной линии.
- [ ] Проверить terminal tab seam при изменении высоты панели.
- [ ] Проверить terminal tabs во всех поддерживаемых темах.
- [ ] Свернуть и раскрыть верхнеуровневые `metadata`, `spec` и `status`.
- [ ] Свернуть nested `spec.template.spec.containers` и `volumes`.
- [ ] Проверить sequence из нескольких containers/conditions.
- [ ] Проверить CRD с глубоко вложенными maps и sequences.
- [ ] Проверить `{}`, `[]`, multiline `|`/`>` и комментарии.
- [ ] Проверить невалидный YAML во время набора: данные и caret не теряются.
- [ ] Свернуть группу, затем выполнить Dry-run и Apply полного manifest.
- [ ] Свернуть группу и убедиться, что Copy копирует скрытые строки.
- [ ] Найти текст внутри свёрнутой группы через Find in YAML.
- [ ] Проверить Collapse all / Expand all и keyboard activation.
- [ ] Переключить Summary → YAML и сохранить folds в текущем drawer.
- [ ] Reload/Reset YAML с сохранёнными и удалёнными paths.
- [ ] Открыть другой ресурс и убедиться, что folds не протекли.
- [ ] В Compare свернуть одинаковую группу с changed строками.
- [ ] В Compare свернуть группу, существующую только с одной стороны.
- [ ] Проверить aligned line numbers и diff tones после раскрытия.
- [ ] Проверить synchronized scroll при нескольких collapsed ranges.
- [ ] Переключить Clean/Raw и другой target.
- [ ] Проверить YAML на 5000+ строк без заметной задержки при scroll.
- [ ] Проверить folding мышью и клавиатурой во всех темах.

## 14. Релиз 2.8.0

- [x] После реализации поднять root, desktop, shared-types и lockfile до `2.8.0`.
- [x] Добавить `RELEASE_NOTES_2.8.0.md`.
- [x] Добавить `REGRESSION_CHECKLIST_2.8.0.md`.
- [x] Обновить README и `NODE_MIGRATION_PROGRESS.md`.
- [x] Сохранить Node-only baseline Node 51 / Python 0.
- [x] Не добавлять chart library, virtualized table или новый state manager.

## Не входит в 2.8.0

- фактическое filesystem usage для Namespace;
- распределение Namespace usage по отдельным Pods/containers;
- фактическое filesystem/ephemeral-storage usage Pods;
- исторические графики;
- alerts и настраиваемые thresholds;
- storage telemetry через Prometheus;
- полноценное редактирование видимых участков textarea при одновременно свёрнутых соседних группах;
- замена текущего YAML editor на Monaco/CodeMirror;
- сохранение fold state между запусками приложения;
- замена Metrics Server;
- виртуализация всех resource tables;
- отдельная страница capacity planning.

## Критерий готовности

Namespaces, Nodes и Pods используют один компактный визуальный язык ресурсов. В Namespaces видны CPU, RAM и Storage quota, в Nodes — CPU, RAM и фактический Disk, в Pods — CPU и RAM относительно effective limits. Отсутствие quota/limit и отсутствие metrics визуально и семантически различаются.

Список Namespaces сохраняет O(1) количество Kubernetes-команд. Список Nodes появляется без ожидания disk metrics, загружает disk только для текущей страницы с ограничением не более двух параллельных probes и не возвращает массовую нагрузку, устранённую в 2.7.6.

Первое открытие SSH, Pod Terminal и любой другой lazy feature-панели не заменяет весь интерфейс общим fallback. Sidebar, topbar, таблица, drawer chrome и уже открытые terminal sessions сохраняют DOM, размеры, scroll и focus во время локальной загрузки и фоновых Kubernetes-событий.

Все полноценные YAML manifests поддерживают безопасное сворачивание maps и sequences. Folding никогда не меняет полный draft, не скрывает данные от Apply/Dry-run/Copy, остаётся доступным с клавиатуры и сохраняет строгое построчное выравнивание Manifest Compare.

Активные resource и bottom terminal tabs визуально соединены со своими drawer/panel без горизонтального шва: общая baseline продолжается только вне активной вкладки, а сама вкладка воспринимается частью открытой поверхности.
