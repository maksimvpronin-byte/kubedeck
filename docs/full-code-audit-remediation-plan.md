# KubeDeck — план проверки и устранения замечаний полного аудита

Статус: секции A–H реализованы; целевые тесты и общий regression gate KubeDeck 2.4.5 пройдены, ручные packaged smoke отложены.

## Цель

Проверить необходимость каждого изменения отдельным воспроизводимым тестом и исправлять только подтверждённые дефекты. Не объединять пункты в общий рефакторинг: каждая секция должна оставаться небольшим независимо проверяемым патчем.

## Правила безопасного выполнения

- Выполнять секции по одной. Следующую начинать только после прохождения локального gate предыдущей.
- Сначала добавлять проверку, которая падает на текущем коде. Если воспроизведения нет, изменение не делать и записать результат в этот документ.
- Не менять публичные HTTP-контракты без отдельной необходимости.
- Не добавлять зависимости: существующих Node, Electron, React и test runner достаточно.
- Не смешивать correctness-исправления с форматированием, переименованиями и архитектурной чисткой.
- Для destructive actions сохранять исходный cluster/resource identity в момент открытия подтверждения.
- Для lifecycle-исправлений проверять normal close, error, timeout и повторный close.
- После каждой секции запускать указанный локальный gate и `git diff --check`.
- Не отмечать пункт `[x]`, пока не пройдены автоматическая проверка и соответствующий ручной smoke.

## Baseline

На момент аудита:

- [x] `npm run lint`;
- [x] `npm run format:check`;
- [x] `npm run typecheck`;
- [x] `npm run build`;
- [x] renderer contract tests — 25/25;
- [x] gateway contract tests — 70/70;
- [x] `npm run verify:release`;
- [x] production `npm audit --omit=dev` — известных уязвимостей нет.

Первоначальный запуск gateway-тестов внутри sandbox не мог открыть `127.0.0.1`; после разрешения локальных тестовых сокетов все 70 тестов прошли. Это инфраструктурное ограничение, не дефект KubeDeck.

## Очерёдность

1. Секция A — защита от destructive action в другом кластере.
2. Секция B — владение Resource Watch.
3. Секция C — достоверная готовность Port Forward.
4. Секция D — корректное завершение Electron и дочерних процессов.
5. Секция E — отмена Global Search.
6. Секция F — согласованное удаление кластера.
7. Секция G — восстановление конфигурации из backup.
8. Секция H — audit retention только после измерения.

Секции A–C — подтверждённые correctness-дефекты. Секции D–G требуют целевого воспроизведения перед реализацией. Секция H является эксплуатационной оптимизацией и не должна блокировать correctness-релиз без измеренного воздействия.

## Секция A — destructive actions привязаны к исходному кластеру

Риск: высокий. Возможное удаление, cordon, uncordon или drain ресурса в другом кластере при совпадающем имени.

Текущее основание:

- `BulkDeleteTarget` и `NodeActionConfirmation` не содержат `clusterId`;
- confirm-функции используют текущий `activeCluster.id`;
- смена активного кластера не очищает pending confirmation во всех путях.

### Проверка необходимости

- [x] Добавить renderer contract: bulk delete хранит исходный `clusterId` и выполняет action/reload только через него.
- [x] Подтвердить по исходному потоку дефект baseline: до исправления confirm использовал текущий `activeCluster.id`.
- [x] Повторить проверку контракта для node actions.
- [x] Проверить поздний drain preview: request generation не позволяет ему восстановить устаревший modal.

Если хотя бы один сценарий воспроизводится, исправление обязательно и является release blocker.

### Минимальное исправление

- Сохранять `clusterId` в `BulkDeleteTarget` и `NodeActionConfirmation` при создании confirmation.
- Выполнять API-вызовы и reload только с сохранённым `clusterId`.
- Закрывать pending confirmations при фактической смене active cluster.
- Для drain preview добавить простой request generation или сравнение сохранённого `clusterId` перед обновлением modal.

Не требуется глобальный action store или новая abstraction.

### Gate

- [x] Wrong-cluster source contracts не проходят на baseline и проходят после исправления.
- [x] Действие использует сохранённый исходный кластер без изменения modal UX.
- [x] Partial failure и Secret redaction contracts сохранены.
- [x] `npm run test:renderer` — 26/26.
- [x] `npm run typecheck`.
- [ ] Ручной smoke с двумя тестовыми кластерами и одинаковым именем ресурса.

Результат реализации:

- `BulkDeleteTarget` и `NodeActionConfirmation` сохраняют `clusterId`;
- delete, node action и последующий reload используют `target.clusterId`;
- смена active cluster закрывает pending confirmations и инвалидирует drain preview;
- поздний preview отбрасывается по request generation;
- lint, format check, renderer tests, typecheck, build и `git diff --check` проходят.

## Секция B — явное владение Resource Watch

Риск: высокий для актуальности данных. Новый renderer-effect может остаться без работающего `kubectl watch` после cleanup старого effect.

Текущее основание:

- backend дедуплицирует watch и возвращает `alreadyRunning`;
- renderer запоминает owner только когда `alreadyRunning === false`;
- cleanup первого effect останавливает общий watch, не зная о более новом подписчике.

### Проверка необходимости

- [ ] Добавить детерминированный тест последовательности `start A → start B(alreadyRunning) → cleanup A`.
- [ ] После cleanup A подтвердить состояние manager и возможность B получать события.
- [ ] Повторить при cleanup A до завершения его `startWatch` Promise.
- [ ] Проверить React Strict Mode-style mount/cleanup/mount без реального браузера через небольшой controller test.

Тест должен падать на текущем ownership-контракте. Если manager намеренно задуман как глобальный диагностический watch, зафиксировать это и убрать автоматический `stopWatch` из hook вместо добавления reference counting.

### Минимальное исправление

Предпочтительный короткий вариант: renderer автоматически запускает watch, но не останавливает дедуплицированный manager watch при cleanup; manager завершает процессы при удалении кластера и shutdown. Если измерения покажут неприемлемое накопление неактивных watch, добавить lease/reference count на backend отдельным патчем.

### Gate

- [ ] Быстрая смена resource/namespace не оставляет активную таблицу без событий.
- [ ] Один key создаёт не больше одного `kubectl watch`.
- [ ] Удаление кластера и shutdown останавливают watches.
- [ ] Диагностический ручной Stop сохраняет поведение.
- [ ] `watch.contract.test.cjs` и renderer contracts.

Результат реализации:

- renderer больше не вызывает `stopWatch` при cleanup локального effect;
- дедупликация, ручной Stop, удаление кластера и shutdown остаются в backend manager;
- targeted renderer contracts — 27/27, targeted watch contracts — 5/5;
- ручной smoke быстрой смены resource/namespace отложен.

## Секция C — Port Forward считается готовым только после ready-сигнала

Риск: высокий для достоверности операции. Текущий timeout считает любой живой процесс готовым, даже если порт не открыт.

### Проверка необходимости

- [ ] Добавить unit/contract test с дочерним процессом, который испускает `spawn`, остаётся живым и не пишет ready/error marker.
- [ ] По окончании `readinessTimeoutMs` текущий код должен ошибочно вернуть `running`; тест фиксирует дефект.
- [ ] Отдельно проверить marker, разбитый между несколькими stdout/stderr chunks.
- [ ] Проверить медленный, но корректный ready marker до deadline.

### Минимальное исправление

- По readiness timeout вызывать `failReady`, а не `finishReady`.
- Сохранить существующие stdout/stderr ready markers.
- Не добавлять второй сетевой probe, пока marker-based тесты не покажут его необходимость.

### Gate

- [ ] Живой процесс без marker завершается ошибкой и уничтожается.
- [ ] Ready marker переводит session в `running`.
- [ ] Error marker и ранний exit сохраняют текущие коды ошибок.
- [ ] Повторный start после timeout доступен.
- [ ] `port-forward.contract.test.cjs`.

Результат реализации:

- readiness timeout всегда возвращает `PORT_FORWARD_FAILED`, если ready marker не получен;
- зависший процесс останавливается и session удаляется;
- targeted Port Forward contracts — 3/3.

## Секция D — Electron дожидается gateway shutdown

Риск: высокий, но сначала требуется runtime-подтверждение. Возможны осиротевшие `kubectl`, SSH и terminal процессы.

### Проверка необходимости

- [ ] Добавить тестируемый shutdown coordinator без Electron mock-фреймворка: одна Promise, повторные вызовы возвращают её же.
- [ ] Проверить текущую последовательность `before-quit`: приложение не ожидает `gateway.close()`.
- [ ] В packaged/dev smoke запустить долгий port-forward и watch, закрыть приложение, затем проверить процессы через `ps` на macOS и `Get-CimInstance Win32_Process` на Windows.
- [ ] Проверить обычное закрытие окна, Quit из ОС и завершение после startup failure.

Если процессы гарантированно завершаются Electron/OS process tree на обеих платформах, ограничиться тестом и документированием. Если хотя бы один процесс остаётся, исправление обязательно.

### Минимальное исправление

- Сделать shutdown idempotent.
- На первом `before-quit` вызвать `event.preventDefault()`, дождаться `gateway.close()`, затем разрешить окончательный quit флагом.
- Не ждать shutdown отдельно в `window-all-closed` и `will-quit`; все пути направить в один coordinator.
- Добавить конечный timeout только как защиту от вечного зависания, не как основной путь.

### Gate

- [ ] `gateway.close()` вызывается один раз.
- [ ] Повторный quit во время shutdown не запускает второй cleanup.
- [ ] После выхода нет процессов KubeDeck `kubectl port-forward/watch/exec`.
- [ ] macOS activate/reopen продолжает работать.
- [ ] Windows и macOS packaged smoke.

Результат реализации:

- gateway shutdown стал idempotent Promise;
- первый `before-quit` задерживает выход через `preventDefault()`;
- повторный `app.quit()` выполняется только после завершения gateway cleanup;
- разрозненные cleanup-вызовы из `window-all-closed` и `will-quit` удалены;
- targeted Node runtime contract — 1/1;
- проверка реальных процессов в packaged macOS/Windows отложена.

## Секция E — Global Search прекращает фоновую работу после timeout/abort

Риск: средний. HTTP-ответ завершается, но worker Promise и активные `kubectl` могут продолжить работу.

### Проверка необходимости

- [ ] Расширить timeout test счётчиком started/completed/killed commands.
- [ ] После `SEARCH_TIMEOUT` подождать больше длительности worker и проверить, запускаются ли новые sources.
- [ ] Проверить `runner.activeCount()` после завершения ответа.
- [ ] Повторить с клиентским AbortController, а не только серверным total timeout.
- [ ] Измерить пиковое число процессов при пяти быстрых поисках.

Если после timeout новые sources не запускаются, но уже активные команды завершаются в пределах малого command timeout, оценить реальную стоимость перед расширением runner API. Не добавлять сложную cancellation architecture без измеренного накопления.

### Минимальное исправление

- Сначала запретить worker-циклам брать новые specs после общего deadline.
- Если активные команды остаются заметно долго, добавить scoped cancellation только для search commands; не использовать глобальный `runner.close()`.
- Прокинуть HTTP abort лишь после отдельного теста disconnected client.

### Gate

- [ ] После deadline не запускаются новые sources.
- [ ] Активные search commands отменяются либо гарантированно завершаются в установленный короткий срок.
- [ ] Частичные результаты и `SEARCH_TIMEOUT` сохраняются.
- [ ] Параллельный обычный resource request не отменяется.
- [ ] `search.contract.test.cjs`.

Результат реализации:

- `KubectlRunner.run/runJson` получили необязательный scoped `AbortSignal`;
- общий Search timeout сначала выставляет stop-флаг, затем отменяет только search commands;
- параллельные команды общего runner не закрываются;
- targeted Search contracts — 7/7;
- targeted Kubectl cancellation contract — 1/1.

## Секция F — удаление кластера имеет однозначный результат

Риск: средний. Config commit выполняется до удаления managed kubeconfig; ошибка unlink превращает успешное удаление записи в ответ failure.

### Проверка необходимости

- [ ] В тесте заставить удаление managed kubeconfig вернуть `EACCES`/`EBUSY` после успешного save.
- [ ] Проверить HTTP-ответ и содержимое `config.json`.
- [ ] Проверить повторный DELETE и наличие orphan-файла.
- [ ] Уточнить продуктовый контракт: удаление кластера означает удалить запись или обязательно также удалить управляемую копию kubeconfig.

### Минимальное исправление

Предпочтительный безопасный контракт: удаление записи кластера является основной операцией; невозможность удалить managed-файл возвращается как warning/`removedManagedFile: false`, но не превращает уже совершённое удаление в failure. Не пытаться откатывать config после неудачного unlink без отдельного транзакционного дизайна.

### Gate

- [ ] Клиент получает ответ, соответствующий фактическому состоянию config.
- [ ] Внешний kubeconfig никогда не удаляется.
- [ ] Managed path/symlink защита сохраняется.
- [ ] Удаление активного кластера останавливает его terminal, SSH, port-forward и watch sessions.
- [ ] `gateway.contract.test.cjs`.

Результат реализации:

- cluster session cleanup теперь ожидается до удаления записи;
- ошибка unlink managed kubeconfig не превращает уже совершённое удаление записи в HTTP failure;
- orphaned managed copy остаётся recoverable и отражается как `removedManagedFile: false` в audit;
- targeted cluster removal contract — 1/1.

## Секция G — восстановление конфигурации использует только валидный backup

Риск: средний. Backup создаётся, но при повреждении основной конфигурации приложение сразу сохраняет defaults.

### Проверка необходимости

- [ ] Создать валидный `config.backup.json` и повреждённый `config.json`; проверить текущий результат `load()`.
- [ ] Проверить backup с невалидной схемой: он не должен восстанавливаться.
- [ ] Проверить повреждение только одного settings-поля и ожидаемый продуктовый контракт миграции.
- [ ] Проверить права/ошибки чтения отдельно от JSON corruption: нельзя перезаписывать config при временном `EACCES`.

Последний пункт обязателен до исправления: текущий общий `catch` не различает повреждённые данные и временную filesystem-ошибку.

### Минимальное исправление

- Разделить read/parse/normalize ошибки и filesystem access errors.
- Восстанавливать backup только если он успешно читается и проходит `normalizeConfig`.
- Сохранять повреждённый основной файл как recovery copy.
- Не записывать defaults при `EACCES`, `EBUSY` и других временных ошибках доступа.
- Не создавать новую migration framework.

### Gate

- [ ] Валидный backup восстанавливает clusters/settings.
- [ ] Невалидный backup не заменяет recovery copy.
- [ ] Временная ошибка чтения не уничтожает основной config.
- [ ] Defaults создаются только при реальном отсутствии конфигурации или отсутствии любого валидного recovery source.
- [ ] Новый небольшой config-store contract test.

Результат реализации:

- read/access errors больше не попадают в ветку JSON recovery;
- backup восстанавливается только после успешного `normalizeConfig`;
- повреждённый основной файл сохраняется как `config.broken.json`;
- invalid/missing backup приводит к defaults только после подтверждённой parse/normalize ошибки primary config;
- targeted config recovery contract — 1/1.

## Секция H — audit retention после измерения

Риск: низкий без данных эксплуатации. Файл растёт без лимита, а `read()` синхронно загружает его целиком.

### Проверка необходимости

- [ ] Зафиксировать размеры audit-файлов на реальных долгоживущих установках без чтения содержимого.
- [ ] Benchmark `read(200)` на 10, 100, 500 МБ и измерить блокировку main process.
- [ ] Оценить скорость роста при включённых watches и обычных действиях.
- [ ] Согласовать retention: максимальный размер, срок или число файлов.

Synthetic benchmark текущего полного чтения:

- 10 МБ — 12,6 мс;
- 100 МБ — 101,4 мс.

Задержка растёт линейно и выполняется в Electron main process, поэтому ограничение размера признано необходимым. 500 МБ не создавались: две точки уже подтвердили линейный характер, а дополнительный большой временный файл не изменил бы решение.

### Минимальное исправление

Первый пороговый вариант: ротация `audit.jsonl` по согласованному размеру с одной recovery-копией. Оптимизацию чтения хвоста делать только если benchmark отдельно показывает проблему.

### Gate

- [ ] Ротация не разрывает JSONL-событие.
- [ ] Последние события читаются в правильном порядке.
- [ ] Ошибка ротации не ломает основное действие пользователя.
- [ ] Secret redaction сохраняется во всех файлах.
- [ ] Audit export/панель корректны до и после ротации.

Результат реализации:

- добавлена простая ротация при 20 МБ с одной копией `audit.previous.jsonl`;
- `read()` объединяет previous и current, сохраняя порядок последних событий на границе ротации;
- порог передаётся в constructor для маленького детерминированного теста без production-конфигурации;
- ошибка storage/rotation остаётся best-effort и не ломает пользовательское действие;
- targeted audit rotation contract — 1/1;
- ручная проверка Audit panel/export отложена.

## Общий regression gate после каждой реализованной секции

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`; 27/27 tests.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway`; 73/73 tests.
- [x] `npm run verify:release`.
- [x] `git diff --check`.
- [x] Worktree просмотрен: в патч не попали несвязанные изменения и generated artifacts.

## Рекомендуемое разбиение на патчи

Каждый пункт — отдельный commit/PR после подтверждающего теста:

1. `fix: bind bulk confirmations to source cluster`
2. `fix: preserve resource watch ownership across renderer effects`
3. `fix: require port-forward readiness signal`
4. `fix: await gateway shutdown before Electron quit`
5. `fix: stop global search work after deadline`
6. `fix: make cluster removal result consistent`
7. `fix: recover config from validated backup`
8. `chore: bound audit storage` — только после измерения.

Не объединять эти патчи: у них разные риски, способы отката и manual smoke.

## Критерий завершения плана

План завершён, когда для каждого замечания выполнено одно из двух:

1. дефект воспроизведён, исправлен минимальным патчем и прошёл автоматический и ручной gate; или
2. необходимость изменения опровергнута измерением/тестом, результат и причина отказа от изменения записаны в соответствующей секции.
