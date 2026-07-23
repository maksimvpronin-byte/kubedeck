# KubeDeck 2.7.6 — выровненный Compare, производительные Nodes и читаемые ресурсы

Статус: реализовано и автоматически проверено 23 июля 2026 года. Ручной smoke из раздела 14 остаётся открытым.

## Проблема

В `Compare manifests` левый и правый manifests строятся из общего массива diff-строк, но начало code panes визуально не совпадает.

Над каждым pane находится отдельный заголовок ресурса. Длинный label слева или справа переносится на дополнительную строку и увеличивает только свою колонку. В результате:

- одинаковые diff-строки начинаются на разной высоте;
- номера и цветные change-блоки визуально перестают совпадать;
- сравнение выглядит сломанным, хотя данные diff выровнены;
- каждое code pane прокручивается отдельно, поэтому при чтении пользователь вручную ищет соответствующую строку во втором окне.

Отдельная проблема проявляется в кластерах с большим количеством Nodes. Текущий `applyNodeMetrics` выполняет:

1. один общий `kubectl top nodes`;
2. затем отдельный `kubectl get --raw=/api/v1/nodes/{name}/proxy/stats/summary` для каждой ноды;
3. все per-node команды запускаются одновременно через неограниченный `Promise.all`;
4. HTTP-ответ списка ожидает завершения всех disk probes.

При росте количества нод это создаёт N дополнительных процессов `kubectl`, нагрузку на CPU и API server, а также задерживает первое отображение всего списка ради disk-информации, которая в таблице Nodes не показывается.

## Цель 2.7.6

Оба manifests должны восприниматься как две синхронные стороны одного diff:

1. code panes начинаются на одной высоте;
2. одна diff-строка всегда находится напротив соответствующей строки второй стороны;
3. прокрутка любого pane перемещает второй pane в ту же позицию;
4. длинная информация о ресурсе не изменяет высоту только одной стороны;
5. существующие Clean/Raw, chooser, цвета и номера строк сохраняются.
6. список Nodes быстро появляется при большом количестве нод и не запускает отдельный disk probe для каждой строки.
7. CPU и RAM Nodes читаются графически и различаются цветом.
8. ResourceQuota автоматически показывает memory/storage в подходящих KiB, MiB или GiB вместо сырых Kubernetes quantities.
9. Delete Pod по умолчанию принудительно удаляет зависший Pod без ожидания grace period.
10. Deployment и ReplicaSet показывают понятное операционное состояние и причину деградации.
11. Labels в списке Nodes отображаются компактно и понятным администратору языком.

## Границы патча

- Меняется только layout и scroll-поведение `ManifestCompare`.
- Существующие `cleanManifest`, `buildManifestDiff` и API загрузки YAML не меняются.
- Новый diff editor, виртуализация и внешняя dependency не добавляются.
- Синхронизация работает на существующих DOM scroll containers через refs.
- Масштабирование строк, перенос YAML-кода и редактирование manifests не входят в 2.7.6.
- Chooser 2.7.5 и его клавиатурное поведение не перерабатываются.
- Общий resource table, pagination и остальные типы ресурсов не переписываются.
- Виртуализация таблицы и новая dependency не добавляются до измерения результата backend-исправления.
- Для resource bars используется обычный CSS; chart library не добавляется.
- Форматирование ResourceQuota не меняет исходные значения, расчёт ratio, сортировку и warning/danger thresholds.
- Force delete применяется только к Pod и не меняет удаление Deployment, Service, PVC, Secret и других ресурсов.
- Health Deployment/ReplicaSet вычисляется из уже полученного объекта и не запускает дополнительные запросы Pods/Events для каждой строки.
- Представление Node Labels меняется только визуально; исходные ключи и значения Kubernetes не модифицируются.

## 1. Единая геометрия заголовков

Независимые `<strong>` над левым и правым code pane заменяются общей строкой context внутри `.manifest-compare-grid`.

Рекомендуемая структура:

1. левая context cell;
2. правая context cell;
3. левый code pane;
4. правый code pane.

Обе context cells находятся в одной CSS grid row, поэтому высота строки определяется более высоким содержимым сразу для обеих сторон.

Компактный вариант отображения:

- основная строка содержит только resource name;
- вторичный cluster/namespace context не должен создавать дополнительную высоту одной колонки;
- полный context остаётся доступен через `title`/tooltip;
- длинный видимый label сокращается через `text-overflow: ellipsis`;
- `Unsaved` показывается компактным badge рядом с именем, а не отдельной строкой;
- до выбора target правая cell показывает `Select target`;
- во время загрузки правая cell показывает `Loading manifest…`.

Если chooser уже однозначно показывает полный context правого ресурса, дублировать сверху над pane полный `cluster · namespace/name` не требуется. Над pane достаточно короткого имени с полным значением в tooltip.

## 2. Совпадение diff-строк

`buildManifestDiff` уже возвращает общий `ManifestDiffRow[]` для обеих сторон. Этот контракт сохраняется:

- каждый индекс массива создаёт одну визуальную строку слева и справа;
- отсутствующая строка остаётся пустой строкой той же высоты;
- line-height, padding и border у обеих сторон одинаковы;
- YAML-код не переносится на следующую визуальную строку;
- длинная строка получает горизонтальную прокрутку, а не увеличивает высоту;
- changed/added/removed backgrounds занимают одинаковую высоту на обеих сторонах.

Отдельное повторное сопоставление строк после `buildManifestDiff` не добавляется.

## 3. Связанная прокрутка

Оба `.manifest-diff-code` получают refs.

При `scroll` любого pane:

- второй pane получает такой же `scrollTop`;
- горизонтальная позиция также синхронизируется через `scrollLeft`;
- источником может быть как левое, так и правое окно;
- wheel, scrollbar, trackpad и клавиатурная прокрутка дают одинаковый результат;
- программное обновление второго pane не создаёт бесконечный цикл scroll events;
- синхронизация не вызывает React state update на каждый scroll.

Минимальная реализация:

- refs на два scroll elements;
- общий обработчик `syncScroll(source, target)`;
- короткий guard через `requestAnimationFrame` либо ref-флаг только против обратного программного события;
- прямое присваивание `target.scrollTop` и `target.scrollLeft`.

Поскольку обе стороны используют один массив строк и одинаковый line-height, вертикальная позиция синхронизируется абсолютным `scrollTop`, а не приблизительным процентом.

## 4. Состояния

### Target не выбран

- слева отображается current manifest;
- справа остаются пустые строки существующего preview;
- context row сохраняет одинаковую высоту;
- прокрутка не падает при пустом правом pane.

### Загрузка и ошибка

- `Loading manifest…` и текст ошибки не вставляются внутрь code pane;
- появление или исчезновение состояния не сдвигает только одну сторону;
- старый target YAML по-прежнему не показывается;
- после успешной загрузки оба pane возвращаются к началу либо к явно сохранённой общей позиции.

Предпочтительно при выборе нового target сбрасывать оба pane в `scrollTop = 0` и `scrollLeft = 0`, чтобы новый diff не открывался на позиции предыдущего сравнения.

### Clean/Raw

- после переключения diff перестраивается как сейчас;
- оба pane сбрасываются к общей начальной позиции;
- связанная прокрутка продолжает работать без повторной регистрации обработчиков.

## 5. Responsive layout

На ширине, где panes стоят рядом:

- context cells и code panes используют одни и те же две grid columns;
- граница между колонками визуально совпадает сверху вниз;
- оба code panes получают одинаковую доступную высоту.

На узкой ширине, где panes расположены друг под другом:

- каждый context label остаётся непосредственно над своим pane;
- синхронизация scroll сохраняется, если оба pane имеют независимую прокрутку;
- layout не создаёт общий горизонтальный scroll modal;
- высота panes остаётся достаточной для чтения.

## 6. Доступность

- каждый pane сохраняет `role="region"` и `tabIndex={0}`;
- panes получают различимые `aria-label`, например `Current manifest` и `Compared manifest`;
- короткие видимые labels не лишают пользователя полного resource context: он доступен в `title`;
- клавиатурная прокрутка сфокусированного pane синхронизирует второй pane;
- focus ring остаётся видимым и не меняет размеры layout.

## 7. Производительность списка Nodes

### Причина

Основной bottleneck находится не в JSX таблицы, а в backend enrichment:

- `applyNodeMetrics` ждёт `rows.length` отдельных stats summary запросов;
- `Promise.all(rows.map(...))` не ограничивает конкуренцию;
- каждый probe создаёт отдельный процесс `kubectl`;
- disk metrics не используются в строке таблицы, но блокируют весь resource-list response.

### Контракт списка

Загрузка списка Nodes должна выполнять фиксированное количество команд, не зависящее от числа нод:

1. существующий `kubectl get nodes -o json`;
2. существующий единый `kubectl top nodes --no-headers`.

Из `applyNodeMetrics` удаляется массовый цикл `/proxy/stats/summary`.

Результат:

- базовые строки Nodes могут отображаться сразу после двух общих запросов;
- CPU/RAM Usage продолжает заполняться из одного `kubectl top nodes`;
- отсутствие Metrics Server остаётся допустимым и не ломает список;
- сортировка, фильтрация, labels, status и Kubernetes version сохраняются;
- количество запущенных `kubectl` для списка не растёт вместе с количеством нод.

### Disk только для открытой ноды

Disk usage нужен в Summary выбранной Node, поэтому он загружается лениво только после открытия drawer конкретной ноды:

- выполняется один stats summary запрос для выбранного node name;
- список Nodes не ожидает этот запрос;
- loading/error disk metrics локальны для Node Summary и не очищают остальные facts;
- переключение на другую ноду не позволяет старому ответу перезаписать новую Summary;
- закрытие drawer прекращает либо игнорирует устаревший запрос;
- обычный refresh списка не запускает disk probes всех нод.

Предпочтительный минимальный путь — переиспользовать существующий resource-details lifecycle и generation guard. Отдельный глобальный metrics store и сложный cache в 2.7.6 не добавляются. Короткий cache допустим только при наличии уже подходящего backend cache-контракта.

### Renderer

Таблица уже использует pagination и рендерит только текущую страницу. До профилирования после удаления N backend probes не добавляются:

- windowing/virtualization;
- Web Worker;
- новый table component;
- memoization каждой ячейки;
- отдельный state manager.

После backend-исправления проверяется React Profiler. Если CPU остаётся высоким именно в renderer:

- `useUiClock` не должен обновлять Nodes каждую секунду ради возраста в днях;
- clock interval выбирается не чаще минимально необходимой точности;
- скрытая колонка Age не должна запускать clock;
- фильтрация и сортировка не пересчитываются при неизменившихся rows/query/sort.

Это второй этап только при подтверждённом renderer bottleneck.

### Измеримый результат

Проверка выполняется минимум на synthetic/fixture списках из 100, 500 и 1000 Nodes:

- число disk stats commands при загрузке списка: `0`;
- число `kubectl top nodes`: не более `1` на fresh list request;
- открытие одной Node Summary: не более `1` disk stats command;
- первая таблица не ждёт disk metrics;
- отсутствует одновременный запуск сотен дочерних процессов;
- время ответа и CPU сравниваются с baseline до патча.

Жёсткий миллисекундный SLA не фиксируется без одинакового тестового окружения. Контрактом является O(1) количество backend-команд списка вместо O(N).

## 8. Визуализация ресурсов Nodes

Текущая строка Usage выводит CPU и RAM как длинный числовой текст `used · free`. При большом списке такие значения трудно сравнивать взглядом.

### Представление

В колонке Usage отображаются две компактные строки:

1. `CPU` и progress bar;
2. `RAM` и progress bar.

Контракт:

- заполненная часть означает used;
- незаполненная часть означает free до allocatable;
- CPU и RAM используют разные theme-aware цвета;
- цвет CPU одинаков во всех Node surfaces;
- цвет RAM одинаков во всех Node surfaces и заметно отличается от CPU;
- label `CPU` / `RAM` остаётся видимым, поэтому цвет не является единственным способом различения;
- постоянный длинный текст `74m used · 1926m free` из таблицы убирается;
- точные `used`, `free`, `allocatable` и процент доступны в tooltip;
- fill ограничивается диапазоном `0–100%`;
- при недоступных metrics показывается нейтральный empty track и `N/A`, а не `0%`;
- две строки имеют одинаковую ширину и не увеличивают высоту остальных колонок чрезмерно.

Для CPU процент считается относительно allocatable CPU. Для RAM — относительно allocatable memory. Готовые backend percentage используются только если они соответствуют тому же denominator; иначе процент вычисляется из уже нормализованных used/allocatable.

В Node Summary CPU и Memory используют то же графическое представление и те же цвета. Disk может использовать отдельный нейтральный/третий theme token. Числовые значения остаются в tooltip и доступном описании.

Минимальная реализация переиспользует один небольшой resource usage bar внутри существующего renderer. Отдельные компоненты для CPU, RAM и Disk не создаются.

### Доступность

- bar имеет `role="progressbar"` только при известном проценте;
- задаются `aria-valuemin`, `aria-valuemax`, `aria-valuenow` и понятный `aria-label`;
- при отсутствии metrics используется текстовое `N/A`;
- warning не определяется одним цветом CPU или RAM: resource color показывает тип, а не состояние ошибки;
- контраст fill и track проверяется во всех поддерживаемых темах.

## 9. Автоматические единицы ResourceQuota

ResourceQuota сейчас выводит `used / hard` в исходном Kubernetes-формате, например `574984Ki`, хотя значение уже достаточно велико для MiB. Для memory и storage quantities применяется тот же принцип человекочитаемого форматирования, который уже используется в Node metrics.

### Правила

- меньше `1 KiB` — bytes;
- от `1 KiB` до `1 MiB` — KiB;
- от `1 MiB` до `1 GiB` — MiB;
- от `1 GiB` до `1 TiB` — GiB;
- от `1 TiB` — TiB;
- значение округляется максимум до двух знаков после запятой;
- незначащие нули удаляются: `1.00 GiB` → `1 GiB`;
- `used` и `hard` форматируются независимо;
- `0` остаётся `0`;
- исходные точные Kubernetes quantities остаются в tooltip.

Примеры:

- `1024Ki` → `1 MiB`;
- `1536Ki` → `1.5 MiB`;
- `574984Ki` → `561.51 MiB`;
- `1024Mi` → `1 GiB`;
- `1536Mi` → `1.5 GiB`;
- `2Gi` → `2 GiB`.

Форматирование применяется только к byte-based resources:

- `limits.memory`;
- `requests.memory`;
- `limits.ephemeral-storage`;
- `requests.ephemeral-storage`;
- `requests.storage`;
- другим quota resource names, содержащим `memory` или `storage`.

CPU quantities сохраняют Kubernetes-смысл cores/millicores и не преобразуются в bytes. Счётчики `pods`, `services`, `secrets`, `configmaps`, PVC и другие object counts остаются целыми числами без единиц.

Расчёт процента использует числовое значение исходных quantities, а не округлённый display text. Сортировка и пороги 80%/95% не меняются.

Предпочтительно переиспользовать или минимально выделить существующий quantity/bytes formatter вместо второй независимой таблицы коэффициентов.

## 10. Принудительное удаление Pod по умолчанию

В Kubernetes отдельный контейнер не является удаляемым API-ресурсом: для остановки зависших контейнеров удаляется весь Pod. Поэтому существующее действие `Delete` для ресурса Pod становится force delete.

### Команда

Для одиночного и bulk удаления Pod action plan использует:

`kubectl delete pods <name> --force --grace-period=0 --wait=false -n <namespace>`

Контракт:

- `--force` и `--grace-period=0` добавляются только для `pods` / `pod`;
- `--wait=false` сохраняется, чтобы UI не зависал в ожидании окончательного удаления;
- namespace и name по-прежнему передаются отдельными аргументами без shell interpolation;
- обычное удаление остальных resource kinds не получает force flags;
- `Restart pod`, если это отдельный action, не меняется неявно: force применяется только к подтверждённому Delete;
- bulk delete Pods использует тот же backend action plan, а не отдельную командную реализацию;
- существующая RBAC-проверка `delete` для Pods сохраняется;
- cache invalidation, audit event и обновление таблицы выполняются как после обычного удаления.

### Подтверждение и последствия

Force delete остаётся destructive action и требует существующего подтверждения.

Текст подтверждения для Pod явно сообщает:

- Pod будет удалён немедленно без graceful shutdown;
- процессы контейнеров на недоступной ноде могут фактически продолжать работать до восстановления node/kubelet;
- Deployment, StatefulSet, DaemonSet, Job или другой controller может автоматически создать replacement Pod;
- standalone Pod автоматически не восстановится;
- действие нельзя отменить из KubeDeck.

Command preview показывает оба force flags. Для bulk удаления предупреждение показывается один раз вместе с количеством и списком Pods.

Новая настройка, дополнительный dropdown `Grace period` и второй action `Force delete` в 2.7.6 не добавляются: пользователь запросил force как стандартное поведение Pod Delete.

### Ошибки

- ошибка RBAC не маскируется как успешное удаление;
- частичный результат bulk delete сохраняет список failed Pods;
- Pod удаляется из локального списка только после успешного ответа action;
- команда, stderr и audit metadata не содержат Secret values;
- повторный клик во время активного запроса не запускает дублирующее удаление.

## 11. Conditions Deployment и ReplicaSet в стиле Lens

Сейчас таблица показывает только replica counters. В колонке `Status` нужно отображать одновременно все значимые Kubernetes conditions, как в Lens, а не сворачивать их в один искусственный label.

Примеры:

- `Available` — зелёный;
- `Available` + `Progressing` — зелёный и синий;
- `Available` + `ReplicaFailure` — зелёный и красный;
- `ReplicaFailure` — красный.

Одновременные `Available` и `ReplicaFailure` не считаются противоречием: Kubernetes может сообщать, что часть реплик доступна, но создание новых реплик завершилось ошибкой. UI обязан показать обе conditions.

### Представление в таблице

Для Deployment и ReplicaSet колонка `Status` содержит компактную строку condition labels:

- один label на каждую значимую condition;
- labels располагаются inline и не растягивают высоту строки;
- `Available` использует success tone;
- `Progressing` использует спокойный info/blue tone;
- `ReplicaFailure` использует danger/red tone;
- `Terminating` использует warning tone и показывается первым;
- неизвестная condition использует neutral tone;
- reason/message каждой condition доступны в tooltip;
- полный набор conditions доступен через `aria-label`;
- counters `Ready`, `Updated`, `Available` сохраняются отдельными колонками.

Labels не получают тяжёлую pill-рамку. Это цветной текст либо очень лёгкий badge, визуально близкий к примеру Lens.

### Какие conditions показывать

Основой является полный `status.conditions`, а не только conditions со `status !== "True"`.

Правила:

- condition со `status="True"` показывается своим type;
- `Available=True` → `Available`;
- `Progressing=True` → `Progressing`;
- `ReplicaFailure=True` → `ReplicaFailure`;
- `Progressing=False` с reason `ProgressDeadlineExceeded` показывается как `ProgressDeadlineExceeded` danger tone;
- `Available=False` с reason `MinimumReplicasUnavailable` показывается как `Unavailable` warning/danger tone;
- `ReplicaFailure=False` не показывается как активная ошибка;
- condition с `status="Unknown"` может показываться neutral, если она операционно значима;
- одинаковые condition types не дублируются.

Если conditions отсутствуют:

- `metadata.deletionTimestamp` → `Terminating`;
- desired `0` → `Scaled to zero`;
- новый workload с неготовыми counters → `Progressing`;
- полностью готовые counters → `Available`;
- иначе → `Unknown`.

Derived fallback используется только при отсутствии достаточных Kubernetes conditions и не заменяет реальные labels.

### Порядок labels

Для стабильной геометрии:

1. `Terminating`;
2. `ReplicaFailure` / `ProgressDeadlineExceeded`;
3. `Unavailable`;
4. `Available`;
5. `Progressing`;
6. остальные conditions по type.

Порядок не зависит от порядка массива, возвращённого API server.

### Данные и tooltip

Normalizer сохраняет для каждой condition:

- `type`;
- `status`;
- `reason`;
- `message`;
- `lastUpdateTime`;
- `lastTransitionTime`.

Tooltip label содержит reason и короткий message. Длинный message не попадает непосредственно в строку таблицы. Replica summary добавляется в общий tooltip колонки:

`Ready 2/3 · Updated 2 · Available 2`

Фильтр ищет по type, reason и message, поэтому запросы `ReplicaFailure`, `FailedCreate` и `ProgressDeadlineExceeded` находят проблемные workloads.

### Summary

В Summary Deployment/ReplicaSet отображается тот же набор condition labels и:

- `Ready / Desired`;
- Updated;
- Available;
- reason;
- короткий condition message.

Ошибка не скрывается за зелёным `Available`: `Available` и `ReplicaFailure` видны одновременно. YAML и Describe остаются источником полного condition history.

### Производительность

Conditions нормализуются во время существующего `kubectl get ... -o json`:

- без отдельного запроса Pods;
- без Events request для каждой строки;
- без таймеров на каждую строку;
- O(N) по числу workload objects;
- один общий formatter используется Deployment и ReplicaSet.

## 12. Понятные Labels в списке Nodes

Сырая строка `labelsText` плохо читается: длинные доменные ключи занимают всю колонку, а полезные topology/role labels теряются среди служебных значений.

### Компактное представление

Колонка `Labels` для Nodes отображает небольшое количество спокойных inline chips:

- без яркой отдельной рамки, перетягивающей внимание с имени и Status;
- максимум 3 основных labels в строке;
- остальные сворачиваются в `+N`;
- полный список доступен в tooltip/focus popover;
- длинные значения сокращаются через ellipsis;
- высота строки таблицы остаётся стабильной.

Chips используют формат `Понятное имя: значение`.

Приоритет известных labels:

1. `node-role.kubernetes.io/control-plane` / `master` / `worker` → `Role`;
2. `topology.kubernetes.io/region` → `Region`;
3. `topology.kubernetes.io/zone` → `Zone`;
4. `node.kubernetes.io/instance-type` → `Type`;
5. `kubernetes.io/os` → `OS`;
6. `kubernetes.io/arch` → `Arch`;
7. `kubernetes.io/hostname` → `Hostname`, если значение отличается от имени Node;
8. пользовательские labels.

Устаревшие стабильные/beta aliases нормализуются для показа:

- `failure-domain.beta.kubernetes.io/region` → `Region`;
- `failure-domain.beta.kubernetes.io/zone` → `Zone`;
- `beta.kubernetes.io/instance-type` → `Type`;
- `beta.kubernetes.io/os` → `OS`;
- `beta.kubernetes.io/arch` → `Arch`.

Если stable и legacy label задают одно и то же значение, показывается один chip. Stable key имеет приоритет.

### Пользовательские labels

Для неизвестного ключа:

- DNS prefix визуально убирается, если короткое имя остаётся однозначным: `example.com/team=platform` → `team: platform`;
- полный `key=value` всегда доступен в tooltip;
- если два ключа имеют одинаковый suffix, отображается достаточно prefix, чтобы различать их;
- label с пустым значением показывается как булевый chip без искусственного `=`;
- порядок детерминирован: известные labels по приоритету, затем пользовательские по полному ключу.

### Поиск, сортировка и доступность

- фильтр продолжает искать по полному исходному key, короткому display name и value;
- скрытые за `+N` labels также участвуют в поиске;
- сортировка колонки остаётся детерминированной по нормализованному полному набору labels, а не только по первым трём chips;
- контейнер chips имеет `aria-label` с полным списком;
- `+N` доступен с клавиатуры и раскрывает/показывает полный список;
- цвет не несёт отдельного Kubernetes-смысла и не является единственным источником информации.

### Производительность

Display labels вычисляются один раз при существующей нормализации Node либо memoized по `row.labels`. Нельзя:

- повторно сортировать весь label map на каждый renderer tick;
- создавать popover/state для каждой строки заранее;
- выполнять дополнительные Kubernetes API calls;
- добавлять отдельную библиотеку chips/tag cloud.

Тестовый набор включает Nodes с 0, 3, 20 и 100 labels.

## 13. Автоматические контракты

- [ ] `buildManifestDiff` остаётся единственным источником выровненных строк.
- [ ] Заголовки обоих manifests находятся в одной CSS grid row.
- [ ] Длинный label не увеличивает высоту только одного pane.
- [ ] Полный resource context доступен в tooltip.
- [ ] Оба panes имеют refs и различимые `aria-label`.
- [ ] Scroll левого pane обновляет правый `scrollTop` и `scrollLeft`.
- [ ] Scroll правого pane обновляет левый `scrollTop` и `scrollLeft`.
- [ ] Программный scroll не создаёт бесконечный цикл.
- [ ] Scroll handler не обновляет React state.
- [ ] Выбор нового target сбрасывает общую scroll position.
- [ ] Clean/Raw сбрасывает общую scroll position.
- [ ] Пустой target и ошибка загрузки не ломают синхронизацию.
- [ ] Существующие chooser и diff tone contracts продолжают проходить.
- [ ] Обновить renderer contract для Manifest Compare.
- [ ] `applyNodeMetrics` не содержит per-node `Promise.all(rows.map(...))`.
- [ ] Загрузка списка Nodes не вызывает `/proxy/stats/summary`.
- [ ] Один list request вызывает не более одного `kubectl top nodes`.
- [ ] CPU/RAM Usage сохраняется при доступном Metrics Server.
- [ ] Ошибка Metrics Server не блокирует базовый список Nodes.
- [ ] Disk stats загружается только для выбранной ноды.
- [ ] Устаревший disk response не обновляет другую открытую ноду.
- [ ] Добавить gateway contract на 100+ Nodes без N дополнительных команд.
- [ ] Сохранить renderer pagination contract для большого списка.
- [ ] Node Usage показывает отдельные CPU и RAM bars.
- [ ] CPU и RAM используют разные theme-aware colors.
- [ ] Bars показывают used относительно allocatable и ограничены `0–100%`.
- [ ] Точные used/free/allocatable доступны в tooltip и aria-label.
- [ ] Недоступные metrics показывают `N/A`, а не ложный `0%`.
- [ ] Node Summary переиспользует те же resource colors.
- [ ] ResourceQuota переводит byte quantities через пороги KiB/MiB/GiB/TiB.
- [ ] `1024Ki`, `1536Ki`, `1024Mi` и `1536Mi` форматируются согласно примерам.
- [ ] CPU quantities и object counts не получают byte units.
- [ ] Ratio считается по исходным quantities до округления display text.
- [ ] Полные исходные `used / hard` доступны в tooltip.
- [ ] Pod Delete plan содержит `--force`, `--grace-period=0` и `--wait=false`.
- [ ] Force flags отсутствуют в Delete plan остальных resource kinds.
- [ ] Pod Restart не получает force flags как побочный эффект.
- [ ] Одиночное и bulk удаление Pods используют один backend action contract.
- [ ] Confirmation и command preview явно показывают force delete.
- [ ] RBAC denial и partial bulk failure сохраняют существующее поведение.
- [ ] Обновить `resource-actions.contract.test.cjs` для force Pod Delete.
- [ ] Deployment и ReplicaSet показывают одновременно все активные значимые conditions.
- [ ] `Available` и `ReplicaFailure` могут отображаться одновременно.
- [ ] `Available=True` получает success tone.
- [ ] `Progressing=True` получает info/blue tone.
- [ ] `ReplicaFailure=True` / `FailedCreate` получает danger tone.
- [ ] `ProgressDeadlineExceeded` и `MinimumReplicasUnavailable` не скрываются.
- [ ] Conditions со `status=False` не показываются как активные, кроме явного failure reason.
- [ ] Порядок labels детерминирован и не зависит от порядка API.
- [ ] Fallback labels используются только при отсутствии достаточных conditions.
- [ ] Фильтр находит workloads по condition type, reason и message.
- [ ] Tooltip содержит condition reason/message и replica summary.
- [ ] Summary показывает тот же набор labels без дополнительных per-row API requests.
- [ ] Добавить normalizer contracts для комбинаций Deployment/ReplicaSet conditions.
- [ ] Node Labels показывают максимум 3 chips и индикатор `+N`.
- [ ] Role, Region, Zone, Type, OS и Arch получают понятные display names.
- [ ] Stable и beta aliases не создают дублирующие chips.
- [ ] Hostname скрывается, если совпадает с Node name.
- [ ] Пользовательский DNS prefix сокращается только при сохранении однозначности.
- [ ] Полный исходный `key=value` доступен в tooltip/aria-label.
- [ ] Фильтр находит labels, скрытые за `+N`, по key и value.
- [ ] Сортировка использует полный нормализованный набор labels.
- [ ] Nodes с 100 labels не создают 100 постоянно смонтированных интерактивных controls.
- [ ] Добавить renderer/normalizer contracts для Node label presentation.
- [ ] Запустить `npm run test:renderer`.
- [ ] Запустить `npm run typecheck`.
- [ ] Запустить `npm run lint`.
- [ ] Запустить `npm run format:check`.
- [ ] Запустить `npm run build`.
- [ ] Запустить `npm --workspace apps/desktop run test:gateway`.
- [ ] Запустить `npm run verify:release`.
- [ ] Запустить `git diff --check`.

## 14. Ручной smoke

Автоматические контракты раздела 13 реализованы. Проверено:

- `npm run lint`;
- `npm run format:check`;
- `npm run test:renderer` — 46/46;
- `npm run typecheck`;
- `npm run build`;
- `npm --workspace apps/desktop run test:gateway` — 78/78;
- `npm run verify:release`;
- `git diff --check`.

Первый sandboxed запуск gateway-тестов не смог открыть временные порты на `127.0.0.1` (`EPERM`). Повторный запуск с разрешённым локальным bind прошёл полностью. Пункты ниже требуют визуального или кластерного smoke и намеренно не отмечены автоматически.

- [ ] Сравнить два одинаковых manifests: все строки находятся строго напротив.
- [ ] Сравнить manifests с added, removed и changed blocks разной длины.
- [ ] Проверить короткое и очень длинное имя слева.
- [ ] Проверить короткое и очень длинное имя справа.
- [ ] Проверить одинаковые names в разных namespaces и clusters.
- [ ] Прокрутить вниз левый pane колёсиком, trackpad и scrollbar.
- [ ] Прокрутить вниз правый pane колёсиком, trackpad и scrollbar.
- [ ] Проверить горизонтальную прокрутку из обоих panes.
- [ ] Проверить Page Up, Page Down, Home, End и стрелки при focus внутри pane.
- [ ] Быстро выбрать другой target и убедиться, что оба pane открылись сверху.
- [ ] Переключить Clean/Raw в середине документа и проверить общий reset.
- [ ] Проверить пустой target, loading и API error.
- [ ] Проверить desktop side-by-side и узкий stacked layout.
- [ ] Проверить light, midnight, nord, forest, plum и mocha themes.
- [ ] Повторить smoke на macOS и Windows production build.
- [ ] Открыть список из 100+ Nodes и сравнить время первого отображения с 2.7.5.
- [ ] Убедиться, что во время загрузки списка не создаётся процесс `kubectl` на каждую ноду.
- [ ] Проверить CPU/RAM Usage при доступном и недоступном Metrics Server.
- [ ] Открыть Node Summary и дождаться disk usage только для выбранной ноды.
- [ ] Быстро переключить две ноды: disk metrics соответствуют последней выбранной.
- [ ] Обновить список Nodes: массовые disk probes не запускаются.
- [ ] Проверить фильтрацию, сортировку, pagination и Columns на 1000 synthetic rows.
- [ ] Снять CPU profile до и после backend-исправления; renderer оптимизировать только при подтверждённой нагрузке.
- [ ] Сравнить CPU/RAM bars у нод с низкой, средней и высокой нагрузкой.
- [ ] Проверить, что CPU и RAM различимы цветом во всех темах.
- [ ] Проверить tooltip с точными used/free/allocatable.
- [ ] Проверить Nodes без Metrics Server: отображается `N/A`.
- [ ] Проверить Node Summary с CPU, Memory и лениво загруженным Disk.
- [ ] Проверить ResourceQuota со значениями в bytes, Ki, Mi, Gi и Ti.
- [ ] Проверить переходы `1023Ki → KiB`, `1024Ki → 1 MiB`, `1024Mi → 1 GiB`.
- [ ] Проверить CPU quotas `200m / 6` и object counts `2 / 25` без byte units.
- [ ] Проверить, что проценты, сортировка и warning/danger цвета ResourceQuota не изменились.
- [ ] Force удалить обычный Pod и проверить command preview.
- [ ] Force удалить Pod в состоянии `Terminating`.
- [ ] Проверить replacement Pod для Deployment/StatefulSet и отсутствие автоматического replacement для standalone Pod.
- [ ] Bulk удалить несколько Pods с одним намеренно недоступным target и проверить partial result.
- [ ] Проверить, что Delete Deployment/Service/PVC не содержит force flags.
- [ ] Проверить RBAC denial без исчезновения Pod из локального списка.
- [ ] Проверить здоровый Deployment: label `Available`.
- [ ] Проверить rollout Deployment: labels `Available` + `Progressing`.
- [ ] Проверить частично доступный Deployment с ошибкой: `Available` + `ReplicaFailure`.
- [ ] Проверить `ProgressDeadlineExceeded` и причину в tooltip.
- [ ] Проверить `ReplicaFailure=True` / `FailedCreate` danger label.
- [ ] Проверить desired replicas `0`: статус `Scaled to zero`, не ошибка.
- [ ] Проверить удаляемый workload: статус `Terminating`.
- [ ] Проверить новый Deployment без conditions: fallback не сообщает ложный `Available`.
- [ ] Проверить фильтрацию по `ReplicaFailure`, `FailedCreate` и condition message.
- [ ] Проверить Summary, tooltip, комбинации labels и все состояния во всех поддерживаемых темах.
- [ ] Проверить Node без labels, с тремя labels и с `+N`.
- [ ] Проверить control-plane/worker Role, Region, Zone, Type, OS и Arch.
- [ ] Проверить stable и beta topology labels без дублей.
- [ ] Проверить custom labels с одинаковым suffix от разных DNS prefixes.
- [ ] Проверить пустое boolean-значение label.
- [ ] Найти скрытый label через Filter по полному key и value.
- [ ] Открыть полный список labels мышью и клавиатурой.
- [ ] Проверить 100 labels на одной Node без расширения строки и заметного CPU spike.
- [ ] Проверить неброское отображение chips во всех поддерживаемых темах.

## 15. Релиз 2.7.6

- [x] После реализации поднять root, desktop, shared-types и lockfile до `2.7.6`.
- [x] Добавить `RELEASE_NOTES_2.7.6.md`.
- [x] Добавить `REGRESSION_CHECKLIST_2.7.6.md`.
- [x] Обновить README и `NODE_MIGRATION_PROGRESS.md`.
- [x] Сохранить Node-only baseline Node 51 / Python 0.
- [x] Не включать в 2.7.6 замену diff engine или общий редизайн modal.

## Критерий готовности

В `Compare manifests` левый и правый code panes начинаются на одной высоте, одна diff-строка всегда расположена напротив соответствующей строки, а прокрутка любого pane синхронно перемещает второй по вертикали и горизонтали. Длинные resource labels не нарушают геометрию, а существующие Clean/Raw, chooser, diff colors и line numbers продолжают работать.

Список Nodes выполняет O(1) backend-команд независимо от количества строк, не ждёт per-node disk probes и не создаёт сотни одновременных процессов `kubectl`. CPU/RAM остаются доступны в таблице, а disk metrics загружаются только для открытой Node Summary.

CPU и RAM Nodes отображаются двумя различимыми resource bars с точными значениями в tooltip. ResourceQuota автоматически переводит memory/storage quantities в KiB, MiB, GiB или TiB, не меняя CPU, object counts и расчёт процентов.

Delete Pod по умолчанию выполняется с `--force --grace-period=0 --wait=false`, явно предупреждает о немедленном удалении и не добавляет force flags к другим Kubernetes-ресурсам.

Deployment и ReplicaSet показывают одновременно все активные Kubernetes conditions в стиле Lens: например `Available` + `Progressing` или `Available` + `ReplicaFailure`. Цветные текстовые labels остаются компактными, а reason/message доступны в tooltip и Summary без дополнительных запросов на каждую строку.

Node Labels показывают до трёх приоритетных понятных chips и `+N`, нормализуют role/topology/system aliases, сохраняют полный исходный context в tooltip и не создают визуальный шум или отдельную нагрузку на большие таблицы.
