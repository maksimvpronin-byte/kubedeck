# KubeDeck 2.7.5 — тематический Compare chooser и читаемый ResourceQuota

Статус: реализовано. Автоматические проверки пройдены 2026-07-23; ручной smoke остаётся открытым.

## Проблема

В окне `Compare manifests` выбор второго открытого ресурса реализован через нативный HTML `<select>`.

На macOS такой control открывает системное светлое меню поверх тёмного интерфейса KubeDeck:

- меню не использует активную тему приложения;
- системные скругления, фон, шрифт и выделение не совпадают с остальными controls;
- длинные значения занимают слишком много места и визуально перекрывают modal;
- внешний вид и поведение отличаются между macOS, Windows и Linux;
- список выглядит как элемент операционной системы, а не часть KubeDeck.

Дополнительно в Summary объекта `ResourceQuota` длинные имена quota resources (`limits.ephemeral-storage`, `persistentvolumeclaims`, `services.loadbalancers`, `services.nodeports` и другие) заходят под progress bar. Текст и полоса визуально накладываются друг на друга, из-за чего имя плохо читается и строка выглядит сломанной.

В проекте уже существует `ThemedSelect`, используемый в Pod Terminal. Создавать ещё один dropdown-компонент для Manifest Compare не требуется.

## Цель 2.7.5

Resource chooser в `Compare manifests` должен выглядеть и вести себя как часть KubeDeck во всех темах и на всех поддерживаемых платформах.

Пользователь должен:

1. сразу понимать, какой ресурс выбран;
2. различать одинаковые имена по cluster и namespace;
3. управлять списком мышью и клавиатурой;
4. видеть длинные имена без растягивания или перекрытия modal;
5. не сталкиваться с нативным системным popup.

## Границы патча

- Заменяется только chooser `Choose open resource…` внутри `ManifestCompare`.
- Существующая логика очистки manifest, построения diff и режимов Clean/Raw не меняется.
- Список кандидатов по-прежнему содержит только открытые resource tabs того же типа, переданные через `candidates`.
- API загрузки YAML и его backend-контракт не меняются.
- Используется существующий `ThemedSelect`; новая dependency и отдельный dropdown-компонент не добавляются.
- Если для корректной доступности потребуется улучшить общий `ThemedSelect`, изменения должны оставаться обратно совместимыми с Container и Shell selectors в Pod Terminal.
- Остальные нативные `<select>` в Audit, Logs, Problems, Related, Settings, SSH и pagination не входят в 2.7.5. Они фиксируются как отдельный последующий UI-аудит.
- В 2.7.5 также исправляется только раскладка quota usage в Summary `ResourceQuota`; расчёт used/hard, пороги warning/danger и backend normalizer не меняются.

## 1. Представление chooser

В закрытом состоянии control показывает:

- placeholder `Choose open resource…`, если target ещё не выбран;
- выбранный resource в компактном формате после выбора.

Рекомендуемый формат выбранного значения:

`cluster · namespace/resource-name`

Для cluster-scoped объекта:

`cluster · cluster/resource-name`

Правила:

- trigger занимает доступную ширину toolbar, но не растягивает modal;
- длинное значение сокращается через ellipsis в одну строку;
- полный cluster, resource kind, namespace и name доступны через tooltip;
- справа используется существующая иконка `ChevronDown`;
- открытое состояние обозначается border/background из theme tokens;
- системная стрелка `<select>` и нативный popup отсутствуют.

## 2. Выпадающий список

Popover открывается внутри слоя Manifest Compare и использует:

- `var(--panel)` / тематический surface для фона;
- `var(--border)` и `var(--primary-border)` для границ;
- существующие text, muted, hover и selected tokens;
- тень меню из текущей theme system;
- тот же радиус, что другие тематические menus.

Каждый option содержит:

- основную строку: resource name;
- вторичный context: cluster · namespace;
- selected indicator `Check` для текущего target.

Правила размеров:

- ширина меню не меньше trigger;
- максимальная ширина ограничена modal;
- максимальная высота — до доступной области modal/viewport;
- при переполнении появляется внутренний scroll;
- длинное имя не расширяет popup;
- popup не выходит за левую или правую границу modal;
- popup располагается ниже trigger, а при нехватке места может открываться вверх;
- `z-index` выше diff panes и editor layers, но ниже modal dialogs следующего уровня.

## 3. Состояния

### Нет кандидатов

- chooser disabled;
- placeholder: `No comparable open resources`;
- tooltip объясняет: `Open another resource of the same kind to compare`;
- пустой popup не открывается.

### Target не выбран

- правый diff pane показывает существующее состояние `Select target`;
- placeholder не считается выбранным Kubernetes-ресурсом;
- кнопка/режим Compare не инициирует API-запрос без target.

### Target выбран

- menu закрывается;
- trigger сразу показывает выбранный context;
- загружается YAML выбранного resource;
- выбранный option получает `aria-selected="true"` и Check.

### Загрузка

- повторный выбор блокируется только на время активной загрузки target YAML либо корректно отменяет/заменяет предыдущий запрос;
- trigger сохраняет стабильную ширину;
- рядом с выбранным значением допускается небольшой spinner;
- правый pane показывает `Loading manifest…`, а не старый diff другого target.

### Ошибка

- ошибка загрузки YAML остаётся внутри Manifest Compare;
- выбранный target не исчезает из trigger;
- старый YAML другого target не показывается как результат нового выбора;
- пользователь может открыть chooser и выбрать resource повторно;
- техническая ошибка не попадает внутрь option label.

## 4. Доступность и клавиатура

Chooser следует контракту combobox/listbox:

- trigger имеет `aria-label="Choose resource to compare"`;
- `aria-haspopup="listbox"`;
- `aria-expanded`;
- menu имеет `role="listbox"`;
- options имеют `role="option"` и `aria-selected`;
- текущий selected option получает фокус при открытии.

Клавиатура:

- `Enter`, `Space` и `ArrowDown` открывают список;
- `ArrowUp` / `ArrowDown` перемещают активный option;
- `Home` / `End` переходят к первому/последнему option;
- `Enter` выбирает option;
- `Escape` закрывает menu без изменения target;
- `Tab` закрывает menu и продолжает нормальный focus order;
- после закрытия focus возвращается в trigger;
- клик вне chooser закрывает menu.

Фокус обозначается существующим `focus-visible` token. Цвет не является единственным признаком выбранного option: сохраняется Check и `aria-selected`.

## 5. Использование `ThemedSelect`

Предпочтительный путь:

1. `ManifestCompare` преобразует `candidates` в `ThemedSelectOption[]`.
2. Placeholder добавляется первым option с пустым `value`.
3. `onChange` вызывает существующий `choose(id)`.
4. Для длинных labels используются CSS ellipsis и tooltip.

Если текущего API `ThemedSelect` недостаточно, допускается минимально добавить:

- `placeholder`;
- secondary option text;
- menu placement относительно viewport;
- loading/disabled state;
- tooltip полного значения;
- полноценную arrow-key navigation.

Новые props должны быть необязательными. Существующие вызовы в `TerminalTab` не должны менять визуальное или функциональное поведение.

## 6. Асинхронная устойчивость

Текущий `choose(id)` загружает YAML асинхронно. При быстром выборе двух ресурсов ответ первого запроса не должен перезаписать второй.

Контракт:

- каждому выбору назначается generation/request id;
- применяется только результат последнего запроса;
- при новом выборе предыдущий результат очищается либо помечается устаревшим;
- закрытие modal не приводит к обновлению размонтированного состояния;
- ошибка устаревшего запроса не заменяет успешный новый diff.

Отмена через `AbortController` используется только если существующий API-клиент уже поддерживает signal. Иначе достаточно generation guard.

## 7. Визуальная интеграция с Manifest Compare

- chooser остаётся слева в `.manifest-compare-toolbar`;
- legend и переключатель Clean/Raw остаются справа;
- на средней ширине chooser получает больше пространства, controls не перекрываются;
- на узкой ширине toolbar переносится предсказуемо: chooser занимает отдельную строку, controls — следующую;
- menu не обрезается `overflow` контейнерами modal;
- diff grid не меняет размер при открытии menu;
- открытие popup не вызывает горизонтальный scroll modal.

## 8. ResourceQuota usage без наложения текста

Каждая quota row должна иметь три независимые области:

1. Resource name и `used / hard`.
2. Progress bar.
3. Percentage.

Контракт desktop-раскладки:

- используется явная grid-разметка, а не визуальное совмещение элементов через свободное место;
- колонка имени имеет достаточную базовую ширину и `min-width: 0`;
- progress bar начинается только после окончания зарезервированной колонки имени;
- percentage имеет фиксированную компактную колонку и не сжимает progress bar;
- длинное имя переносится по Kubernetes-разделителям (`.`, `-`) либо через безопасный `overflow-wrap` внутри своей колонки;
- перенос имени увеличивает высоту только текущей строки;
- `used / hard` остаётся непосредственно под соответствующим именем;
- текст никогда не рисуется поверх track или fill progress bar;
- progress track не проходит под текстом даже при значении `0%`;
- строки с короткими и длинными именами сохраняют одинаковое выравнивание progress и percentage.

Контракт узкой раскладки:

- при недостатке ширины resource name и `used / hard` занимают первую строку;
- progress bar и percentage переходят на вторую строку;
- percentage остаётся справа от progress bar;
- ни одна колонка не создаёт горизонтальный scroll drawer;
- layout проверяется на минимальной и максимальной ширине drawer.

Семантика и визуальные состояния:

- существующая сортировка quota resources по уровню заполнения сохраняется;
- warning от 80% и danger от 95% сохраняются;
- `0%` остаётся видимым числом, но не получает искусственный fill;
- tooltip progress bar при наличии должен содержать полное resource name и точные `used / hard`;
- имя не сокращается до неоднозначного значения без возможности увидеть его полностью.

## 9. Автоматические контракты

- [x] В `ManifestCompare` отсутствует нативный `<select>`.
- [x] Chooser использует существующий `ThemedSelect`.
- [x] Placeholder отображается при пустом target.
- [x] Disabled state корректен при пустом `candidates`.
- [x] Option label однозначно содержит cluster, namespace и resource name.
- [x] Выбор option вызывает загрузку YAML нужного target.
- [x] Выбранный option отмечен Check и `aria-selected`.
- [x] Menu закрывается после выбора.
- [x] Menu закрывается по Escape и клику снаружи.
- [x] ArrowUp/ArrowDown, Home/End и Enter работают предсказуемо.
- [x] Focus возвращается в trigger после закрытия.
- [x] Длинные labels сокращаются, полный context доступен в tooltip.
- [x] Menu не выходит за границы Manifest Compare/viewport.
- [x] Пустой список не открывает пустой popup.
- [x] Ошибка загрузки не показывает YAML предыдущего target.
- [x] Устаревший async response не перезаписывает последний выбор.
- [x] Clean/Raw продолжает перестраивать diff без повторной загрузки target.
- [x] Container и Shell selectors в Pod Terminal сохраняют поведение.
- [x] ResourceQuota row использует независимые области name, progress и percentage.
- [x] Длинные quota resource names не перекрывают progress track.
- [x] `used / hard` остаётся связано с правильным resource name.
- [x] Короткие и длинные quota names сохраняют единое выравнивание progress bars.
- [x] Узкий drawer переводит progress на следующую строку без горизонтального scroll.
- [x] Пороги 80%/95%, сортировка и точные used/hard значения не изменены.
- [x] Обновить renderer contract для Manifest Compare.
- [x] Запустить `npm run test:renderer`.
- [x] Запустить `npm run typecheck`.
- [x] Запустить `npm run lint`.
- [x] Запустить `npm run format:check`.
- [x] Запустить `npm run build`.
- [x] Запустить `npm --workspace apps/desktop run test:gateway`.
- [x] Запустить `npm run verify:release`.
- [x] Запустить `git diff --check`.

## 10. Ручной smoke

- [ ] Открыть два Pod одного cluster/namespace и выбрать target.
- [ ] Открыть ресурсы с одинаковым name в разных namespace.
- [ ] Открыть ресурсы с одинаковым name в разных clusters.
- [ ] Проверить очень длинные cluster, namespace и resource names.
- [ ] Проверить отсутствие кандидатов того же resource kind.
- [ ] Проверить загрузку, успешный diff и ошибку API.
- [ ] Быстро выбрать два разных target; итог соответствует последнему.
- [ ] Переключить Clean/Raw после выбора.
- [ ] Закрыть chooser по Escape и клику снаружи.
- [ ] Полностью пройти chooser только клавиатурой.
- [ ] Проверить открытие menu рядом с нижней границей окна.
- [ ] Проверить light, midnight, nord, forest, plum и mocha themes.
- [ ] Повторить smoke на macOS и Windows production build.
- [ ] Проверить Container/Shell selectors в Pod Terminal после изменений общего `ThemedSelect`.
- [ ] Открыть ResourceQuota с короткими именами `pods`, `secrets`, `services`.
- [ ] Проверить `limits.ephemeral-storage`, `requests.ephemeral-storage`, `persistentvolumeclaims`, `services.loadbalancers` и `services.nodeports`.
- [ ] Проверить quota rows со значениями 0%, ниже 80%, от 80%, от 95% и 100%.
- [ ] Изменить drawer от минимальной до максимальной ширины: имена, progress и percentage не пересекаются.
- [ ] Проверить ResourceQuota Summary во всех поддерживаемых темах.

## 11. Релиз 2.7.5

- [x] После реализации поднять root, desktop, shared-types и lockfile до `2.7.5`.
- [x] Добавить `RELEASE_NOTES_2.7.5.md`.
- [x] Добавить `REGRESSION_CHECKLIST_2.7.5.md`.
- [x] Обновить README и `NODE_MIGRATION_PROGRESS.md`.
- [x] Сохранить Node-only baseline Node 51 / Python 0.
- [x] Не включать в 2.7.5 массовую замену остальных native selects.

## Критерий готовности

При открытии `Compare manifests` выбор target выглядит как тематический control KubeDeck, не вызывает системное меню macOS/Windows, остаётся внутри modal, однозначно показывает context ресурса и полностью управляется мышью и клавиатурой. В Summary `ResourceQuota` длинные resource names остаются читаемыми и никогда не заходят под progress bars. Существующий diff, Clean/Raw, quota thresholds и selectors Pod Terminal продолжают работать.
