# KubeDeck 2.9.0 — проект вкладки Overview

Статус: проектирование.

## 1. Идея

`Overview` — стартовый экран выбранного кластера. Он не должен быть ещё одной
страницей с большим количеством Kubernetes-чисел. Его задача — за 5–10 секунд
ответить пользователю на четыре вопроса:

1. Кластер сейчас в порядке?
2. Что требует внимания в первую очередь?
3. Где заканчивается запас ресурсов?
4. Куда перейти, чтобы разобраться или продолжить работу?

Главный принцип:

> Сначала вывод, затем доказательства, затем действие.

Пользователь не должен самостоятельно складывать состояние кластера из десятка
карточек. Overview формулирует понятный итог, показывает причины и даёт прямые
переходы к проблемным ресурсам.

## 2. Что должно ощущаться при открытии

- экран появляется быстро и не прыгает во время загрузки;
- выбранный кластер и namespace scope всегда очевидны;
- аварии визуально заметны, но нормальный экран остаётся спокойным;
- важные данные помещаются в первый экран без вертикальной прокрутки;
- каждое число, проблема и ресурс кликабельны;
- частичный сбой одного источника не ломает весь Overview;
- данные имеют время обновления и не создают ложного ощущения realtime;
- если всё хорошо, интерфейс не заполняется зелёными баннерами;
- если есть проблема, пользователь сразу понимает следующий шаг.

## 3. Информационная иерархия

Overview строится в три уровня.

### Уровень A — состояние сейчас

Верхняя строка отвечает на вопрос «можно ли спокойно работать»:

- общий вердикт;
- число критических проблем;
- число предупреждений;
- состояние Nodes;
- состояние workloads;
- запас CPU и RAM;
- время последнего успешного обновления.

### Уровень B — что делать

Центральная область показывает:

- очередь приоритетных проблем;
- workload health;
- pressure по CPU, RAM и Disk;
- namespaces с наибольшим риском;
- недавние важные события.

### Уровень C — быстрый переход

Нижняя область помогает продолжить работу:

- недавно открытые ресурсы;
- быстрые ссылки на Pods, Deployments, Nodes, Events и Problems;
- активные port-forwards и terminal sessions;
- понятные empty/error states.

## 4. Макет

Desktop-layout использует адаптивную 12-колоночную сетку.

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Cluster pulse                         Scope · Updated · Refresh      │
│ ● Attention needed   2 critical · 5 warning                         │
│ Nodes 3/3 │ Workloads 42/45 │ CPU 61% │ RAM 74% │ Disk 48%         │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────┬──────────────────────────────┐
│ Needs attention                     │ Capacity                     │
│ 1. CrashLoopBackOff · api-…   Open  │ CPU  ██████░░ 61%            │
│ 2. Node memory pressure       Open  │ RAM  ███████░ 74%             │
│ 3. PVC Pending                Open  │ Disk █████░░░ 48%             │
│                         All problems │ 1 node approaching pressure  │
└──────────────────────────────────────┴──────────────────────────────┘

┌──────────────────────────────────────┬──────────────────────────────┐
│ Workloads                           │ Namespace hotspots           │
│ Pods        40 healthy · 3 attention│ production   3 issues · 82%  │
│ Deployments 12 ready   · 1 rollout  │ monitoring   1 issue  · 76%  │
│ Jobs         8 complete · 1 failed  │ tools        healthy          │
└──────────────────────────────────────┴──────────────────────────────┘

┌──────────────────────────────────────┬──────────────────────────────┐
│ Recent important events             │ Continue working             │
│ 2m  BackOff · api-…            Open │ deployment/api          Open │
│ 5m  FailedScheduling · worker  Open │ pod/netshoot            Open │
│                         All events   │ 2 port-forwards · 1 terminal │
└──────────────────────────────────────┴──────────────────────────────┘
```

При узком окне двухколоночные блоки становятся одноколоночными. Горизонтальный
скролл Overview не допускается.

## 5. Cluster pulse

Это главный блок, а не декоративный hero.

### 5.1 Вердикт

Допустимы четыре состояния:

| Tone | Заголовок | Условие |
|---|---|---|
| `success` | `Cluster healthy` | нет critical, нет collection errors, Nodes готовы, workloads достигли ожидаемого состояния |
| `pending` | `Changes in progress` | есть только ожидаемые переходные состояния |
| `danger` | `Attention needed` | есть critical, Node NotReady или подтверждённый workload/container failure |
| `neutral` | `Status incomplete` | данных недостаточно для достоверного вывода |

Не вводить числовой health score вроде `87/100`: такое число выглядит точным,
но не имеет честной Kubernetes-семантики.

### 5.2 Контекст

В правой части:

- display name кластера;
- текущий namespace scope: `All namespaces` или выбранные namespaces;
- абсолютное время последнего успешного snapshot;
- относительный возраст данных;
- кнопка Refresh с существующим async feedback.

### 5.3 Ключевые сигналы

Компактная строка:

- `Nodes ready / total`;
- `Workloads healthy / total`;
- `Pods ready / total`;
- CPU utilization;
- RAM utilization;
- Disk utilization, только если данные доступны.

`N/A` лучше выдуманного нуля. Частично доступные метрики должны оставаться
полезными.

## 6. Needs attention

Самый важный рабочий блок Overview.

### 6.1 Содержимое

Показывать максимум пять проблем, уже отсортированных Problems engine:

- severity;
- короткий reason;
- kind и name;
- namespace;
- age;
- одно короткое действие: `Open`.

Порядок:

1. critical;
2. warning;
3. более новые события выше при одинаковой severity;
4. дубликаты одной причины для одного объекта объединяются.

### 6.2 Поведение

- клик по строке открывает существующий resource drawer;
- `All problems` переводит на полноценную вкладку Problems;
- если critical нет, блок не исчезает, а показывает warnings;
- если проблем нет, отображается спокойное компактное сообщение
  `No active problems`;
- collection errors выводятся отдельной нейтрально-жёлтой строкой и не
  маскируются под здоровье кластера.

Не дублировать на Overview фильтры Problems Panel. Overview показывает только
приоритетную очередь.

## 7. Capacity

### 7.1 Что показываем

- суммарный CPU usage относительно allocatable;
- суммарный RAM usage относительно allocatable;
- Disk usage по Nodes, если probes уже вернули данные;
- количество Nodes с pressure/недоступными метриками;
- минимальный оставшийся запас по самому нагруженному Node.

### 7.2 Семантика

| Значение | Tone |
|---|---|
| `< 70%` | neutral/success без яркой заливки |
| `70–84%` | pending |
| `>= 85%` | danger |
| метрика недоступна | neutral `N/A` |

Порог — UI-сигнал, а не диагноз Kubernetes. Настраиваемые thresholds в 2.9.0
не добавляются.

### 7.3 Drill-down

- клик по CPU/RAM/Disk открывает Nodes;
- при наличии hotspot первым показывается имя самого нагруженного Node;
- tooltip содержит used, allocatable и время измерения.

Исторические графики и прогноз исчерпания не входят в 2.9.0: приложение пока
не хранит time series.

## 8. Workload health

Показываем компактную матрицу:

| Resource | Healthy | Transitional | Failed |
|---|---:|---:|---:|
| Pods | Ready/Running | Pending/Terminating | Failed/error reason |
| Deployments | Available | Progressing | unavailable/failed condition |
| StatefulSets | Ready replicas | rollout | unavailable replicas |
| DaemonSets | desired ready | updating | unavailable |
| Jobs | Complete | Active | Failed |

Правила:

- использовать общий status classifier из 2.8.1;
- красить только status/count, не всю карточку;
- строка ресурса кликабельна и открывает соответствующий список;
- нулевые группы не занимают отдельные большие карточки;
- readiness важнее одного только `phase=Running`.

## 9. Namespace hotspots

Overview должен помогать находить не просто «много ресурсов», а scope, где
скорее всего потребуется внимание.

Показывать до пяти namespaces, ранжируя по:

1. critical problems;
2. warning problems;
3. quota utilization;
4. CPU/RAM utilization;
5. алфавиту как стабильному tie-breaker.

Строка namespace:

- имя;
- количество critical/warning;
- наиболее высокий quota/resource utilization;
- короткий reason;
- переход в Workloads с применённым namespace scope.

Не называть namespace «плохим» только за высокий абсолютный расход. Большой
namespace без pressure может быть здоровым.

## 10. Recent important events

Показывать последние пять Warning events:

- age;
- reason;
- involved object;
- namespace;
- сокращённое message;
- переход к объекту, если тип поддерживается;
- `All events` открывает Events.

Нормальные events не должны вытеснять важные. Полный event stream остаётся на
существующей вкладке Events.

Дубликаты одинаковых events для одного объекта можно объединить:
`FailedScheduling × 8`, сохраняя время последнего события.

## 11. Continue working

Небольшой блок, делающий стартовый экран персональным:

- последние 3–5 открытых resource workspace tabs;
- число активных Pod terminals;
- число активных port-forwards;
- ссылки `Open`, `Terminals`, `Port forwards`.

Использовать только уже существующее локальное UI-state. Не добавлять серверную
историю активности и синхронизацию между компьютерами.

Если истории нет, блок превращается в Quick access:

- Pods;
- Deployments;
- Nodes;
- Problems;
- Events.

## 12. Empty, loading и partial states

### Нет выбранного кластера

Показывать один ясный экран:

- `Select or import a cluster`;
- существующий cluster selector;
- без пустых карточек и нулевых метрик.

### Первичная загрузка

- сохранять стабильный размер секций;
- использовать спокойные skeleton-lines;
- не показывать `0 healthy` до получения данных;
- не перекрывать весь shell spinner-ом.

### Refresh

- старый snapshot остаётся видимым;
- обновляемые значения получают `aria-busy`;
- при успехе меняется timestamp;
- при ошибке старые значения остаются с пометкой `Stale`.

### Частичная ошибка

- каждый блок знает, доступен ли его source;
- недоступный блок показывает короткую ошибку и Retry;
- остальные блоки продолжают работать;
- общий verdict становится `Status incomplete`, если невозможно доказать
  здоровье.

## 13. Namespace scope

Overview следует текущему глобальному namespace selector:

- Nodes и cluster capacity всегда cluster-scoped;
- workloads, problems, events и hotspots учитывают выбранные namespaces;
- рядом с заголовком явно показывается scope;
- смена scope отменяет предыдущий запрос и собирает новый snapshot;
- ответ старого запроса не может заменить данные нового scope.

Это особенно важно при выборе нескольких namespaces.

## 14. Навигация

`Overview` становится первым пунктом sidebar с иконкой `LayoutDashboard`.

Поведение:

- новый пользователь после выбора кластера попадает на Overview;
- сохранённая последняя секция по-прежнему восстанавливается;
- клик по карточке использует существующие функции навигации, namespace scope и
  resource drawer;
- Overview доступен в command palette;
- глубокий переход не создаёт отдельную конкурирующую систему routing.

### 14.1 Events без лишнего уровня

Сейчас sidebar содержит родительский пункт `Events`, который раскрывает
единственного дочернего пункта `Events`. Это не группировка, а лишний клик и
визуальный шум.

В 2.9.0:

- `Events` становится обычным одноуровневым пунктом sidebar;
- клик сразу открывает список событий;
- expander и `nav-children` для Events не отображаются;
- `events` остаётся полноценным resource type и сохраняет фильтрацию,
  namespace scope, сортировку и переходы к объектам;
- переход `All events` из Overview открывает этот же экран;
- Events остаётся доступным в command palette;
- сохранённое состояние `section=events/resourceTab=events` продолжает
  восстанавливаться.

Для этого не нужен новый экран. Достаточно убрать `events: ["events"]` из
общего дерева раскрываемых групп и явно связать одноуровневую секцию Events с
`resourceTab="events"`.

### 14.2 Audit: сохранить механизм, убрать из главной навигации

Текущий Audit — локальный журнал действий самого KubeDeck:

- выполненные команды и операции;
- успешные и неуспешные результаты;
- открытие/закрытие локальных сессий;
- экспорт диагностической истории.

Это не Kubernetes Audit API и не cluster-wide security audit. Название и
положение в sidebar могут создавать неверные ожидания.

Решение для 2.9.0:

- не удалять локальное журналирование и существующие данные;
- убрать самостоятельный пункт `Audit` из основного sidebar;
- перенести экран в `Settings → Local activity`;
- явно подписать: `Stored locally on this Mac`;
- пояснить, что журнал отражает только действия, выполненные через KubeDeck;
- сохранить поиск, фильтры, Copy и Download;
- не показывать Audit как сигнал здоровья в Overview;
- не добавлять polling, пока экран Local activity закрыт;
- добавить действие очистки только отдельным будущим решением с подтверждением,
  если оно действительно понадобится.

Так журнал остаётся полезным для диагностики и разбора собственных действий,
но не конкурирует с ежедневными Kubernetes-разделами.

Если позднее появится поддержка Kubernetes Audit API, это должна быть отдельная
функция с другим источником, названием и security model.

### 14.3 About: привести к продуктовой странице KubeDeck

Текущий About содержит кнопки, которые визуально расходятся с остальным
приложением, а также устаревшие сведения:

- строку Python при Node-only runtime;
- Windows-команду `package:win` в macOS-only продукте;
- внутренний release checklist, не полезный обычному пользователю;
- fallback-версию `1.1.0`, которая может вводить в заблуждение.

В 2.9.0:

- Refresh использует общий `AsyncActionButton` и стандартный secondary style;
- Copy diagnostics использует стандартную primary action;
- Open folder использует общий compact secondary/icon-button pattern;
- hover, focus, disabled, pending и success состояния берутся из общих tokens;
- размеры, border radius и высота совпадают с Settings и resource toolbar;
- у кнопок открытия папок появляются иконка и доступный label;
- все действия доступны с клавиатуры.

Содержимое About упрощается:

- KubeDeck version;
- macOS architecture;
- Electron, Chrome, Node и kubectl versions;
- backend status;
- пути App Data, Config, Kubeconfigs и Logs;
- сведения о текущем кластере;
- Copy diagnostics.

Удалить из пользовательского About:

- Python version;
- команды сборки;
- release checklist;
- Windows package references.

Версия берётся только из desktop metadata. При недоступности metadata
показывается `—`, а не захардкоженная старая версия.

### 14.4 Search и Columns в одной строке

В resource tables поле поиска и кнопка настройки колонок сейчас могут
оказываться на разных строках. Это визуально разрывает единый набор инструментов
таблицы и зря увеличивает высоту header.

В 2.9.0:

- Search и Columns объединяются в одну компактную control-group;
- порядок всегда `Search → Columns`;
- кнопка Columns располагается сразу справа от поля поиска;
- два элемента не разрываются переносом между строками;
- при недостатке ширины целиком переносится вся control-group;
- поле поиска может сжиматься до безопасной минимальной ширины;
- Columns сохраняет фиксированный размер;
- bulk actions могут располагаться перед этой группой и переноситься отдельно;
- на узком экране control-group занимает доступную ширину без горизонтального
  скролла.

Функциональность поиска, открытие columns popover, keyboard focus и сохранение
настроек колонок не меняются.

### 14.5 Закрытие временного drawer кликом по свободной области

Сейчас drawer выбранного Pod или другого ресурса остаётся открытым, даже когда
пользователь кликает по свободному фону рабочей области. Для временного
просмотра это ощущается тяжело: чтобы вернуться к полной таблице, приходится
искать отдельную кнопку закрытия.

В 2.9.0:

- клик по свободной области workspace закрывает временно открытый drawer;
- клик внутри drawer ничего не закрывает;
- клик по строке другого ресурса открывает этот ресурс, а не сначала закрывает
  drawer;
- клик по Search, Columns, pagination, sidebar, topbar, terminal и другим
  интерактивным элементам не считается кликом по свободной области;
- закреплённые resource workspace tabs таким кликом не закрываются;
- нижний Pod Terminal не закрывается;
- кнопка закрытия drawer и клавиша `Escape` остаются доступными;
- обработчик не должен перехватывать drag/resize и context menu.

Под «свободной областью» понимается фон `content/workspace`, у которого
непосредственная цель события не является кнопкой, ссылкой, input, строкой
ресурса, drawer, modal, popover или другим интерактивным элементом.

Если в YAML есть несохранённые изменения, применяется существующая защита
навигации:

- drawer не закрывается молча;
- показывается существующее подтверждение потери изменений;
- Cancel сохраняет drawer и YAML открытыми.

Не добавлять глобальный `document.onclick`, который начинает угадывать смысл
любого клика. Закрытие должно быть привязано к конкретной фоновой поверхности
workspace и использовать существующий `closeDisplayedResource`.

## 15. Data contract

### 15.1 Предпочтительный endpoint

Добавить один:

```text
GET /clusters/{cluster_id}/overview?namespace=all
```

Для нескольких namespaces:

```text
GET /clusters/{cluster_id}/overview?namespace=production,monitoring
```

Один snapshot предпочтительнее множества независимых renderer-запросов:

- данные относятся примерно к одному моменту;
- renderer не знает детали kubectl aggregation;
- проще отменять refresh;
- проще выражать partial errors;
- меньше дублирования с Problems engine.

### 15.2 Ответ

```ts
interface ClusterOverviewResponse {
  generatedAt: string;
  scope: {
    clusterId: string;
    namespaces: string[];
  };
  verdict: {
    tone: "success" | "pending" | "danger" | "neutral";
    title: string;
    reasons: string[];
  };
  summary: {
    nodesReady: number;
    nodesTotal: number;
    workloadsHealthy: number;
    workloadsTotal: number;
    podsReady: number;
    podsTotal: number;
    critical: number;
    warning: number;
  };
  capacity: {
    cpuPercent?: number;
    memoryPercent?: number;
    diskPercent?: number;
    pressuredNodes: number;
    hottestNode?: ResourceRow;
  };
  workloads: Array<{
    resource: string;
    healthy: number;
    pending: number;
    danger: number;
    total: number;
  }>;
  priorityProblems: ResourceRow[];
  namespaceHotspots: ResourceRow[];
  recentEvents: ResourceRow[];
  sources: Record<string, number>;
  errors: Array<ErrorInfo & { resource?: string; namespace?: string }>;
}
```

`title` и пользовательские тексты verdict лучше собирать в renderer через i18n.
Backend возвращает tone и reason codes, чтобы transport не зависел от языка.

### 15.3 Источники

Минимальный snapshot:

- Nodes;
- Pods;
- Deployments;
- StatefulSets;
- DaemonSets;
- Jobs;
- Events;
- PersistentVolumeClaims;
- ResourceQuotas;
- namespace usage при доступных metrics.

Загрузка выполняется параллельно с теми же timeout/output limits и
partial-error моделью, что уже применяются в Problems.

### 15.4 Повторное использование

- вынести загрузку общих problem sources из route в переиспользуемую функцию;
- использовать существующие resource normalizers;
- использовать `buildProblemRows` и `summarizeProblems`;
- использовать общий classifier 2.8.1;
- использовать существующий resource cache там, где его контракт безопасен;
- не запускать второй комплект одинаковых kubectl-команд одновременно из
  Problems и Overview.

Не создавать отдельный «analytics engine».

## 16. Renderer architecture

Минимальный набор:

```text
components/
  OverviewPanel.tsx
  overview/
    ClusterPulse.tsx
    AttentionList.tsx
    CapacitySummary.tsx
    WorkloadHealth.tsx
    NamespaceHotspots.tsx
    RecentEvents.tsx
    ContinueWorking.tsx

hooks/
  useClusterOverview.ts

styles/
  overview.css
```

Допустимо начать с одного `OverviewPanel.tsx` и выделять компоненты только когда
файл действительно станет неудобен. Не создавать отдельный state manager:
одного hook с request generation/AbortController достаточно.

Panel загружается через существующий lazy boundary.

## 17. Refresh и watch

- первичный snapshot загружается при открытии Overview;
- auto-refresh использует существующий setting;
- активный resource watch может помечать snapshot устаревшим;
- debounce одного обновления достаточно;
- скрытый Overview не должен продолжать отдельный polling;
- ручной Refresh всегда делает force refresh;
- параллельные refresh не допускаются;
- stale response игнорируется по generation id.

В 2.9.0 не нужно превращать каждое watch-событие в локальный пересчёт всех
виджетов.

## 18. Цвет и визуальный язык

Использовать семантику 2.8.1:

- зелёный — подтверждённая готовность;
- жёлтый — переход/ожидание;
- красный — подтверждённый failure;
- neutral — неизвестно или информационно.

Ограничения:

- не окрашивать целые большие панели;
- цвет получает status, число или небольшой indicator;
- красный не используется для hover/selection;
- обычное здоровое состояние визуально спокойнее проблемы;
- никаких pie/donut charts: они занимают много места и плохо сравниваются;
- capacity лучше показывать линейными bars;
- не добавлять chart dependency.

## 19. Доступность

- все карточки, работающие как ссылки, доступны с клавиатуры;
- использовать `<button>`/`<a>`, а не click на `div`;
- visible focus обязателен;
- tone сопровождается текстом и/или иконкой;
- progress bars имеют `aria-label`, `aria-valuenow` и понятную единицу;
- секции имеют headings и landmarks;
- loading не вызывает постоянных announcements;
- относительный timestamp имеет абсолютное время в tooltip;
- prefers-reduced-motion соблюдается.

## 20. Производительность

Цели для локально доступного кластера:

- shell и skeleton: до 150 ms;
- первый полезный блок: до 1 s;
- полный snapshot: до 3 s при нормальном API;
- renderer не блокируется обработкой больших JSON;
- списки Overview ограничены пятью строками;
- response не возвращает полные manifests;
- закрытый Overview не делает polling.

Если один kubectl source медленный, быстрые данные могут быть возвращены только
после общего Promise settlement, но endpoint обязан сохранить partial results.
Streaming endpoint в 2.9.0 не требуется.

## 21. Что сознательно не входит в 2.9.0

- исторические графики;
- Prometheus/Grafana integration;
- прогнозирование capacity;
- числовой health score;
- AI-generated cluster summary при каждом открытии;
- cost estimation;
- topology graph;
- drag-and-drop настройка карточек;
- пользовательский конструктор dashboard;
- server-side activity history;
- новые destructive quick actions;
- новый chart/UI framework.

Эти возможности можно добавлять только после подтверждения, что базовый
Overview реально помогает ежедневной работе.

## 22. Этапы реализации

### Этап 1 — контракт и агрегация

- [ ] Определить `ClusterOverviewResponse`.
- [ ] Добавить route ownership для overview endpoint.
- [ ] Реализовать matcher и validation.
- [ ] Переиспользовать Problems engine.
- [ ] Параллельно загрузить sources.
- [ ] Добавить partial errors и generatedAt.
- [ ] Добавить gateway contract tests.

### Этап 2 — базовый экран

- [ ] Вернуть Overview в navigation sections.
- [ ] Сделать Events одноуровневым пунктом без дочернего дубля.
- [ ] Перенести локальный Audit в `Settings → Local activity`.
- [ ] Привести About и его кнопки к общему UI contract.
- [ ] Удалить из About Python, Windows build и release checklist.
- [ ] Объединить Search и Columns в одну строку во всех resource tables.
- [ ] Закрывать временный drawer кликом по свободной области workspace.
- [ ] Добавить i18n RU/EN.
- [ ] Реализовать `useClusterOverview`.
- [ ] Реализовать Cluster pulse.
- [ ] Реализовать Needs attention.
- [ ] Реализовать Workload health.
- [ ] Подключить существующую навигацию к ресурсам.

### Этап 3 — эксплуатационные блоки

- [ ] Capacity.
- [ ] Namespace hotspots.
- [ ] Recent important events.
- [ ] Continue working.
- [ ] empty/loading/stale/partial states.

### Этап 4 — полировка

- [ ] responsive layout;
- [ ] keyboard navigation;
- [ ] theme/contrast smoke;
- [ ] auto-refresh и watch invalidation;
- [ ] отсутствие background polling;
- [ ] renderer contracts;
- [ ] release docs 2.9.0;
- [ ] macOS package verification.

## 23. Контракты тестирования

### Gateway

- endpoint валидирует cluster id и namespace scope;
- sources запускаются параллельно;
- падение одного source возвращает partial response;
- verdict не бывает healthy при collection errors;
- severity и workload counts детерминированы;
- warning events дедуплицируются;
- namespace ranking имеет стабильный порядок;
- timeout и output limits сохраняются;
- в ответ не попадают Secret values и полные manifests.

### Renderer

- stale request не заменяет новый cluster/scope;
- закрытие Overview отменяет запрос;
- status tone соответствует 2.8.1;
- карточки открывают правильный resource и namespace;
- loading не отображает ложные нули;
- partial error не скрывает доступные блоки;
- capacity `N/A` не превращается в `0%`;
- auto-refresh не работает в скрытой вкладке;
- layout не создаёт горизонтальный scroll.
- Events открывается одним кликом без дублирующего дочернего пункта;
- Local activity не выполняет polling, пока соответствующий экран закрыт;
- About не содержит Python/Windows release metadata;
- About actions используют общие button states и доступны с клавиатуры.
- Search находится перед Columns, и control-group не разрывается переносом.
- background-click закрывает только transient drawer;
- интерактивные элементы, pinned tabs и terminal не закрываются;
- dirty YAML сохраняет существующий confirm contract.

### Manual smoke

- открыть здоровый кластер;
- открыть кластер с Pending Pod;
- открыть кластер с CrashLoopBackOff;
- проверить Node NotReady;
- проверить недоступный metrics-server;
- проверить один упавший kubectl source;
- сменить cluster во время загрузки;
- сменить namespace scope во время загрузки;
- проверить узкое окно;
- открыть Pod и закрыть transient drawer кликом по свободному фону;
- убедиться, что клик внутри drawer, по toolbar и по terminal его не закрывает;
- проверить Cancel при несохранённом YAML;
- проверить все темы;
- пройти Overview только клавиатурой.

## 24. Definition of Done

- [ ] Overview отвечает на четыре главных вопроса без перехода на другие вкладки.
- [ ] Critical problem доступна не более чем за один клик.
- [ ] Здоровье не заявляется при неполных данных.
- [ ] Переходные состояния не выглядят аварийными.
- [ ] Capacity основан только на реальных доступных метриках.
- [ ] Нет исторических или прогнозных данных, которых KubeDeck не измерял.
- [ ] Все блоки поддерживают partial failure.
- [ ] Overview не создаёт дублирующую систему навигации.
- [ ] Events не имеет одноимённого дочернего пункта.
- [ ] Local Audit сохранён, честно подписан и убран из основного sidebar.
- [ ] About соответствует общему стилю и macOS/Node-only состоянию проекта.
- [ ] Search и Columns образуют одну компактную строку инструментов.
- [ ] Временный drawer предсказуемо закрывается кликом по свободному workspace.
- [ ] Pinned resource tabs, terminal и dirty YAML защищены от случайного
  закрытия.
- [ ] Существующие Problems, Events и resource tables остаются источником
  подробностей.
- [ ] Новые зависимости не добавлены.
- [ ] Полный verify и macOS package проходят.
