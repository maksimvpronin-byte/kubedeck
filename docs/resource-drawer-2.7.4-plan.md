# KubeDeck 2.7.4 — полезный Summary, компактные действия и рабочие панели

Статус: реализовано в UI и backend normalizers, версия поднята до `2.7.4`. Автоматические контракты и release verification пройдены; ручной визуальный smoke из раздела 10 оставлен отдельным релизным этапом.

## Проблема

Resource drawer сейчас смешивает три разных уровня информации:

- имя и контекст объекта находятся в шапке;
- действия находятся отдельной строкой уже внутри активной вкладки;
- Summary сначала повторяет очевидные поля, а затем выводит почти все нормализованные данные объекта как технические карточки.

В результате Summary занимает много места, но не помогает администратору быстро оценить здоровье ресурса. Поля `uid`, `name`, сырые `labels`, `ownerReferences`, `apiVersion` и подобная служебная информация полезны для Kubernetes и диагностики через YAML/Describe, но не должны автоматически попадать в основной обзор.

Отдельная вкладка Events также показывает слишком много штатного шума (`Pulled`, `Created`, `Started`) и конкурирует с глобальным разделом Events.

Дополнительно кнопка Copy рядом с именем сохраняет строку вида `pods/name`, хотя её назначение и tooltip обещают копирование имени. Получившуюся строку нельзя сразу использовать там, где ожидается только `metadata.name`.

## Цель 2.7.4

Resource drawer должен за несколько секунд отвечать на три вопроса:

1. Здоров ли ресурс сейчас?
2. Если нет — в чём наиболее вероятная причина?
3. Какое действие администратор может выполнить дальше?

## Границы патча

- Изменяется только resource drawer, его Summary, header actions и локальная работа с Events.
- Toolbar таблицы ресурсов упрощается: постоянный Refresh удаляется, Columns становится icon-only control.
- Нижняя панель терминалов становится компактнее: icon-only actions, одноэтажные tabs и отсутствие постоянного kubectl command preview.
- Общий раздел Events в sidebar остаётся без изменений.
- YAML, Describe, Logs, Related, LLM, Secret и terminal dock сохраняются.
- Backend-команды действий и confirmation modal переиспользуются; новые способы изменения Kubernetes-объектов не добавляются.
- Summary использует явные представления известных kind. Автоматического вывода всех полей объекта больше нет.
- Версия поднимается до `2.7.4` только после реализации и автоматических проверок.

## 1. Новая информационная иерархия drawer

Порядок сверху вниз:

1. Контекст: `Kind · Namespace`.
2. Имя ресурса и Copy name.
3. Доступные действия ресурса и Close.
4. Вкладки.
5. Содержимое активной вкладки.

Действия больше не повторяются внутри каждой вкладки. Переключение Summary → YAML → Logs не должно сдвигать или скрывать Restart, Scale, Terminal и другие операции текущего объекта.

### Шапка

- Слева остаются kind/namespace и имя.
- Copy располагается непосредственно рядом с именем.
- Справа перед Close располагаются действия текущего ресурса.
- Все действия являются обычными кнопками с текстом, а не меню из трёх точек.
- Destructive action `Delete` визуально отделяется от остальных и сохраняет confirmation.
- Кнопки допускают перенос на вторую строку на узком drawer; имя не должно обрезаться из-за действий.
- Во время выполняющегося действия блокируется только соответствующая операция и недопустимые дубликаты, а не весь drawer.

### Набор действий

| Ресурс | Кнопки в шапке |
| --- | --- |
| Pod | Restart pod, Terminal, Port forward при наличии подходящих портов, Delete |
| Deployment, StatefulSet | Redeploy, Scale, Port forward при поддержке, Delete |
| DaemonSet | Redeploy, Delete |
| ReplicaSet | Scale, Delete |
| Job, CronJob | Delete |
| Service | Port forward при поддержке, Delete |
| ConfigMap, Secret, ServiceAccount | Delete |
| Node | SSH; существующие node actions не расширяются этим патчем |
| CRD instance | Delete |
| CRD definition | действий изменения нет |
| Остальные read-only ресурсы | кнопки действий не показываются |

`Open involved object` остаётся контекстным действием страницы отдельного Event и не переносится в общий header других ресурсов.

## 2. Copy name

- Нажатие Copy сохраняет строго `row.name` / `metadata.name`.
- Kind, resource plural, namespace, пробелы и служебные префиксы не добавляются.
- Для pod `netshoot-5898575569-x55mg` результатом является `netshoot-5898575569-x55mg`, а не `pods/netshoot-5898575569-x55mg`.
- Tooltip и aria-label: `Copy resource name`.
- После успеха показывается короткий feedback `Name copied` без изменения ширины header.
- Ошибка Clipboard API не должна показывать ложный успешный feedback.

## 3. Удаление вкладки Events

- `Events` удаляется из набора вкладок всех resource drawer.
- Сохранённый workspace tab со старым `drawerTab: "events"` открывается на Summary, а не в пустом состоянии.
- Lifecycle больше не загружает полный список Events только ради отдельной вкладки.
- Глобальный раздел Events, поиск событий и открытие involved object остаются.
- Summary может показывать только свежие Warning-события текущего объекта; штатные Normal events (`Pulled`, `Created`, `Started`, `Scheduled`) в Summary не выводятся.
- Если Warning-событий нет, отдельный пустой блок Events не показывается.
- Для просмотра полной истории администратор использует глобальный раздел Events.

## 4. Контракт Summary

Summary — это curated view, а не generic object inspector.

### Общие правила

- Не повторять имя ресурса: оно уже находится в header.
- Не показывать Kind отдельной большой карточкой: он уже находится над именем.
- Namespace показывать компактно только если он помогает понять scope; для cluster-scoped ресурсов не выводить `_cluster` как значение.
- Всегда показывать основной status/health и age, если они известны.
- Healthy-поля объединять в компактную строку; проблемы выделять сильнее нормального состояния.
- Не выводить пустые, `unknown`, `0/0` или искусственно восстановленные значения как полезные факты.
- Не выводить автоматически `Object.entries(row)`.
- Полные labels, annotations, ownerReferences, UID, resourceVersion, generation, managedFields, apiVersion, spec и status доступны в YAML/Describe.
- Сырые массивы и объекты никогда не форматируются через JSON внутри Summary.
- При отсутствии специализированного Summary показать небольшой status/age и сообщение: `No operational summary is available. Use YAML or Describe for full details.`

### Pod

Показывать:

- phase и readiness;
- node и pod IP;
- controller/owner в читаемом виде, если доступен;
- service account, если он отличается от `default`;
- контейнеры компактной таблицей: name, ready/state, restart count;
- container waiting/terminated reason и короткое message только для проблемного контейнера;
- суммарные restarts;
- последнюю неуспешную остановку: reason, exit code, finished time;
- активные non-ready conditions;
- до пяти свежих Warning-событий объекта, без повторяющихся Normal events.

Не показывать:

- повторные карточки Kind, Name и Namespace;
- UID, raw labels и ownerReferences;
- отдельную большую restart diagnostics секцию для полностью здорового pod;
- `Last restart` и `Exit code`, если остановка завершилась успешно или рестартов не было;
- совет открыть Previous logs, если previous container state отсутствует.

### Deployment, StatefulSet, DaemonSet, ReplicaSet

Показывать:

- desired, ready, available и updated replicas;
- rollout health одним итоговым состоянием;
- недоступные replicas и progressing/degraded condition только при отклонении;
- container images;
- selector в компактном виде;
- до пяти релевантных Warning-событий.

Для StatefulSet дополнительно: current/updated revision и ready replicas. Для DaemonSet: desired/current/ready/available и misscheduled. Для ReplicaSet: desired/current/ready.

### Job и CronJob

Показывать:

- Job: active, succeeded, failed, completions и duration;
- причину failure и Warning-события при ошибке;
- CronJob: schedule, suspend state, last schedule, active jobs и last successful run;
- concurrency policy только если она отличается от стандартной либо объясняет отсутствие запуска.

### Service

Показывать:

- type;
- ClusterIP и external IP/hostname, если применимо;
- ports как `name · port → targetPort / protocol`;
- selector;
- количество ready/not-ready endpoints;
- заметное состояние `No ready endpoints`, если selector существует, но подходящих endpoint нет.

### Ingress

Показывать:

- ingress class;
- external addresses;
- hosts и paths с backend service/port;
- TLS hosts;
- отсутствующий backend или address как предупреждение, а не как пустую карточку.

### ConfigMap и Secret

ConfigMap:

- количество keys;
- имена keys компактным списком;
- immutable state.

Secret:

- Secret type;
- количество keys;
- имена keys без значений;
- immutable state;
- никакие decoded или base64 values в Summary не попадают.

Редактирование/просмотр Secret остаётся в отдельной вкладке Secret.

### Node

Показывать:

- Ready/NotReady и schedulable/cordoned;
- active pressure conditions;
- Internal IP;
- kubelet и container runtime versions;
- OS и architecture;
- CPU, memory, pods и ephemeral storage в форме allocatable / capacity;
- Warning-события, относящиеся к node.

Hostname, kernel version и полный список addresses не показывать, если они не объясняют проблему; они остаются в Describe.

### PVC, PV и StorageClass

PVC:

- phase, requested/capacity, access modes, storage class и bound volume;
- причина Pending/Lost и Warning-события.

PV:

- phase, capacity, access modes, storage class, reclaim policy и claim;
- node affinity только если она ограничивает размещение и может объяснить проблему.

StorageClass:

- provisioner, reclaim policy, volume binding mode и allow expansion.

### RBAC

Role/ClusterRole:

- количество rules;
- компактная сводка resources и verbs;
- без полного JSON rules.

RoleBinding/ClusterRoleBinding:

- roleRef;
- subjects с kind, namespace и name;
- количество subjects.

ServiceAccount:

- количество referenced secrets и imagePullSecrets;
- их имена только если список короткий; длинный список сворачивается в count.

### Namespace и ResourceQuota

Namespace:

- phase, age и terminating condition/reason при наличии;
- количество active Warning-событий, если они относятся к namespace.

ResourceQuota:

- существующая таблица used / hard сохраняется;
- сначала показываются значения выше 80%, затем остальные;
- превышение 80% — warning, 95% — danger;
- scopes выводятся одной компактной строкой.

### CRD definition и CRD instance

CRD definition:

- group, kind, plural, scope, served/storage versions и short names;
- read-only notice сохраняется.

CRD instance:

- conditions из `status.conditions`;
- простые scalar status fields, явно разрешённые безопасным formatter;
- произвольные spec/status объекты автоматически не разворачиваются;
- при отсутствии понятного status используется generic fallback с переходом в YAML/Describe.

## 5. Визуальная структура Summary

Summary не должен быть сеткой одинаково крупных карточек для каждого поля.

Рекомендуемый порядок:

1. Компактная health strip: status, readiness/replicas, age и один главный сигнал проблемы.
2. Kind-specific operational block: containers, rollout, endpoints, routes, quota usage и т.п.
3. Problems only: failed condition, last failure, Warning events.
4. Небольшие supporting facts: node, IP, service account, storage class.

Правила плотности:

- максимум 4–6 ключевых показателей до первого содержательного блока;
- нормальное состояние не получает большие зелёные панели;
- danger/warning блок показывается только при реальной проблеме;
- один факт не дублируется в health strip и detail block;
- длинный текст message ограничивается несколькими строками с возможностью открыть Describe;
- пустые секции и заголовки не отображаются.

## 6. Необходимые данные

Существующие normalizers уже покрывают часть контракта, но для полноценного Summary потребуется точечно добавить:

- Pod: container images и читаемый controller owner;
- workload controllers: desired/current/ready/available/updated replicas, images и conditions;
- Service: targetPort/protocol и ready/not-ready endpoint counts;
- Ingress: paths, backend ports, TLS и addresses;
- Job/CronJob, PVC/PV/StorageClass: специализированные normalizers;
- Secret/ConfigMap: type, immutable и key names/count без значений;
- CRD: storage version;
- локальную выборку последних Warning-событий текущего объекта.

Новые данные добавляются в существующий resource details/list contract только если они реально отображаются. Полный Kubernetes object в renderer ради Summary не передаётся.

## 7. Toolbar таблицы ресурсов

### Удалить Refresh

- Постоянная кнопка `Refresh` удаляется из toolbar всех resource tables.
- Resource watch и настроенный auto-refresh остаются основным способом обновления данных.
- Успешные Restart, Redeploy, Scale, Delete и другие mutations по-прежнему инициируют предусмотренное обновление затронутого списка.
- Удаление кнопки не отключает существующие refresh controller, watch reconnect и polling fallback.
- Целевые `Retry` сохраняются в состояниях ошибки, недоступного кластера и неудачной первоначальной загрузки: это восстановление после сбоя, а не постоянное ручное обновление.
- При остановленном watch интерфейс должен явно показывать состояние соединения либо использовать существующий polling fallback; скрывать устаревшие данные без индикации нельзя.
- После удаления Refresh строка поиска не растягивается скачком на всю ширину: toolbar сохраняет аккуратную компактную композицию.

### Columns как icon-only control

- Текст `Columns` с кнопки удаляется.
- Используется смысловая иконка управления колонками, визуально отличимая от Filter, Settings и общего меню.
- Предпочтительная иконка из уже установленного `lucide-react`: `Columns3` или ближайшая доступная иконка с тремя вертикальными колонками.
- Новая зависимость или собственный SVG не добавляются.
- Кнопка остаётся на прежнем логическом месте рядом с Filter и открывает существующий column picker без изменения его поведения.
- Размер control соответствует остальным компактным icon buttons toolbar; квадратная hit area — не менее `32 × 32 px`.
- Tooltip: `Choose columns`.
- `aria-label`: `Choose visible columns`.
- Активный/open state должен быть виден фоном или border, а не изменением самой иконки.
- Hover, focus-visible, disabled и open state используют существующие theme tokens.
- На Windows и macOS иконка не должна выглядеть как drag handle или layout split.
- Количество выбранных колонок на самой кнопке не показывается: состояние видно в открытом picker и в таблице.

### Компактная колонка Phase

- В ячейке `Phase` показывается только короткое каноническое состояние без второй строки с причиной контейнера.
- Основной набор значений: `Pending`, `Running`, `Succeeded`, `Failed`, `Terminating`, `Unknown`.
- `Completed` нормализуется в `Succeeded`; удаляемый объект всегда отображается как `Terminating` независимо от предыдущей phase.
- `CrashLoopBackOff`, `ImagePullBackOff`, `ErrImagePull`, `ContainerCreating`, `OOMKilled`, exit code, readiness и длинные Kubernetes messages не подменяют Phase и не выводятся под ней.
- Сортировка и фильтрация используют короткое каноническое значение. Поиск `pending`, `running` или `terminating` должен давать предсказуемый набор строк.
- Подробности текущего отклонения показываются при наведении или keyboard focus на значение Phase.
- Tooltip формируется из уже доступных `containerProblems`, `reason`, `statusMessage`, non-ready conditions и readiness; новый запрос к Kubernetes при наведении не выполняется.
- В tooltip сначала показывается главная причина, затем при наличии container name, readiness и короткое message.
- Повторяющиеся причины объединяются; пустой tooltip для обычного здорового `Running` не показывается.
- Длинное сообщение ограничивается читаемым объёмом и не расширяет таблицу. Полная информация остаётся в Summary, Logs и Describe.
- Цвет строки или status indicator может обозначать warning/error, но текст Phase остаётся каноническим. Например, pod в `CrashLoopBackOff` может иметь `Phase: Running` с warning tone и tooltip с причиной.
- Tooltip доступен не только мышью: значение Phase получает доступное описание через `aria-describedby` либо эквивалентный доступный механизм.
- На touch-устройствах подробность должна открываться по нажатию и закрываться по Escape/нажатию снаружи; нативный `title` допустим только как минимальный desktop fallback, если отдельный tooltip не требуется существующей UI-системой.

## 8. Компактная панель Pod Terminal

Терминал должен отдавать максимальную площадь непосредственно shell, а не собственной обвязке.

### Действия терминала

- Текстовые кнопки `Connect`, `Disconnect`, `Reconnect` и `Clear` заменяются компактными квадратными icon-only controls.
- Используются существующие иконки `lucide-react`; новые SVG и dependency не добавляются.
- Предпочтительное соответствие:
  - Connect — `Play`;
  - Disconnect — `Square` или `CircleStop`;
  - Reconnect — `RotateCw`;
  - Clear — `Eraser`.
- Все controls имеют одинаковую hit area не менее `32 × 32 px`, но не занимают ширину текстовых кнопок.
- Tooltip и доступные названия обязательны:
  - `Connect terminal`;
  - `Disconnect terminal`;
  - `Reconnect terminal`;
  - `Clear terminal`.
- `aria-label` совпадает со смыслом tooltip.
- Disabled state сохраняет текущую логику: Connect недоступен без container или во время активной сессии, Disconnect — без соединения, Reconnect — во время подключения.
- Connecting показывается spinner на месте Connect icon; повторное подключение остаётся заблокированным.
- Clear очищает только видимый terminal buffer и не разрывает соединение.
- Container и Shell остаются select controls, но их labels и высота не должны делать toolbar двухэтажным на обычной ширине панели.
- На узкой панели select controls могут переноситься отдельно от actions; icon buttons остаются одной компактной группой.

### Статус соединения

- Состояние соединения не скрывается вместе с текстами кнопок.
- Вместо длинного `Connected (PTY)` допускается компактная status dot + `PTY`/`Pipes` badge.
- Tooltip статуса содержит полную формулировку: `Connected using PTY`, `Connected using pipes`, `Connecting`, `Disconnected` или последнюю ошибку.
- Цвет не является единственным носителем информации: badge и доступное название сохраняются.
- Дублировать одновременно `Connected (PTY)` и отдельный `PTY` badge не нужно.

### Убрать постоянные подсказки

- Строка `kubectl exec ...` полностью удаляется из обычного интерфейса терминала.
- Backend command preview и audit/debug данные не удаляются из backend-контракта, но постоянно в UI не отображаются.
- Технический текст про fallback `bash → sh → ash` не занимает отдельную строку.
- Объяснение Auto shell переносится в tooltip/help выбора Shell: `Auto tries bash, then sh, then ash`.
- Подсказка о том, что смена container или shell закрывает текущую сессию, показывается только при попытке изменить значение во время соединения либо в tooltip control, а не постоянным абзацем.
- Ошибки подключения, отсутствие shell и PTY fallback продолжают выводиться как реальные status/error, а не скрываются ради компактности.

### Terminal tabs

- Каждая вкладка терминала становится одноэтажной.
- Рекомендуемая высота tab: `32–36 px` вместо карточки с двумя текстовыми строками.
- В видимой части показывается только pod name; container добавляется после разделителя лишь если это помогает различать несколько сессий одного pod.
- Namespace, cluster, полный pod name и container всегда доступны в tooltip.
- Длинное имя обрезается через ellipsis; оно не увеличивает высоту вкладки.
- Рекомендуемая ширина tab: `140–180 px`, без фиксированной ширины `190 px` для коротких имён.
- Close остаётся icon-only, имеет hit area не менее `28 × 28 px`, tooltip и `aria-label` с полным pod name.
- Active tab обозначается фоном/border и не становится выше соседних.
- Горизонтальный scroll появляется только при реальном переполнении нескольких tabs.
- Collapse/expand terminal panel сохраняется и остаётся отдельным icon-only control.

## 9. Автоматические контракты

- [ ] Events отсутствует в `availableDrawerTabs`.
- [ ] Legacy `drawerTab: "events"` нормализуется в `summary`.
- [ ] Глобальный Events section и открытие involved object продолжают работать.
- [ ] Copy name записывает только `row.name` и показывает success только после успешного Clipboard API.
- [ ] Header получает все поддерживаемые действия текущего resource.
- [ ] Действия отсутствуют внутри `.drawer-content` и не размножаются при переключении вкладок.
- [ ] Delete сохраняет danger style и confirmation; Restart/Redeploy/Scale сохраняют существующие command preview.
- [ ] Summary не использует `Object.entries(row)` для generic Details.
- [ ] Summary не показывает UID, raw labels, ownerReferences, apiVersion и name.
- [ ] Pod Summary скрывает restart diagnostics при отсутствии проблем.
- [ ] Pod Summary показывает problem container, reason и exit code при неуспешном restart.
- [ ] Summary показывает Warning events и отбрасывает Normal `Pulled/Created/Started`.
- [ ] Secret Summary никогда не получает и не выводит values.
- [ ] Quota thresholds и сортировка корректны.
- [ ] Generic/CRD fallback не раскрывает произвольные вложенные объекты.
- [ ] Header остаётся доступным с клавиатуры, имеет focus-visible и корректные aria-label.
- [ ] В обычном toolbar resource table отсутствует кнопка и текст `Refresh`.
- [ ] Error/unavailable states сохраняют целевой `Retry`.
- [ ] Удаление UI-кнопки не удаляет watch, reconnect, polling fallback и программное обновление после mutations.
- [ ] Columns использует icon-only кнопку из `lucide-react` без видимого текста.
- [ ] Columns сохраняет tooltip `Choose columns`, `aria-label="Choose visible columns"` и корректный open state.
- [ ] Column picker продолжает открываться, закрываться по Escape/наружному клику и сохранять хотя бы одну видимую колонку.
- [ ] Phase отображает только каноническое значение без `.cell-hint` и второй текстовой строки.
- [ ] `Completed` отображается и фильтруется как `Succeeded`, удаляемый объект — как `Terminating`.
- [ ] CrashLoopBackOff/OOMKilled/ImagePullBackOff не заменяют текст Phase, но доступны в tooltip.
- [ ] Healthy Running без дополнительной причины не получает пустой tooltip.
- [ ] Phase tooltip доступен через hover, keyboard focus и доступное описание.
- [ ] Terminal Connect/Disconnect/Reconnect/Clear не содержат видимого текста и используют смысловые lucide icons.
- [ ] Все terminal actions имеют tooltip, aria-label, корректный disabled state и минимальную hit area.
- [ ] Connecting заменяет Connect icon на spinner и не допускает duplicate connect.
- [ ] В terminal UI отсутствуют постоянные строки `kubectl exec` и `bash → sh → ash`.
- [ ] Backend command preview и terminal audit contract не удалены.
- [ ] Auto shell fallback доступен через tooltip/help выбора Shell.
- [ ] Connected state не дублирует одновременно полный текст и transport badge.
- [ ] Terminal tabs одноэтажные, обрезают длинное имя и сохраняют полный context в tooltip.
- [ ] Закрытие, переключение, collapse/expand и лимит terminal tabs продолжают работать.
- [x] Запустить `npm run test:renderer`.
- [x] Запустить `npm run typecheck`.
- [x] Запустить `npm run lint`.
- [x] Запустить `npm run format:check`.
- [x] Запустить `npm run build`.
- [x] Запустить `npm --workspace apps/desktop run test:gateway`.
- [x] Запустить `npm run verify:release`.
- [x] Запустить `git diff --check`.

## 10. Ручной smoke

- [ ] Pod Running без рестартов: Summary короткий, технического Details dump нет.
- [ ] Pod с CrashLoopBackOff/OOMKilled: причина, контейнер, restart count, exit code и последнее время видны сразу.
- [ ] Pod с обычными Pulled/Created/Started events: эти события не появляются в Summary.
- [ ] Pod с Warning event: событие появляется один раз и не раздувает страницу.
- [ ] Deployment во время rollout и после успешного rollout.
- [ ] Service с ready endpoints и Service без endpoints.
- [ ] Ingress с TLS и несколькими paths.
- [ ] ConfigMap и Secret: видны только безопасные key metadata, значения не раскрываются.
- [ ] Node Ready, cordoned и с pressure condition.
- [ ] PVC Bound и Pending, ResourceQuota ниже 80%, выше 80% и выше 95%.
- [ ] RoleBinding с namespaced и cluster subject.
- [ ] CRD definition и CRD instance без стандартного status.
- [ ] Все действия находятся в header и работают после переключения Summary/YAML/Logs.
- [ ] Copy name вставляется в shell/search как чистое имя.
- [ ] Header проверен на минимальной и максимальной ширине drawer во всех темах.
- [ ] В toolbar Pods, Deployments, Nodes, Events и CRD lists отсутствует постоянный Refresh.
- [ ] Данные продолжают обновляться через watch/auto-refresh и после resource actions.
- [ ] При недоступном кластере и ошибке первой загрузки доступен Retry.
- [ ] Icon-only Columns однозначно читается, показывает tooltip, работает с клавиатуры и открывает прежний picker.
- [ ] Проверить toolbar при узком окне, длинном названии ресурса и активном Filter.
- [ ] Отфильтровать Pods по `Pending`, `Running`, `Succeeded`, `Failed` и `Terminating`; результаты соответствуют видимой Phase.
- [ ] Проверить Running pod с CrashLoopBackOff: в ячейке остаётся `Running`, причина доступна при наведении/focus.
- [ ] Проверить Pending pod с ImagePullBackOff и ContainerCreating: Phase остаётся `Pending`, подробность не растягивает строку.
- [ ] Проверить Terminating pod: предыдущее состояние не показывается вместо `Terminating`.
- [ ] Проверить длинные container/status messages: tooltip читаем, ширина таблицы и высота строки не меняются.
- [ ] Открыть terminal: command preview и постоянные helper-строки отсутствуют, xterm получает больше высоты.
- [ ] Проверить Connect, Disconnect, Reconnect и Clear по иконкам, tooltip и клавиатуре.
- [ ] Проверить Connecting, Connected PTY, Connected Pipes, Disconnected и Connection error без дублирующих status labels.
- [ ] Сменить container/shell во время соединения: предупреждение появляется в момент действия, а не висит постоянно.
- [ ] Открыть терминалы двух одинаково названных pod в разных namespace: tooltip позволяет однозначно определить context.
- [ ] Открыть пять terminal tabs с длинными pod names: tabs остаются одноэтажными, доступны scroll, switch и close.
- [ ] Повторить smoke на macOS и Windows production build.

## 11. Релиз 2.7.4

- [x] После реализации поднять root, desktop, shared-types и lockfile до `2.7.4`.
- [x] Добавить `RELEASE_NOTES_2.7.4.md` и `REGRESSION_CHECKLIST_2.7.4.md`.
- [x] Обновить README и `NODE_MIGRATION_PROGRESS.md`.
- [x] Сохранить Node-only baseline Node 51 / Python 0.
- [x] Не включать в 2.7.4 редизайн sidebar, workspace tabs или terminal dock.

## Критерий готовности

Открыв ресурс, администратор видит его здоровье, главную причину проблемы и доступные действия без прокрутки через технический dump. Events больше не занимает отдельную вкладку, штатные Kubernetes events не создают шум, Copy рядом с именем возвращает чистый `metadata.name`, toolbar таблицы не занимает место постоянным Refresh и текстовой кнопкой Columns, а terminal chrome не отнимает площадь у shell.
