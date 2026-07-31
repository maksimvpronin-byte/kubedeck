# KubeDeck 2.9.3 — тема Steel Graphite

Статус: реализация и автоматические контракты завершены; ручной UI smoke и
release sync ожидают выполнения.

## Последовательность релизов

Патч 2.9.2 отдельно не выпускается: реализованные визуальные и packaging fixes
включены в 2.9.3 вместе со Steel Graphite. Version metadata и release documents
синхронизируются сразу на 2.9.3.

## Цель

Добавить ещё одну тёмную цветовую схему `graphite` с пользовательским названием
**Steel Graphite** / **Стальной графит**. В качестве визуального ориентира
использовать приложенные скриншоты: нейтральные угольно-серые поверхности,
сдержанный голубой accent, спокойные границы и хорошо различимые зелёные,
янтарные и красные статусы.

Новая тема должна использовать существующую систему семантических CSS-токенов,
сохраняться в Settings и применяться без перезапуска. Новые компоненты,
зависимости и отдельная дизайн-система не требуются.

## Визуальный характер

- основа ближе к нейтральному graphite, чем к синему Midnight Blue;
- sidebar немного светлее рабочей области, topbar немного темнее panel;
- таблицы плотные и спокойные: header и selected row различимы без яркой заливки;
- ссылки, active tabs, focus и основные действия используют холодный голубой;
- success остаётся зелёным, pending/warning — янтарным, danger/error — красным;
- текст не белоснежный: основной — светло-серый, вторичный — приглушённый;
- большие поверхности не должны быть почти чёрными или иметь лишние gradients;
- скриншоты задают только палитру и контраст, но не требуют копировать чужую
  навигацию, компоновку, иконки или размеры элементов.

## Идентификаторы

| Назначение | Значение |
|---|---|
| Persisted theme ID | `graphite` |
| English label | `Steel Graphite` |
| Russian label | `Стальной графит` |
| English description | `Neutral graphite with cool blue accents` |
| Russian description | `Нейтральный графит с холодными голубыми акцентами` |
| `data-theme` | `graphite` |

Существующие `System`, `Light`, `Midnight Blue`, `Nord Frost`, `Forest Teal`,
`Plum Graphite` и `Warm Mocha` не менять. Системная тёмная тема и legacy-значение
`dark` по-прежнему должны разрешаться в `midnight`.

## Стартовая палитра

Значения ниже являются реализационным baseline. Их можно слегка скорректировать
после screenshot-check, не меняя семантический контракт.

| Группа | Tokens и значения |
|---|---|
| Основные поверхности | `--app-bg: #20252b`, `--sidebar-bg: #30363d`, `--topbar-bg: #252b31`, `--panel: #272d33`, `--panel-muted: #23292f` |
| Вложенные поверхности | `--surface: #242a30`, `--surface-2: #1d2227`, `--table-head: #2d343b`, `--code-bg: #191e22` |
| Интерактивные состояния | `--surface-hover: #343c44`, `--surface-active: #3d4852`, `--surface-selected: #314b5b` |
| Текст | `--text: #dde3e8`, `--text-strong: #f4f7f9`, `--muted: #aeb8c1`, `--muted-strong: #cbd2d8`, `--muted-soft: #8e9aa5` |
| Границы и forms | `--border: #3e4851`, `--border-strong: #53616d`, `--input-bg: #20262b`, `--input-border: #48545f` |
| Primary | `--primary: #246f92`, `--primary-hover: #287da4`, `--primary-border: #49a5cc`, `--focus-ring: #55b7df` |
| Метрики | `--metric-cpu: #59b9ca`, `--metric-memory: #a996d7`, `--metric-storage: #d3a158` |
| Success | `--success-bg: #1d3025`, `--success-border: #4c8060`, `--success-text: #a9e8bb` |
| Warning/Pending | `--warning-bg: #342b1d`, `--warning-border: #9a742f`, `--warning-text: #f4cf78`; pending использует те же tokens |
| Danger/Error | `--danger-bg: #352226`, `--danger-border: #9b5057`, `--danger-text: #ffb9bd`, `--error-bg: #352226`, `--error-text: #ffb9bd` |
| Terminal | `--terminal-bg: #181d21`, `--terminal-text: #d8dee4`, `--terminal-cursor: #55b7df`, `--terminal-selection: rgb(74 163 203 / 0.3)` |

Проверенные стартовые contrast ratios: `text/app-bg` — 11.92:1,
`text/panel` — 10.75:1, `muted/panel` — 6.91:1. Все три сочетания имеют
запас выше WCAG AA для обычного текста.

## План реализации

При реализации primary и primary-hover были сделаны темнее исходного baseline,
чтобы белый inverse-текст сохранял WCAG AA и в обычном, и в hover-состоянии.

### 1. Общий тип и allowlists

- [x] Добавить `graphite` в `DarkTheme` в
  `packages/shared-types/src/index.ts`.
- [x] Добавить `graphite` в backend allowlist `THEMES` в
  `apps/desktop/src/main/backend/config/configStore.ts`.
- [x] Добавить `graphite` в ранний allowlist
  `apps/desktop/src/renderer/public/theme-bootstrap.js`, чтобы при запуске не
  возникала вспышка Midnight Blue.
- [x] Не менять fallback неизвестных значений и migration legacy `dark`.

### 2. Renderer и Settings

- [x] Добавить `graphite` в `THEME_OPTIONS` в
  `apps/desktop/src/renderer/utils/theme.ts`.
- [x] Preview карточки использовать три цвета: `#20252b`, `#30363d`,
  `#49a5cc`.
- [x] Добавить английские и русские строки названия и описания в `en.json` и
  `ru.json`.
- [x] Сохранить существующий radio-card selector, live preview, persistence и
  keyboard focus без отдельной логики для новой темы.

### 3. CSS tokens

- [x] Добавить один блок `:root[data-theme="graphite"]` в `tokens.css`.
- [x] Переопределить только значения существующих семантических tokens;
  component-specific overrides и `!important` не добавлять.
- [x] Заполнить button, disabled, primary-soft, primary-resize, overlay,
  shadows и scrollbar tokens в той же структуре, что и остальные темы.
- [ ] Проверить вручную, что selected row, active tab и focus ring различимы между
  собой и не выглядят как warning/error.

### 4. Terminal Workspace

- [x] Задать полный ANSI-набор terminal colors для красного, зелёного,
  жёлтого, синего, пурпурного, cyan, black и white.
- [x] Проверить по реализации Pod Terminal и Node SSH Terminal: оба получают палитру из
  CSS через `terminalThemeFromCss()` и событие `kubedeck-theme-change`;
  отдельную terminal implementation не создавать.
- [ ] Убедиться вручную, что смена темы не переподключает PTY/SSH-сессию и не очищает
  scrollback.

### 5. Контракты

- [x] Добавить `graphite` в ожидаемый список `THEME_OPTIONS` renderer-теста.
- [x] Добавить `graphite` в список theme selectors и contrast loop.
- [x] Зафиксировать backend normalization сохранённого `graphite`.
- [x] Проверить наличие темы в раннем bootstrap allowlist.
- [x] Проверить наличие English/Russian label и description.
- [x] Зафиксировать WCAG AA для primary и primary-hover с inverse-текстом.
- [x] Сохранить проверки legacy `dark`, unknown fallback, System, Light и всех
  обязательных shared tokens.

## Обязательный UI smoke

Проверить Steel Graphite рядом с Midnight Blue, чтобы темы визуально не
сливались:

1. Resource Table: header, обычная/hover/selected row, ссылки и статусы.
2. Sidebar, topbar, active section, tabs и namespace selector.
3. Settings: preview, active card, focus-visible и сохранение после перезапуска.
4. Overview/Capacity: CPU, RAM и Storage различимы на graphite surfaces.
5. Pod Drawer: Summary, YAML, Logs, Related, events и modals.
6. Pod Terminal и Node SSH: ANSI colors, selection, cursor и scrollback.
7. Problems, Audit, Port Forward, Help, About и command palette.
8. Success, Pending, Warning, Danger, disabled и loading states.
9. Light, System и Midnight Blue без регрессий.

Проверку выполнить минимум на Windows и macOS в обычном размере окна и при
узкой ширине. Для принятия темы приложить скриншоты Resource Table, Settings и
Terminal Workspace.

## Автоматический gate

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway` — 83/83 tests
- [x] `npm run verify:release`
- [x] `git diff --check`

## Release sync 2.9.3

После реализации и автоматического gate:

- [x] поднять root, desktop, shared-types и lock metadata до `2.9.3`;
- [x] обновить Help, README.md, README.ru.md, CHANGELOG.md и migration status;
- [x] создать `RELEASE_NOTES_2.9.3.md` и
  `REGRESSION_CHECKLIST_2.9.3.md`;
- [x] отразить Steel Graphite в пользовательской документации и списке тем;
- [ ] проверить одинаковую версию macOS и Windows artifacts;
- [ ] собрать macOS arm64 DMG/ZIP и Windows Portable x64.

## Не входит в патч

- новая дизайн-система или UI-библиотека;
- изменение размеров, навигации и структуры экранов со скриншотов;
- замена существующих тем или нового default theme;
- изменение Kubernetes, Gateway, PTY, SSH и persistence contracts;
- автоматическое построение palette из пользовательских цветов.

## Критерий завершения

Steel Graphite доступна в Settings, применяется до первого renderer paint,
сохраняется после перезапуска и одинаково покрывает основное окно, модальные
поверхности, resource tables и оба терминала. Контраст проходит автоматическую
проверку, ручной smoke подтверждён скриншотами, документация и артефакты имеют
версию 2.9.3.
