# Theme Switching Fix Plan

План для исправления переключения тем в KubeDeck. Цель: сделать `system`, `dark` и `light` реально работающими режимами без регрессий в основных экранах приложения.

## Текущая диагностика

- Тип темы уже описан как `system | dark | light` в `apps/desktop/src/renderer/types.ts` и `apps/desktop/src/main/backend/config/types.ts`.
- Backend уже нормализует и валидирует тему в `apps/desktop/src/main/backend/config/configStore.ts`: `defaultSettings()` выставляет `theme: "system"`, `normalizeSettings()` отклоняет неизвестные значения.
- Settings UI уже показывает селект темы в `apps/desktop/src/renderer/components/SettingsPanel.tsx`, но изменение применяется только к локальному `draft` до нажатия Save.
- `App.tsx` применяет `document.documentElement.dataset.theme = settings.theme`, но сейчас это сырое значение. Для `system` в DOM попадает `data-theme="system"`, а не фактически вычисленная тема.
- В `apps/desktop/src/renderer/styles/app.css` почти вся базовая палитра захардкожена темными цветами. CSS-переменные используются точечно и без глобального набора токенов, поэтому `data-theme` почти ни на что не влияет.
- `:root` всегда задает `color-scheme: dark`, из-за чего нативные `input/select/button` остаются темными даже при выборе light/system-light.
- Терминалы `TerminalTab.tsx` и `NodeSshTab.tsx` передают собственный xterm theme в JS, поэтому их нужно переключать отдельно или осознанно оставить темными как code/terminal surface.

## Предполагаемые причины бага

- Нет функции, которая превращает `settings.theme === "system"` в фактический `dark` или `light`.
- Нет подписки на изменение `prefers-color-scheme`, поэтому system theme не обновится при смене темы ОС во время работы приложения.
- Нет глобальных CSS theme tokens: основные цвета shell/sidebar/table/drawer/forms не завязаны на `data-theme`.
- SettingsPanel не дает мгновенного preview темы, потому что пока пользователь не нажал Save, `config.settings.theme` не меняется.
- Часть новых hotfix CSS-блоков использует `!important` и прямые темные цвета, их нужно переводить на токены постепенно и проверять визуально.

## Целевое поведение

- `dark`: приложение всегда в темной теме.
- `light`: приложение всегда в светлой теме.
- `system`: приложение следует `prefers-color-scheme` и обновляется при смене системной темы без перезапуска.
- При выборе темы в настройках пользователь сразу видит preview, но постоянное сохранение по-прежнему происходит через Save.
- После перезапуска приложение поднимает сохраненную тему без заметного "мигания" темной темы там, где это разумно исправить в текущей архитектуре.
- Таблицы, drawer, настройки, модалки, topbar/sidebar, ошибки, warning/success states остаются читаемыми в обеих темах.
- Pod terminal и SSH terminal либо получают согласованную тему, либо остаются темными, но тогда это явно фиксируется как осознанное продуктовое решение.

## План реализации

### 1. Ввести единый theme resolver

- Status: DONE, первый проход.
- Добавить renderer utility, например `apps/desktop/src/renderer/utils/theme.ts`.
- Реализовать:
  - `resolveTheme(theme: Theme, media?: MediaQueryList): "dark" | "light"`;
  - `applyThemePreference(theme: Theme): void`;
  - опционально `getSystemThemeMedia(): MediaQueryList | null`.
- В DOM хранить два признака:
  - `data-theme-preference="system|dark|light"`;
  - `data-theme="dark|light"` как фактическую тему.
- Для `color-scheme` использовать CSS через `[data-theme="dark"]` и `[data-theme="light"]`.

### 2. Подключить resolver в App.tsx

- Status: DONE, первый проход.
- Заменить текущий эффект `document.documentElement.dataset.theme = settings.theme`.
- Добавить listener на `matchMedia("(prefers-color-scheme: dark)")` только когда выбрана `system`.
- На cleanup удалять listener.
- Проверить поведение при загрузке без `settings`: оставить дефолтный dark до прихода config или применить bootstrap script в `index.html`.

### 3. Сделать preview темы в настройках

- Status: DONE, первый проход.
- В `SettingsPanel.tsx` не менять контракт сохранения настроек.
- При изменении `draft.theme` временно применять preview через тот же resolver.
- При unmount или сбросе `draft` возвращать тему из сохраненных `settings.theme`, если пользователь не нажал Save.
- После успешного Save `config` обновится через `api.updateSettings`, и App станет источником истины.

### 4. Перевести базовый CSS на токены

- Status: DONE, первый проход.
- В начале `app.css` добавить глобальные токены:
  - background: `--app-bg`, `--panel`, `--panel-muted`, `--surface`, `--surface-2`, `--code-bg`;
  - text: `--text`, `--muted`, `--muted-strong`, `--text-inverse`;
  - borders: `--border`, `--border-strong`;
  - actions: `--primary`, `--primary-hover`, `--danger`, `--warning`, `--success`;
  - focus/selection/shadow tokens.
- Задать значения для `[data-theme="dark"]` и `[data-theme="light"]`.
- Не делать однотонную светлую палитру: светлая тема должна быть спокойной рабочей UI-палитрой с нейтральными поверхностями и достаточно контрастными акцентами.

### 5. Перевести основные поверхности

- Status: IN PROGRESS, первый проход покрывает shell/sidebar/topbar/tabs/forms/panels/table/drawer/code/settings и light-overrides для поздних hotfix-блоков.
Идти небольшими блоками и после каждого смотреть приложение:

- `:root`, `body`, `.app-shell`, `.sidebar`, `.workspace`, `.topbar`.
- Навигация: active/hover/group labels.
- Таблицы ресурсов: header, rows, selected states, pagination, filters.
- Drawer: header, tabs, action buttons, details panels.
- Settings/About/Help/Problems/Audit/Port-forward panels.
- Inputs/select/buttons/common feedback.
- YAML/log/code blocks.
- Modals and overlays.

### 6. Терминалы и code surfaces

- Status: IN PROGRESS. Контейнеры терминалов получают theme border/background; сами xterm-сессии пока остаются темными как специализированная terminal surface.
- Решить отдельно:
  - вариант A: терминалы всегда темные для стабильной читаемости;
  - вариант B: xterm theme зависит от resolved theme.
- Если выбран вариант B:
  - вынести xterm theme builder в utility;
  - применить в `TerminalTab.tsx` и `NodeSshTab.tsx`;
  - при смене темы обновлять `terminal.options.theme`.
- В любом варианте CSS контейнеров терминала должен использовать токены для border/background вокруг терминала.

### 7. Снизить риск от `!important` и старых hotfix-блоков

- Найти прямые темные цвета и `!important` в `app.css`.
- В первую итерацию переводить только видимые основные поверхности.
- Остальные прямые цвета оставить в отдельном TODO-списке в этом файле, чтобы не раздувать diff.
- Не трогать layout/resizable-логику, если она не мешает теме.

### 8. Тесты и проверки

- Обязательные:
  - `npm run typecheck`;
  - `npm run build`;
  - `npm --workspace apps/desktop run test:gateway`, если затронуты shared contracts или настройки backend.
- Ручные проверки:
  - открыть Settings, переключить `dark -> light -> system`;
  - проверить, что preview виден до Save;
  - нажать Save, перезапустить приложение, убедиться что тема сохранилась;
  - для `system` переключить тему ОС и проверить live update;
  - проверить основные разделы: Workloads/Pods, drawer pod details, YAML, Logs, Terminal, Settings, Problems, About;
  - проверить светлую тему на читаемость таблиц, disabled buttons, error/warning/success states;
  - проверить macOS package smoke после `npm run package:mac`, если изменения идут в релизную ветку.

## Рекомендуемая последовательность коммитов

1. `fix: resolve app theme preference`
   - resolver, App integration, Settings preview.
2. `style: add theme tokens for app shell`
   - глобальные tokens и базовая оболочка.
3. `style: theme resource views and drawers`
   - таблицы, drawer, forms, modals.
4. `style: theme code and terminal surfaces`
   - YAML/logs/terminal containers и, если выбрано, xterm JS themes.

## Открытые решения перед реализацией

- Делать ли терминалы светлыми в light theme или оставить темными как специализированную поверхность?
- Нужен ли bootstrap script в `index.html`, чтобы убрать краткий flash темной темы до загрузки config?
- Делать ли Settings theme change мгновенным preview до Save или применять только после Save? Рекомендуемый вариант: preview до Save, сохранение только Save.
- Достаточно ли CSS-only подхода, или часть theme state нужно отдавать компонентам через React hook?

## Критерии готовности

- Выбор `dark/light/system` реально меняет видимые цвета приложения.
- `system` соответствует теме ОС и реагирует на смену ОС без перезапуска.
- Настройка сохраняется в config и переживает перезапуск.
- Нет нечитаемых мест в основных рабочих сценариях.
- Проверки `typecheck` и `build` проходят.

## Журнал выполнения

- 2026-07-09: добавлен `utils/theme.ts`, `App.tsx` теперь резолвит `system` в фактическую тему и слушает `prefers-color-scheme`, `SettingsPanel.tsx` показывает preview темы до Save, в `app.css` добавлены dark/light токены и первый проход по основным поверхностям; проверки: `npm run typecheck`, `npm run build`, `npm --workspace apps/desktop run test:gateway`.
