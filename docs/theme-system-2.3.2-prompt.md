# KubeDeck 2.3.2 — Color Themes Implementation Prompt

Статус: реализация, автоматическая проверка и macOS packaging завершены; ручной UI smoke и Windows artifact ожидают проверки на соответствующей машине.

## Прогресс реализации

- [x] Создана отдельная ветка `feat/color-themes-2.3.2`.
- [x] Исследованы существующие Light, Dark, System, Settings, терминалы и цветовые исключения.
- [x] Добавлены Midnight Blue, Nord Frost, Forest Teal, Plum Graphite и Warm Mocha.
- [x] Сохранены Light и System; системный dark mode использует Midnight Blue.
- [x] Legacy `dark` и неизвестные значения безопасно преобразуются в Midnight Blue.
- [x] Выбор сохраняется, восстанавливается до React и применяется без закрытия Settings.
- [x] Добавлены компактные keyboard-accessible карточки выбора темы с preview.
- [x] Создан единый контракт семантических токенов для поверхностей, текста, форм, кнопок, статусов, терминалов, scrollbars и resize.
- [x] Жёсткие UI-цвета основных и вспомогательных панелей перенесены на токены.
- [x] First, Prev, Next, Last и page-size selector приведены к общей гамме и состояниям.
- [x] Pod Terminal и Node SSH Terminal синхронизированы с темой без переподключения.
- [x] Добавлены контракты на normalization, persistence, `data-theme`, System, shared types, tokens и pagination.
- [x] Версия root/desktop/shared/lock синхронизирована на `2.3.2`.
- [x] Обновлены README, README.ru, CHANGELOG, release notes и regression checklist.
- [x] Завершить полный `verify:release` и gateway gate (70/70 gateway tests).
- [x] Собрать и проверить macOS arm64 DMG/ZIP (`2.3.2`, payload valid).
- [x] Синхронизировать Windows Portable x64 config/artifact name на `2.3.2` и проверить release contract.
- [ ] Собрать Windows Portable x64 на Windows и проверить его payload.
- [ ] Выполнить ручной UI smoke каждой темы (встроенный browser недоступен в текущей сессии).

## Задача

Реализовать полноценную систему цветовых тем KubeDeck для релиза `2.3.2`.

Работать в отдельной ветке. Не менять backend, Kubernetes-логику и функциональное поведение приложения. Версию повышать до `2.3.2` после реализации и успешной проверки UI.

## Темы

Сохранить `Light` и `System`, оставить текущую тёмную палитру как `Midnight Blue` и добавить четыре варианта:

1. **Midnight Blue** — текущая спокойная сине-графитовая тема и fallback для старого значения `dark`.
2. **Nord Frost** — холодная серо-синяя палитра, немного светлее Midnight Blue, с мягкими голубыми акцентами.
3. **Forest Teal** — тёмная зелёно-графитовая палитра с приглушёнными бирюзовыми акцентами без кислотных цветов.
4. **Plum Graphite** — графитовая палитра с мягкими сливовыми и фиолетовыми акцентами без чрезмерной насыщенности.
5. **Warm Mocha** — тёплая коричнево-графитовая палитра с песочными и янтарными акцентами.

## Архитектурные требования

- Сначала изучить существующую реализацию `Light`, `Dark` и `System`.
- Сохранить обратную совместимость: сохранённое значение `dark` должно открывать `Midnight Blue`.
- Неизвестное значение темы должно безопасно откатываться на `Midnight Blue`.
- Выбранная тема должна сохраняться и восстанавливаться после перезапуска.
- `System` должен учитывать тему ОС; для системного dark mode использовать `Midnight Blue`.
- Применять тему сразу, без перезапуска и закрытия Settings.
- Не допускать вспышки неправильной темы при запуске.
- Использовать централизованные семантические CSS-токены.
- Не дублировать крупные CSS-блоки и не строить темы на локальных override или `!important`.
- Найти оставшиеся жёстко заданные UI-цвета и безопасно заменить их токенами.
- Не добавлять зависимости без необходимости.

## Обязательные токены

Для каждой темы согласовать:

- фон приложения, sidebar и topbar;
- panel, panel-muted, surface и surface-2;
- hover, active, selected и focus;
- основной, сильный, приглушённый и inverse-текст;
- обычные и усиленные границы;
- input, search, select и textarea;
- button background, border, hover, active и disabled;
- primary и primary-soft;
- code, YAML, Describe, Logs и Terminal;
- overlay, menu shadow и modal shadow;
- success, warning, danger и error;
- scrollbar track и thumb;
- resize handles и drag-and-drop indicators.

## Обязательное покрытие UI

Нельзя ограничиваться основным фоном и панелями. Проверить и привести к общей теме:

- sidebar, список и сортировку кластеров;
- topbar;
- namespace selector и выпадающее меню с длинными именами;
- global search и command palette;
- tabs и subtabs;
- resource tree;
- resource tables, toolbar, headers и rows;
- hover, selected, focused, disabled и loading;
- checkbox, select, input и textarea;
- primary, secondary, danger и icon buttons;
- dropdown, context menu и tooltip;
- badges, chips, статусы и container status cubes;
- pagination: `First`, `Prev`, `Next`, `Last`;
- page-size selector, текущую страницу и счётчики;
- drawers и drawer tabs;
- modal windows и overlays;
- Settings, Problems, Audit, Port Forward, Related Resources, LLM, Help и About;
- YAML editor, Describe, code blocks и Logs viewer;
- Pod Terminal и Node SSH terminal;
- empty, error и unavailable states;
- skeleton/loading indicators;
- scrollbars и resize separators;
- focus rings и клавиатурную навигацию.

## Пагинация

Кнопки `First`, `Prev`, `Next`, `Last` сейчас могут выбиваться из общей гаммы. Перевести их на общие button/surface/border/text-токены и проверить состояния:

- normal;
- hover;
- active;
- focus-visible;
- disabled.

То же требование применить ко всем кнопкам приложения. Не оставлять элементы со случайными или устаревшими цветами.

## Выбор темы

- В Settings добавить понятный selector или компактные карточки.
- Показывать название и небольшую preview-полоску палитры.
- Активную тему явно отмечать.
- Поддержать мышь и клавиатуру.
- Не закрывать Settings после выбора.
- Сохранить существующую логику `System`.

## Требования к палитрам

- Темы должны различаться поверхностями, границами и интерактивными состояниями, а не только primary-цветом.
- Не использовать почти чёрные фоны и чрезмерно насыщенные акценты.
- Основной текст и интерактивные элементы должны соответствовать WCAG AA.
- Warning, danger, success и error должны быть различимы во всех темах.
- Selected не должен выглядеть как error или warning.
- Disabled должен быть различимым, но визуально вторичным.
- Темы должны подходить для длительной работы.

## Автоматические проверки

Добавить контракты на:

- преобразование legacy `dark` в `Midnight Blue`;
- fallback неизвестного значения;
- сохранение и восстановление темы;
- корректный `data-theme`;
- наличие обязательных токенов у каждой темы;
- актуальность shared types;
- использование общих классов и токенов пагинацией;
- корректное поведение `System`;
- отсутствие регрессии Light theme.

Запустить:

```bash
npm run lint
npm run format:check
npm run test:renderer
npm run typecheck
npm run build
npm --workspace apps/desktop run test:gateway
npm run verify:release
```

## Ручной smoke

Для каждой темы проверить:

1. Resource Table, toolbar и пагинацию.
2. Namespace dropdown с короткими и длинными именами.
3. Pod Drawer: Summary, YAML, Logs, Related и Terminal.
4. Settings и модальные окна.
5. Problems, Audit, Port Forward и LLM.
6. Hover, selected, focus и disabled.
7. Scrollbars и resize handles.
8. Сохранение темы после перезапуска.
9. Light и System без регрессий.

## Релиз 2.3.2

После реализации и проверок:

- синхронизировать `2.3.2` в root, desktop, shared package и lock-файле;
- обновить README и README.ru;
- обновить CHANGELOG;
- создать или актуализировать release notes и regression checklist `2.3.2`;
- проверить одинаковую версию macOS и Windows artifacts;
- собрать macOS arm64 DMG/ZIP;
- подготовить Windows Portable x64 и выполнить доступную автоматическую проверку payload.

## Критерий готовности

Система должна выглядеть как единый дизайн-продукт. Во всех темах каждый экран, контрол и интерактивное состояние используют согласованные семантические токены. Не должно оставаться забытых кнопок, панелей, меню, пагинации или состояний со старой случайной палитрой.
