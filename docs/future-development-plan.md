# KubeDeck Future Development Plan

Этот документ фиксирует дальнейшее развитие проекта. Новые идеи сначала добавляются в раздел "Входящие пункты", затем раскладываются по приоритетам и реализуются небольшими проверяемыми изменениями.

## Правила работы

- Двигаться маленькими итерациями: один понятный блок изменений за раз.
- Перед реализацией переносить пункт из "Входящие пункты" в подходящий раздел плана.
- Для каждого реализованного пункта фиксировать результат в "Журнале выполнения".
- Не смешивать продуктовые изменения, рефакторинг и dependency cleanup без явного решения.
- Перед закрытием задачи указывать, какие проверки запускались: typecheck, build, тесты или ручная проверка.

## Текущий фокус

UI-эргономика списков ресурсов и терминала.

## Входящие пункты

Сюда добавляем сырые идеи перед сортировкой.

- DONE: добавить возможность изменять ширину колонок в таблицах ресурсов.
- DONE: добавить возможность изменять ширину левой колонки со списками групп ресурсов.
- DONE: поправить баги отображения терминала при переходе в терминал пода.
- DONE: исправить Windows pod terminal I/O: copy/paste, PTY-gate вместо сломанного pipes fallback, проверка `node-pty` в Windows portable build.
- DONE: стабилизировать геометрию xterm/PTY: корректный `fit`, resize после подключения/первого вывода и CSS без двойного скролла.
- DONE: исправить переключение тем `system/dark/light`: resolver, live system theme, preview в настройках и первый проход CSS-токенов.
- DONE: включить переключение языков `system/ru/en`: resolver, preview в настройках, `html lang` и live system language metadata.
- DONE: добавить быструю очистку фильтра таблиц ресурсов через кнопку `X` внутри поля.
- DONE: добавить поиск по списку namespaces в верхнем селекторе.
- DONE: упростить отображение возраста ресурсов старше 24 часов до количества дней.
- DONE: добавить перестановку колонок таблиц ресурсов drag-and-drop с сохранением порядка.
- DONE: добавить настройку видимости колонок таблиц ресурсов через popover `Columns`.
- DONE: привести action-кнопки таблиц, настроек и модалок к единому стилю.
- DONE: привести кнопки terminal toolbar и drawer actions к общему стилю.
- DONE: поднять версию продукта до стабильной `2.0.6` и убрать beta release metadata.
- DONE: добавить в таблицу Pods отдельную колонку контейнеров со статусными кубиками для multi-container pods.
- DONE: отключить автоматический перенос строк в просмотрщике Logs и оставить горизонтальную прокрутку для длинных log lines.
- DONE: стабилизировать начальную геометрию pod terminal на Windows: передавать `cols/rows` до spawn PTY и убрать обязательный `clear`.

## Ближайшие задачи

Пункты, которые готовы к реализации в следующую очередь.

- TODO: проверить UX ресайза на Windows-сборке и при маленькой ширине окна.
- TODO: вручную проверить Windows pod terminal в portable build: copy, paste, Backspace, Delete, стрелки, Home/End, resize и `stty size`.
- TODO: вручную проверить длинные команды и переносы в Windows pod terminal: `curl -v`, редактирование середины строки, Backspace/Delete на длинной строке.

## Продуктовые улучшения

Функции и UX-улучшения, заметные пользователю.

- Настраиваемая ширина колонок таблиц ресурсов с сохранением между сессиями.
- Настраиваемая ширина левой навигации с группами ресурсов с сохранением между сессиями.
- Стабильное отображение pod terminal при открытии вкладки и изменении размеров drawer/window.
- Надежный pod terminal на Windows: интерактивный режим только через PTY, явные copy/paste hotkeys и видимый транспорт подключения.

## Технический долг

Рефакторинг, архитектурные улучшения и поддержка качества кода.

- TODO: уточнить список.

## Релизная и сборочная инфраструктура

Сборка, упаковка, проверки, release notes и процессы доставки.

- TODO: уточнить список.

## Отложено

Идеи, которые полезны, но сейчас не входят в ближайший фокус.

- TODO: уточнить список.

## Журнал выполнения

Фиксируем выполненные изменения в формате:

- YYYY-MM-DD: что сделано; файлы; проверки.
- 2026-07-08: добавлен ресайз колонок таблиц через `colgroup`, ресайз левой навигации и стабилизация fit/layout pod terminal; файлы `App.tsx`, `ResourceTable.tsx`, `TerminalTab.tsx`, `uiState.ts`, `usePersistUiState.ts`, `app.css`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`.
- 2026-07-08: блок Windows pod terminal I/O на ветке `fix/windows-pod-terminal-io`: добавлен PTY-gate, copy/paste hotkeys, индикатор транспорта, Windows `node-pty` rebuild/check, contract-test на отказ без PTY, запуск PTY через `/bin/sh` wrapper с расширенным `PATH` и macOS `spawn-helper` chmod в packaging hook, чтобы избежать `posix_spawnp failed`; проверки: `npm run typecheck`, `npm run build`, `node --test --test-concurrency=1 apps/desktop/tests/pod-terminal.contract.test.cjs`, `npm --workspace apps/desktop run test:gateway`.
- 2026-07-09: стабилизирована геометрия pod terminal: `FitAddon` отправляет resize только с валидными измененными размерами, добавлен повторный fit после открытия сокета и первого вывода, CSS xterm-контейнера убран от двойного scroll/padding; файлы `TerminalTab.tsx`, `app.css`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`, `node --test --test-concurrency=1 apps/desktop/tests/pod-terminal.contract.test.cjs`.
- 2026-07-09: исправлен первый проход переключения тем: добавлен resolver `system/dark/light`, live update для `prefers-color-scheme`, preview в Settings до Save, dark/light CSS-токены и theme overrides для основных поверхностей; файлы `App.tsx`, `SettingsPanel.tsx`, `theme.ts`, `app.css`, `theme-switching-fix-plan.md`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`, `npm --workspace apps/desktop run test:gateway`.
- 2026-07-09: включен первый проход переключения языков: общий resolver `system/ru/en`, preview в Settings до Save, `html lang`/`data-language`, listener `languagechange` для system и локализованные подписи вариантов; файлы `App.tsx`, `SettingsPanel.tsx`, `i18n.ts`, `language.ts`, `ru.json`, `en.json`, `language-switching-fix-plan.md`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`, `npm --workspace apps/desktop run test:gateway`.
- 2026-07-09: добавлена кнопка очистки `X` внутри фильтра таблиц ресурсов с возвратом фокуса в поле; файлы `ResourceTable.tsx`, `app.css`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`.
- 2026-07-09: добавлен поиск внутри верхнего selector namespaces: поле получает фокус при открытии, фильтрует варианты, показывает empty-state и поддерживает очистку поиска; файлы `NamespaceSelector.tsx`, `App.tsx`, `app.css`, `ru.json`, `en.json`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`.
- 2026-07-09: упрощено отображение возраста: для значений старше 24 часов показывается только количество дней без часов/минут/секунд; файлы `time.ts`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`.
- 2026-07-09: добавлена перестановка колонок таблиц ресурсов через drag-and-drop заголовков, порядок сохраняется в `localStorage` по `stateKey`, чекбокс-колонка остается фиксированной; файлы `ResourceTable.tsx`, `uiState.ts`, `app.css`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`.
- 2026-07-09: добавлена настройка видимости колонок таблиц ресурсов: кнопка `Columns` открывает popover с чекбоксами, скрытые колонки сохраняются в `localStorage` по `stateKey`, `Reset columns` сбрасывает видимость/порядок/ширины текущей таблицы; файлы `ResourceTable.tsx`, `uiState.ts`, `App.tsx`, `app.css`, `ru.json`, `en.json`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`.
- 2026-07-09: унифицирован стиль action-кнопок: `Columns`, `Refresh`, bulk actions, reset в popover, settings/modal/row actions используют общий радиус, вес, hover и theme-токены; файлы `app.css`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`.
- 2026-07-09: вторым проходом унифицированы кнопки drawer actions и terminal toolbar: `Restart/Delete/Terminal/Port forward`, `Connect/Disconnect/Reconnect/Clear` используют общий размер, радиус, hover, disabled и theme-токены; файлы `app.css`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`.
- 2026-07-10: версия продукта поднята до стабильной `2.0.6`: обновлены package metadata, lockfile, README, release notes, regression checklist, release verifier, contract tests, Help version и build artifact paths; проверки: `npm run typecheck`, `npm run build`.
- 2026-07-10: в таблицу Pods добавлена колонка `Контейнеры` со статусными кубиками по каждому контейнеру pod, backend normalizer теперь отдает `containerStates`, а `ready` учитывает `spec.containers`, если `containerStatuses` еще пуст; файлы `normalizers.ts`, `ResourceTable.tsx`, `App.tsx`, `app.css`, `ru.json`, `en.json`, `resource-lists.contract.test.cjs`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`, `node --test --test-concurrency=1 apps/desktop/tests/resource-lists.contract.test.cjs`.
- 2026-07-10: просмотрщик Logs переведен с `pre-wrap` на `pre`, длинные строки больше не переносятся и доступны через нижний горизонтальный scroll; файлы `app.css`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`, `node --test --test-concurrency=1 apps/desktop/tests/resource-details.contract.test.cjs apps/desktop/tests/deployment-logs.contract.test.cjs`.
- 2026-07-10: для pod terminal начальные `cols/rows` теперь передаются в WebSocket URL и используются при spawn PTY, чтобы shell на Windows стартовал с правильной шириной; обязательный `clear` перед shell убран, чтобы не получать `clear: command not found`; файлы `api.ts`, `TerminalTab.tsx`, `podTerminalWebSocket.ts`, `pod-terminal.contract.test.cjs`, `future-development-plan.md`; проверки: `npm run typecheck`, `npm run build`, `node --test --test-concurrency=1 apps/desktop/tests/pod-terminal.contract.test.cjs`.
