# KubeDeck 2.7.2 — изоляция недоступного кластера

Статус: функциональная реализация завершена; автоматические проверки пройдены, требуется ручной smoke на macOS и Windows.

## Проблема

Если один кластер недоступен, KubeDeck показывает ошибку и запускает фоновую повторную проверку. Эта проверка записывает cluster id в общее состояние `openingClusterId`, а `ClusterPanel` использует наличие любого id как глобальный `actionsDisabled`. В результате недоступность одного кластера временно блокирует открытие и управление всеми остальными кластерами.

Дополнительно retry-effect зависит от `openingClusterId`: silent retry выставляет id, эффект пересоздаётся, после ошибки id очищается и retry может стартовать снова немедленно, не дожидаясь следующего 10-секундного интервала.

## Цель патча

- Ошибка одного кластера не блокирует остальные кластеры и импорт kubeconfig.
- Фоновый retry не отображается как ручное открытие и не отключает UI.
- Пользователь может сразу открыть другой кластер; поздний ответ старой попытки игнорируется.
- Недоступный кластер остаётся доступен для ручного Retry, Rename и Remove.
- Не менять Gateway API, формат config и Kubernetes-команды.
- Выровнять controls нижней панели терминала в одну линию.
- Привести Cancel/Confirm в Node Action modal к общему стилю кнопок KubeDeck.
- Удалить постоянный success/requested banner после Cordon, Uncordon и Drain.
- Всегда показывать выбранные namespace вверху Namespace Selector.
- Разрешить безопасно редактировать текстовые значения существующих Secret keys.
- Добавить массовое удаление Pod, использующих открытый PVC, из вкладки Related.
- Добавить сравнение YAML двух открытых ресурсов одного kind.
- Добавить графическое использование ResourceQuota в Summary.

## 1. Двойная проверка перед изменением

### Проверка controller

- [ ] Подтвердить, что `openCluster(cluster, true)` выставляет `openingClusterId` во время silent retry.
- [ ] Подтвердить цикл `opening id → cleanup retry-effect → clear id → immediate retry` при повторной ошибке.
- [ ] Проверить, что существующий `clusterOpenSequenceRef` уже отклоняет поздний результат, если пользователь открыл другой кластер.

### Проверка UI

- [ ] Подтвердить, что `ClusterPanel.actionsDisabled` зависит от любого непустого `openingClusterId`.
- [ ] Зафиксировать, какие действия реально конфликтуют только с текущей карточкой, а какие должны оставаться доступными глобально.
- [ ] Проверить Settings, topbar selector и unavailable-cluster Retry: все пути должны использовать одну политику открытия.

## 2. Минимальное исправление controller

- [ ] Не выставлять `openingClusterId` для `silent` retry.
- [ ] Не очищать ручной pending-state из завершившегося фонового запроса.
- [ ] Сохранить retry с интервалом 10 секунд без немедленного цикла после каждой ошибки.
- [ ] Сохранить request generation: новая ручная попытка делает старый silent response неактуальным.
- [ ] При успешном retry активировать кластер и очистить unavailable/error state как раньше.
- [ ] При неуспешном retry не очищать данные уже открытого другого кластера.

## 3. Локализовать блокировки ClusterPanel

- [ ] Кнопка Open показывает pending и блокируется только у вручную открываемого кластера.
- [ ] Open другого кластера остаётся доступной и переключает цель открытия.
- [ ] Import kubeconfig не блокируется из-за недоступного кластера или silent retry.
- [ ] Rename и Remove другого кластера остаются доступными.
- [ ] Rename/Remove карточки, которая прямо сейчас открывается вручную, блокируются до завершения её попытки.
- [ ] Reorder блокируется только собственной операцией сохранения порядка; недоступность кластера не замораживает список.

## 4. Выровнять terminal toolbar

- [ ] Исправить выравнивание на общем `.terminal-toolbar`, без индивидуальных `margin` для кнопок и badges.
- [ ] Сохранить labels `Container` и `Shell` над selectors, но выровнять сами controls с кнопками по нижней границе.
- [ ] Сохранить адаптивный `flex-wrap` для узкого окна.
- [ ] Не менять размеры, цвета, поведение themed selects и terminal connection lifecycle.

## 5. Унифицировать кнопки Node Action modal

- [ ] Подключить footer Node Action modal к существующему `.modal-actions`, не создавать отдельную палитру кнопок.
- [ ] Cancel использует стандартный secondary action, Confirm — стандартный primary action.
- [ ] Сохранить размеры, spacing, hover, focus-visible и disabled states общих modal buttons.
- [ ] Не менять подтверждение Cordon/Uncordon/Drain, command preview и закрытие modal.

## 6. Удалить Node Action status banner

- [ ] Удалить `nodeActionMessage` и `clearNodeActionMessage` из `useBulkResourceActions`.
- [ ] Удалить `.action-status-panel` из `App`; не заменять его toast или новым окном.
- [ ] После успешного Cordon/Uncordon/Drain молча обновлять список Nodes.
- [ ] Ошибки, partial result и безопасный command preview продолжать показывать через общий `ErrorPanel`.
- [ ] Сохранить закрытие confirmation modal перед выполнением и защиту от повторного Confirm.
- [ ] Удалить ставшие неиспользуемыми стили status banner, только если у них нет других callers.

## 7. Закрепить выбранные namespace наверху

- [ ] При открытии selector без поискового запроса показывать выбранные namespace первыми.
- [ ] При поиске сохранять выбранные namespace наверху, даже если они не совпадают с запросом.
- [ ] После выбранных показывать остальные совпадения в текущем стабильном порядке и без дублей.
- [ ] При нескольких выбранных namespace сохранять порядок выбора.
- [ ] `All namespaces` оставить отдельной первой строкой; `_cluster` не выводить в namespaced-списке.
- [ ] После снятия галочки namespace сразу возвращается на своё обычное место в списке.
- [ ] Не менять сохранение selection по кластерам и логику фактической фильтрации ресурсов.

## 8. Редактирование значений Secret

### UI и lifecycle

- [ ] Показывать Edit только для раскрытого, валидного текстового значения; hidden и binary-like значения не редактируются.
- [ ] В режиме Edit заменить viewer на textarea с Save и Cancel в общем стиле KubeDeck.
- [ ] Разрешить редактировать только один ключ одновременно и хранить draft только в памяти renderer.
- [ ] Перед Save показать confirmation с cluster, namespace, Secret name и key; значение в confirmation не дублировать.
- [ ] Подключить dirty-state к общей защите drawer navigation, чтобы несохранённый Secret draft нельзя было потерять молча.
- [ ] Для immutable Secret отключить Edit с понятной причиной.
- [ ] После Save заново загрузить metadata ключей, очистить draft и скрыть сохранённое значение.
- [ ] Add, delete, rename keys и binary editing оставить YAML-вкладке.

### Безопасный backend update

- [ ] Добавить отдельную операцию обновления одного существующего Secret key; принимать `key` и новый decoded `value` только в JSON body.
- [ ] Ограничить размер body/value и проверить cluster, namespace, Secret name и key существующими validators.
- [ ] Загрузить актуальный Secret, отклонить immutable, отсутствующий key и invalid base64 до изменения.
- [ ] Кодировать новый UTF-8 value в base64 только в backend.
- [ ] Выполнить точечный JSON Patch через stdin с проверкой текущего `metadata.resourceVersion`, чтобы конкурентное изменение завершалось conflict, а не перезаписью.
- [ ] Не помещать decoded/base64 value в URL, command arguments, command preview, stdout/stderr, logs, errors или audit.
- [ ] В audit сохранять только cluster/namespace/name/key, byte count, result и безопасный action `secret.update`.
- [ ] После успеха инвалидировать resource cache для кластера.

## 9. Массово удалить Pod, удерживающие PVC

- [ ] Показывать действие только в Related открытого PersistentVolumeClaim и только если найдены связи Pod с relation `mounts this PVC`.
- [ ] Разместить `Delete all listed Pods` в header группы Pods; количество целей показывать на кнопке.
- [ ] Формировать цели только из deduplicated Related links текущего PVC с точными `namespace/name`.
- [ ] Переиспользовать существующие bulk-delete confirmation, поштучный `resourceAction(..., "delete")`, partial failures и redaction; новый Gateway route не добавлять.
- [ ] В confirmation перечислить все Pod и предупредить: controller-managed Pod обычно создаются заново, standalone Pod удаляются без автоматического восстановления.
- [ ] Повторно проверить cluster id, namespace и список целей при Confirm; не использовать текущий namespace selector как источник scope.
- [ ] Заблокировать повторный запуск до завершения текущей операции.
- [ ] После выполнения обновить Related текущего PVC и список Pods, не переключая resource tab или namespace selector.
- [ ] Если один или несколько Pod уже исчезли, считать Not Found безопасным результатом только после проверки фактического отсутствия; остальные ошибки показать как partial result.
- [ ] Не объединять это действие с удалением самого PVC: пользователь запускает операции отдельно и видит результат каждой.

## 10. Compare YAML открытых ресурсов

### Выбор сравнения

- [ ] Добавить в YAML toolbar кнопку Compare для Pod, Deployment, Service и Ingress.
- [ ] По нажатию показывать themed chooser из других сохранённых resource tabs того же Kubernetes kind; текущую вкладку исключить.
- [ ] В строке кандидата показывать cluster, namespace и name, чтобы различать одинаковые имена в разных контурах.
- [ ] Поддержать сравнение между namespaces одного кластера и между разными кластерами.
- [ ] Если совместимых вкладок нет, оставить Compare disabled с подсказкой открыть второй ресурс двойным кликом.
- [ ] Не изменять active cluster, namespace selector, resource table и активную resource tab при выборе цели.

### Получение и нормализация

- [ ] Загружать target YAML по identity сохранённой вкладки через существующий `resourceText`; не хранить манифесты постоянно в workspace tabs.
- [ ] Текущей стороной считать содержимое YAML editor; при несохранённом draft явно помечать сторону как Unsaved.
- [ ] Проверять request generation: поздний ответ предыдущего Compare не заменяет новую пару.
- [ ] По умолчанию сравнивать Clean manifest без `status`, `metadata.uid`, `resourceVersion`, `generation`, `creationTimestamp`, `managedFields`, `selfLink` и last-applied annotation.
- [ ] Стабильно сортировать ключи объектов, не меняя порядок массивов.
- [ ] Добавить переключатель Clean / Raw без повторного запроса YAML.
- [ ] При invalid/multi-document YAML показать локальную ошибку сравнения и не затрагивать YAML editor.

### Diff UI

- [ ] Показывать read-only side-by-side diff с заголовками обеих сторон `cluster · namespace/name`.
- [ ] Подсвечивать added, removed и changed lines, показывать номера строк и синхронизировать вертикальный scroll.
- [ ] Добавить Copy left, Copy right и Close; не добавлять Apply/Merge в 2.7.2.
- [ ] Ограничить размер/число строк для безопасной работы renderer и показать понятное сообщение при превышении лимита.
- [ ] Использовать `diff` как одну прямую renderer dependency и её line-diff API; не писать собственный diff-алгоритм и не отправлять YAML в backend для сравнения.
- [ ] При закрытии target resource tab закрыть либо инвалидировать связанное Compare без stale content.

## 11. ResourceQuota usage в Summary

### Данные

- [ ] Добавить специализированный normalizer для `resourcequotas/resourcequota` вместо generic summary.
- [ ] Брать quota из Kubernetes JSON `status.used` и `status.hard`; не запускать отдельный `kubectl describe`.
- [ ] Передавать в renderer стабильный массив строк `{ resource, used, hard }`, сохраняя исходные Kubernetes quantity strings.
- [ ] Добавить scopes/scopeSelector как компактную policy-информацию, если они заданы.
- [ ] Для успешно загруженной ResourceQuota не показывать красный `Status: unknown`; использовать нейтральный/успешный статус при наличии quota status.

### Визуализация

- [ ] В Summary добавить секцию `Quota usage` со строкой на каждый resource: имя, Used, Hard, процент и progress bar.
- [ ] Корректно сравнивать DecimalSI/BinarySI quantities, CPU millicores, memory/storage bytes и целочисленные object counts.
- [ ] Сохранять исходные значения рядом с графиком (`500m / 2`, `1Gi / 4Gi`, `7 / 10`).
- [ ] Использовать semantic tones: normal, warning при 80%+, danger при 95%+; значения выше 100% не ломают ширину bar.
- [ ] Если quantity отсутствует, равен нулю либо не распознан, показывать Used/Hard без ложного процента и bar.
- [ ] Стабильно сортировать rows по resource name и адаптировать layout под узкий drawer.
- [ ] Не менять отдельную Describe-вкладку и не дублировать весь её текст в Summary.

## 12. Автоматические контракты

- [ ] Добавить тест: silent retry не меняет `openingClusterId` и не запускает немедленный retry-loop.
- [ ] Добавить тест: pending одного cluster id не отключает Open другого кластера.
- [ ] Проверить stale result: медленная ошибка/успех первого кластера не заменяет второй выбранный кластер.
- [ ] Проверить failure cleanup: после ручной ошибки pending снимается только с её карточки.
- [ ] Добавить layout-contract: terminal selects, action buttons и status badges выровнены по нижней границе общей toolbar-строки.
- [ ] Добавить contract: Node Action footer использует общий класс `.modal-actions` и стандартные primary/secondary button tokens.
- [ ] Обновить contract: Node Actions не создают и не рендерят requested/completed banner, но сохраняют error/partial-result feedback.
- [ ] Расширить `filterNamespaces` contract: выбранные namespace первые при пустом и заполненном поиске, порядок стабилен, дублей нет.
- [ ] Добавить Secret update contracts: success, immutable, missing key, invalid base64, oversized value, RBAC/kubectl failure и resourceVersion conflict.
- [ ] Проверить, что новое и старое значения отсутствуют в audit, logger output, error payload и command preview, а patch передаётся только через stdin.
- [ ] Добавить renderer contract на reveal → edit → confirm → save/cancel и dirty navigation guard.
- [ ] Если добавляется новый Gateway route, синхронизировать route ownership и Node-only release count.
- [ ] Добавить Related PVC contracts: кнопка только для `mounts this PVC`, dedupe целей, точные namespaces, confirmation и отсутствие кнопки у других resources.
- [ ] Проверить controlled/standalone warning, pending-защиту, successful refresh и partial failure без утечки несвязанных Pod.
- [ ] Добавить contracts выбора Compare: только другой сохранённый tab того же kind, корректные cross-cluster identities и отсутствие навигационных side effects.
- [ ] Проверить Clean normalization, Raw mode, stable key order, сохранение array order и маркировку Unsaved draft.
- [ ] Проверить line diff для added/removed/changed/equal, пустых документов, Unicode, длинных строк и size limit.
- [ ] Проверить stale/cancelled fetch, закрытие target tab, ошибки второго кластера и отсутствие Kubernetes payload в logs/audit.
- [ ] Добавить normalizer contracts для ResourceQuota hard/used, scopes, отсутствующего status и стабильного порядка.
- [ ] Добавить quantity contracts для `m`, decimal, `Ki/Mi/Gi/Ti`, object counts, zero, unknown suffix и over-limit usage.
- [ ] Добавить renderer contract: Quota usage только для ResourceQuota, корректные thresholds и fallback без процента.
- [ ] Запустить `npm run test:renderer`.
- [ ] Запустить `npm run typecheck`.
- [ ] Запустить `npm run lint`.
- [ ] Запустить `npm run format:check`.
- [ ] Запустить `npm run build`.
- [ ] Запустить `npm --workspace apps/desktop run test:gateway`.
- [ ] Запустить `npm run verify:release`.
- [ ] Запустить `git diff --check`.

## 13. Ручной smoke

- [ ] Добавить рабочий и заведомо недоступный kubeconfig.
- [ ] Открыть недоступный кластер и дождаться ошибки.
- [ ] Немедленно открыть рабочий кластер — переход должен выполняться без ожидания retry.
- [ ] Во время фоновых retry проверить Import, Rename, Remove и reorder на другой карточке.
- [ ] Удалить недоступный кластер во время ожидания; retry должен прекратиться без новой ошибки.
- [ ] Вернуть доступность кластера и проверить успешное фоновое восстановление.
- [ ] Проверить terminal toolbar с короткими и длинными именами Pod/container: selectors, Connect/Disconnect/Reconnect/Clear и PTY status стоят на одной линии.
- [ ] Проверить перенос toolbar на узком окне: элементы переносятся целыми группами и сохраняют выравнивание внутри каждой строки.
- [ ] Открыть Cordon, Uncordon и Drain modal; Cancel/Confirm должны совпадать с кнопками остальных modal во всех темах.
- [ ] Выполнить успешные Cordon/Uncordon/Drain: список обновляется без зелёного banner и кнопки Close.
- [ ] Смоделировать частичную ошибку Node Action: подробности остаются в `ErrorPanel`.
- [ ] Выбрать один и несколько namespace из длинного списка, закрыть и снова открыть selector — выбранные видны сразу наверху.
- [ ] Ввести запрос другого namespace: выбранные остаются наверху и их можно быстро снять.
- [ ] Раскрыть текстовый Secret key, изменить однострочное и многострочное значение, подтвердить Save и проверить результат повторным Reveal.
- [ ] Отменить edit и перейти на другую resource tab с изменённым draft — значение не сохраняется и не теряется без предупреждения.
- [ ] Проверить immutable, binary-like и RBAC denied Secret: редактирование недоступно либо завершается безопасной ошибкой без утечки значения.
- [ ] Открыть PVC с несколькими Pod в Related, подтвердить массовое удаление и проверить создание новых controller-managed Pod.
- [ ] Проверить PVC без Pod и другой тип ресурса: destructive-кнопка отсутствует.
- [ ] Удалить один Pod до Confirm и смоделировать RBAC failure второго: итог корректно разделяет отсутствующие, успешные и failed targets.
- [ ] Открыть по две вкладки Pod, Deployment, Service и Ingress из разных namespaces/кластеров и сравнить каждую пару.
- [ ] Проверить Clean/Raw, синхронный scroll, длинные manifests, Copy и закрытие одной из сравниваемых вкладок.
- [ ] Изменить текущий YAML без Apply: Compare показывает Unsaved и использует draft, защита навигации сохраняется.
- [ ] Открыть ResourceQuota с CPU, memory, storage и object-count limits; сверить Used/Hard с Describe.
- [ ] Проверить 0%, 80%+, 95%+, over-limit и отсутствующий/неизвестный quantity на узком и широком drawer.
- [ ] Повторить сценарий на macOS и Windows production build.

## 14. Релиз 2.7.2

- [ ] После подтверждения исправления поднять root, desktop, shared-types и lockfile до 2.7.2.
- [ ] Добавить release notes и regression checklist 2.7.2.
- [ ] Не включать новые функции и несвязанный рефакторинг.

## Критерий готовности

Недоступность и фоновые retry одного кластера локализованы внутри этого кластера. Остальные кластеры и операции управления остаются доступными, новый ручной выбор всегда имеет приоритет, а фоновые попытки выполняются не чаще заданного интервала.
