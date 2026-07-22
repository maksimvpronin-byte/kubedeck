# KubeDeck 2.4.0 — Async Action Feedback Plan

Статус: реализация и автоматическая проверка завершены; ручной UI/Windows smoke отложен.

## Цель

Сделать ручные асинхронные действия понятными без лишней декоративной анимации. В `2.4.0` основной объём — единое поведение кнопок `Refresh` и `Reload`: пользователь должен сразу видеть начало операции, её успешное завершение или ошибку.

План выполнять по порядку. Завершённые пункты отмечать `[x]` только после соответствующей проверки.

## Границы релиза

Входит в `2.4.0`:

- единая модель состояний `idle → pending → success/error`;
- вращение refresh-иконки только во время ручного запроса;
- явное краткое состояние `Updated` после успеха;
- блокировка повторного запуска одной операции;
- доступность для клавиатуры, screen reader и `prefers-reduced-motion`;
- одинаковое поведение во всех темах KubeDeck;
- покрытие всех ручных `Refresh`/`Reload`, перечисленных ниже.

Не входит в текущий объём:

- декоративная анимация навигации, tabs, pagination, Copy и открытия меню;
- изменение backend, Gateway или Kubernetes-команд;
- анимация фонового auto-refresh и Resource Watch;
- массовая переделка остальных кнопок до завершения refresh-семейства.

Архитектура должна позволять позже подключить тот же feedback к `Save`, `Dry-run`, `Apply`, `Start`, `Restart`, `Stop`, `Analyze`, `Test connection`, `Download` и подтверждённым destructive actions.

## UX-контракт

### Idle

- обычная иконка и исходный label;
- кнопка доступна, если нет других функциональных причин для `disabled`;
- никаких постоянно работающих декоративных эффектов.

### Pending

- refresh/reload-иконка вращается;
- label меняется на локализованный `Refreshing…` или `Reloading…`;
- кнопка получает `disabled` и `aria-busy="true"`;
- повторный клик не запускает параллельный запрос;
- индикатор остаётся видимым не менее 300 мс, чтобы быстрый запрос не выглядел как случайное мерцание.

### Success

- вращение прекращается;
- на 700 мс показываются check-иконка и локализованный label `Updated`/`Reloaded`;
- допускается мягкий success-акцент через существующие semantic tokens;
- после таймера кнопка возвращается в `idle`;
- таймер корректно очищается при unmount и новом запуске.

### Error

- вращение прекращается немедленно;
- кратко показывается статичная error-иконка или label `Refresh failed`/`Reload failed`;
- подробная ошибка остаётся в существующем ErrorPanel или локальном сообщении;
- кнопка снова становится доступной после завершения запроса;
- содержимое технической ошибки не помещается внутрь кнопки.

### Reduced motion

- при `prefers-reduced-motion: reduce` вращение отключается;
- pending остаётся понятным за счёт смены иконки/label и `aria-busy`;
- success/error feedback сохраняется без движения.

## Обязательное покрытие Refresh/Reload

- [x] Resource Table — главная кнопка Refresh.
- [x] Problems — ручное обновление списка проблем.
- [x] Audit — обновление audit events.
- [x] Port Forward — обновление списка сессий.
- [x] Logs — ручное обновление текущего log view.
- [x] Secrets — `Refresh keys` без раскрытия secret values.
- [x] YAML — `Reload` с сохранением существующих предупреждений о локальных изменениях.
- [x] About — обновление runtime/backend информации.
- [x] Resource Cache Diagnostics — Refresh status.
- [x] Watch Diagnostics — Refresh status.

Фоновый refresh по таймеру, Watch event или follow-mode не должен включать success/error-анимацию ручной кнопки.

## Пошаговая реализация

### 1. Зафиксировать baseline

- [x] Убедиться, что ветка основана на принятом `2.3.2`.
- [x] Запустить текущие renderer tests, typecheck и build до изменений.
- [x] Составить точную таблицу существующих `loading`, Promise и error-состояний для десяти кнопок.
- [x] Не менять текущие API-вызовы и функциональный результат действий.

Baseline-карта: Resource Table использует Promise из `useResourceLoader`; Problems, Audit, Port Forward и About имеют локальные async loaders и error state; Logs управляется parent `loading`/refresh token/error; Secrets использует локальный loader/error; YAML — parent Promise/loading/dirty-state; Resource Cache и Watch Diagnostics — локальные loaders/error. Interval/Watch/follow вызовы остаются тихими и не запускают feedback ручной кнопки.

### 2. Общая модель feedback

- [x] Добавить общий тип состояния: `idle | pending | success | error`.
- [x] Добавить небольшой hook для запуска Promise, защиты от повторного запуска и таймеров.
- [x] Поддержать controlled-режим для экранов, где загрузка запускается через token/parent state, например Logs.
- [x] Не добавлять внешние зависимости.
- [x] Не создавать глобальный store для локальных состояний кнопок.
- [x] Гарантировать cleanup таймеров и отсутствие state update после unmount.

### 3. Общий визуальный компонент

- [x] Добавить переиспользуемое содержимое async-кнопки или компактный button wrapper.
- [x] Использовать Lucide `RefreshCw`, `Check` и подходящую error-иконку.
- [x] Сохранить существующие классы кнопок, размеры, semantic tokens и layout.
- [x] Добавить общие CSS-классы для pending/success/error вместо локальных override.
- [x] Не использовать inline animation styles и новые `!important`.
- [x] Не допустить изменения ширины кнопки между состояниями или заметного layout shift.

### 4. Основная Resource Table

- [x] Возвращать Promise из ручного `onRefresh`, не меняя silent auto-refresh.
- [x] Вращать иконку только для ручного запроса.
- [x] Показать `Updated` только после успешного получения актуальных rows.
- [x] Сохранить возможность видеть старые rows во время обновления.
- [x] Проверить empty, initial loading, populated и error состояния контрактами существующего loader.

### 5. Панели верхнего уровня

- [x] Подключить общий feedback к Problems.
- [x] Подключить общий feedback к Audit.
- [x] Подключить общий feedback к Port Forward.
- [x] Подключить общий feedback к About.
- [x] Не показывать ручной success feedback при interval refresh.

### 6. Drawer и Settings diagnostics

- [x] Подключить Logs Refresh через существующий `loading` и refresh token.
- [x] Подключить Secret `Refresh keys` без изменения security boundary.
- [x] Подключить YAML Reload без обхода подтверждений и dirty-state.
- [x] Подключить Resource Cache Diagnostics.
- [x] Подключить Watch Diagnostics.
- [x] Проверить закрытие drawer/settings во время pending и cleanup состояния.

### 7. Локализация и доступность

- [x] Добавить согласованные EN/RU labels для refreshing, reloading, updated, reloaded и failed.
- [x] Добавить `aria-busy` и понятный accessible name во всех состояниях.
- [x] Добавить ненавязчивое `aria-live="polite"` только там, где смены label недостаточно.
- [x] Проверить нативную button-семантику для Tab, Enter и Space.
- [x] Проверить отсутствие focus loss после смены состояния.
- [x] Реализовать `prefers-reduced-motion` fallback.

### 8. Автоматические контракты

- [x] Pending устанавливается синхронно после ручного запуска.
- [x] Повторный запуск во время pending игнорируется.
- [x] Success появляется только после fulfilled Promise.
- [x] Error появляется после rejected Promise и не скрывает существующую ошибку.
- [x] Минимальная длительность pending и success timer детерминированы контролируемым scheduler.
- [x] Cleanup отменяет таймеры и предотвращает поздний state update.
- [x] Reduced motion отключает spin animation.
- [x] Resource Table использует общий async feedback и semantic tokens.
- [x] Все обязательные Refresh/Reload точки покрыты source/renderer contracts.
- [x] Silent auto-refresh не включает ручную анимацию.

### 9. Визуальный smoke

Для каждой точки проверить:

- [ ] idle, pending, success и error;
- [ ] быстрый и медленный ответ;
- [ ] отсутствие двойного запуска;
- [ ] отсутствие layout shift;
- [ ] keyboard focus и disabled;
- [ ] `prefers-reduced-motion`;
- [ ] Light, Midnight Blue, Nord Frost, Forest Teal, Plum Graphite и Warm Mocha;
- [ ] macOS и доступный Windows packaged smoke.

Если встроенный browser недоступен, ручной smoke не отмечать выполненным: зафиксировать это явно и проверить в собранном Electron-приложении.

Текущий результат: встроенное browser-окно недоступно (`iab` не обнаружен), поэтому визуальные пункты выше намеренно не отмечены. macOS DMG/ZIP собраны и автоматически проверены; ручной UI smoke и Windows packaged smoke выполняются отдельно.

### 10. Полный quality gate

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer` — 19/19.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway` — 70/70.
- [x] `npm run verify:release` после обновления версии и документов.
- [x] `git diff --check`.

### 11. Релиз 2.4.0

Версию менять только после завершения реализации и автоматического gate.

- [x] Синхронизировать `2.4.0` в root, desktop, shared package и lock-файле.
- [x] Обновить README и README.ru.
- [x] Обновить CHANGELOG.
- [x] Создать `docs/releases/RELEASE_NOTES_2.4.0.md`.
- [x] Создать `docs/releases/REGRESSION_CHECKLIST_2.4.0.md`.
- [x] Обновить актуальные ссылки и версию в Node migration/release документации.
- [x] Проверить Windows/macOS artifact naming через release contract.
- [x] Собрать и автоматически проверить macOS arm64 DMG/ZIP.
- [ ] Собрать Windows Portable x64 на Windows и проверить payload.

## Будущие кандидаты после Refresh/Reload

Не включать автоматически в `2.4.0`. Подключать отдельным согласованным этапом после оценки refresh-feedback:

1. `Save Settings`, `Dry-run`, `Apply` — spinner + success/error без вращающейся refresh-иконки.
2. `Start`, `Restart`, `Stop Port Forward` — spinner и явный итог операции.
3. `LLM Analyze`, `Rerun`, `Test connection` — длительный pending с сохранением cancel/retry поведения.
4. `Download logs` — pending до фактической готовности файла.
5. Confirmed destructive actions — статичный pending, без pulse и других тревожных декоративных эффектов.

## Критерий готовности

Пользователь однозначно видит, что ручное обновление началось и закончилось. Все Refresh/Reload используют один визуальный и accessibility-контракт, не запускаются повторно во время pending, не анимируются от фоновых обновлений и не ломают темы, layout или существующую функциональность.
