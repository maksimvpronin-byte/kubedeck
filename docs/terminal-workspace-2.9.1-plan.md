# KubeDeck 2.9.1 — план единого Terminal Workspace

Статус: реализовано; автоматические проверки пройдены, ручной smoke ожидается.

## Цель

Сделать Node SSH аналогичным Pod Terminal:

- открывать SSH в постоянной нижней terminal-панели;
- сохранять живую SSH-сессию при навигации по ресурсам;
- держать Pod Terminal и Node SSH в общих вкладках;
- позволить вручную расширять и сужать нижнюю панель.
- синхронизировать Help и актуальную документацию с версией `2.9.1`.

Патч сохраняет разные transport и протоколы Pod exec/SSH, но даёт им один
renderer workspace и одинаковый lifecycle интерфейса.

## Подтверждённые причины

### Статичная высота Pod Terminal

- `.content.with-bottom-terminal` задаёт второй grid-row как
  `minmax(280px, 42vh)`.
- В `BottomTerminalPanel` нет resize-handle и состояния высоты.
- В 2.6.0 изменение и сохранение размера входило в контракт закреплённого
  терминала.
- При переходе к workspace tabs в 2.7.0 старый `PinnedTerminalPanel` заменили
  на `BottomTerminalPanel`, а resize-state и handle удалили.

### Node SSH привязан к drawer

- `NodeSshTab` отрисовывается непосредственно внутри `PodDrawer`.
- Переход на другой resource, закрытие drawer или смена drawer-tab размонтирует
  `NodeSshTab`.
- Cleanup компонента закрывает WebSocket и уничтожает xterm.
- Поэтому SSH-сессия не переживает ту же навигацию, которую уже переживает Pod
  Terminal.
- Backend Node SSH session уже привязан к cluster/node и не зависит от
  выбранного renderer resource после подключения.

Исправление находится в renderer ownership. Backend SSH и Pod Terminal
protocol менять не требуется.

## Пользовательский сценарий

### Pod

1. Пользователь открывает Pod.
2. Нажимает существующее действие `Terminal`.
3. Выбирает container, если их несколько.
4. В нижнем workspace открывается или активируется Pod Terminal-вкладка.

### Node

1. Пользователь открывает Node.
2. Нажимает действие `SSH` с той же terminal-иконкой.
3. В нижнем workspace открывается или активируется Node SSH-вкладка.
4. Пользователь вводит недостающие SSH credentials и нажимает `Connect`.
5. Навигация по Nodes, Pods и другим ресурсам не закрывает SSH.

Отдельная SSH-вкладка внутри resource drawer после этого не нужна.

## Общий Terminal Workspace

Нижняя панель содержит смешанный список до пяти сессий:

- Pod Terminal;
- Node SSH.

Для каждой вкладки показывать:

- тип: `Terminal` или `SSH`;
- cluster;
- Pod/container либо Node name;
- active state;
- отдельную кнопку закрытия.

Повторное открытие существующего target активирует его вкладку и разворачивает
панель. Дубликат сессии не создаётся.

Identity:

```text
pod:<clusterId>:<namespace>:<pod uid/name>:<container>
ssh:<clusterId>:<node uid/name>
```

Префикс transport обязателен: Node и Pod с одинаковым именем не должны
конфликтовать.

Общий лимит остаётся равным пяти. При превышении показывать одно сообщение:
`Close a terminal or SSH session before opening another (5 maximum).`

## UX изменения высоты

- В развёрнутом состоянии над панелью видна тонкая горизонтальная зона захвата.
- Drag вверх увеличивает высоту workspace, drag вниз уменьшает.
- Минимальная высота — `180px`.
- Максимальная высота динамическая: над workspace остаётся не менее `160px`
  основной рабочей области.
- Начальная высота без сохранённого значения соответствует текущему поведению:
  примерно `42vh`, затем ограничивается допустимым диапазоном.
- Последняя выбранная высота сохраняется локально для общего workspace.
- Collapse сохраняет выбранную высоту; expand возвращает её.
- При уменьшении окна значение автоматически ограничивается новым максимумом.
- Закрытие и переключение Pod/SSH-вкладок не сбрасывает высоту.
- Панель продолжает занимать всю ширину workspace.

## Доступность resize

Resize-handle:

- имеет `role="separator"`;
- получает `tabIndex={0}`;
- объявляет `aria-orientation="horizontal"`;
- имеет `aria-label="Resize terminals"`;
- публикует `aria-valuemin`, динамический `aria-valuemax` и `aria-valuenow`;
- поддерживает `ArrowUp` и `ArrowDown`;
- с `Shift` использует увеличенный шаг;
- имеет видимый `:focus-visible`.

`ArrowUp` расширяет workspace, `ArrowDown` сужает. Базовый шаг — `16px`, с
`Shift` — `48px`.

## Минимальная архитектура

### Discriminated union target

Заменить Pod-only target на union с общими `id`, `clusterId` и `clusterName`:

```ts
type BottomTerminalTarget =
  | {
      kind: "pod";
      id: string;
      clusterId: string;
      clusterName: string;
      pod: ResourceRow;
      containers: string[];
      container: string;
    }
  | {
      kind: "node-ssh";
      id: string;
      clusterId: string;
      clusterName: string;
      node: ResourceRow;
    };
```

Новый общий store не нужен: существующие `bottomTerminals` и
`activeBottomTerminalId` уже предоставляют подходящий lifecycle.

### `App`

- существующий `openBottomTerminal` добавляет `kind: "pod"` и transport prefix
  в id;
- добавить симметричный `openBottomNodeSsh(node)`;
- искать существующую SSH-вкладку до проверки общего лимита;
- передать callback в `PodDrawer`;
- передать `settings` в `BottomTerminalPanel` для SSH defaults;
- cluster removal продолжает закрывать все сессии через общий `clusterId`;
- Overview terminal count продолжает считать обе разновидности живых terminal
  sessions.

### `PodDrawer`

- удалить прямой import и render `NodeSshTab`;
- удалить drawer-owned `terminal`/`SSH` tab;
- добавить действие `SSH` в header actions Node;
- действие вызывает `onOpenNodeSsh(node)`;
- Pod action `Terminal` продолжает использовать container picker.

Так Pod и Node имеют одинаковую точку запуска, а drawer больше не владеет
долгоживущими shell-сессиями.

### `BottomTerminalPanel`

Для каждой цели держать отдельный смонтированный session surface:

- `kind: "pod"` рендерит существующий `TerminalTab`;
- `kind: "node-ssh"` рендерит существующий `NodeSshTab`;
- неактивные surfaces скрываются через `visibility`, а не `display: none`;
- collapse не размонтирует ни Pod, ни SSH session;
- close размонтирует только выбранную session и запускает её существующий
  cleanup.

Панель получает общий `settings`, но не получает SSH credentials.

### `NodeSshTab`

Добавить необязательный `active = true`, аналогичный `TerminalTab`:

- хранить актуальный active-state в ref;
- не выполнять fit и не отправлять PTY resize для скрытой вкладки;
- при активации выполнить отложенный fit/resize;
- перед отправкой проверять положительные `cols`/`rows`;
- не отправлять одинаковый размер повторно;
- сохранить cleanup WebSocket/xterm при явном закрытии session.

SSH connection form остаётся внутри `NodeSshTab`:

- defaults загружаются из существующих Settings;
- password и passphrase остаются только в component state;
- secrets не передаются в `App`, target union, localStorage или tab metadata;
- во время `connecting/connected` большая форма скрывается, оставляя компактный
  target summary, toolbar и xterm;
- после disconnect форма снова доступна для изменения параметров;
- при малой высоте disconnected form прокручивается внутри SSH surface, не
  растягивая весь workspace.

Новый form component или modal не добавлять.

### Resize ownership

`BottomTerminalPanel` остаётся владельцем высоты:

- инициализировать `height` из `loadUiState()`;
- вычислять диапазон чистой функцией
  `clampBottomTerminalHeight(height, availableHeight)`;
- использовать Pointer Events и pointer capture;
- считать drag как `startHeight + startY - currentY`;
- завершать resize на `pointerup` и `pointercancel`;
- сохранять итоговую высоту после завершения drag;
- использовать ту же clamp-функцию для клавиатуры;
- скрывать handle в collapsed-состоянии;
- применять inline `height` только в развёрнутом состоянии.

### Layout CSS

- заменить статический terminal row на
  `grid-template-rows: minmax(0, 1fr) auto`;
- добавить `position: relative` нижней панели;
- добавить полноширинный `.bottom-terminal-resize-handle` с удобной hit-area,
  `cursor: ns-resize`, hover/active/focus состояниями;
- сбросить у нижних Pod/SSH xterm глобальный `min-height: 260px`;
- дать `.bottom-terminal-session > .node-ssh-tab` полную доступную высоту и
  `min-height: 0`;
- connected SSH layout отдаёт свободное место xterm;
- disconnected SSH controls при необходимости прокручиваются внутри session;
- collapsed layout содержит только header.

Новая CSS/resize dependency не нужна.

### UI state

В `UiState` добавить:

```ts
bottomTerminalHeight?: number;
```

Сохранять значение через существующие `loadUiState`/`saveUiState`, объединяя
его с текущим объектом. SSH credentials и connection payload не сохранять.

Размер старой плавающей панели 2.6.0 не мигрировать: её геометрия отличалась от
нынешнего bottom dock.

### Transport boundaries

Не объединять `TerminalTab` и `NodeSshTab` в один transport component.

- Pod Terminal продолжает использовать `podTerminalUrl`.
- Node SSH продолжает использовать `nodeSshUrl`.
- Backend WebSocket handlers, authentication, audit/redaction и shutdown
  остаются раздельными.
- Общими становятся только presentation, tab lifecycle и размер панели.

Это минимальнее и безопаснее преждевременного общего terminal abstraction.

## Help и документация

Обновление документации является обязательной частью patch, а не отдельной
задачей после реализации.

### Версия в Help

Сейчас `HelpPanel` содержит жёстко заданную версию `2.1.0`. Не заменять её
другой строкой `2.9.1`, иначе следующий релиз снова создаст рассинхрон.

Использовать уже существующий runtime source of truth:

```ts
window.kubedeck.getDesktopInfo().appVersion
```

Это тот же источник, который использует `AboutPanel`:

- packaged build показывает версию Electron application metadata;
- development mode показывает актуальную runtime-версию;
- до загрузки отображается нейтральное `—`;
- ошибка получения metadata не подменяется старой hardcoded-версией.

Новый version context, Vite define или отдельный package reader не добавлять.

### Help content

Обновить русские и английские help-строки:

- Node SSH открывается в общем нижнем Terminal Workspace;
- Pod Terminal и Node SSH сохраняются при навигации;
- между Pod/SSH sessions можно переключаться вкладками;
- нижнюю панель можно свернуть и изменить по высоте;
- закрытие вкладки завершает соответствующую session;
- SSH password/passphrase не сохраняются.

Устаревшее описание, где Help знает только Pod exec и port-forward, удалить.

### Актуальные документы 2.9.1

Обновить:

- `README.md`;
- `README.ru.md`;
- `CHANGELOG.md`;
- `NODE_MIGRATION_PROGRESS.md`;
- `docs/architecture.md`;
- `docs/security.md`;
- `docs/release-checklist.md`.

Создать:

- `docs/releases/RELEASE_NOTES_2.9.1.md`;
- `docs/releases/REGRESSION_CHECKLIST_2.9.1.md`.

В README на обоих языках синхронизировать:

- заголовок версии;
- artifact names;
- ссылки на release notes/checklist через `docs/releases/`;
- описание общего Terminal Workspace;
- persistent Node SSH;
- изменение высоты панели.

Отдельно исправить уже найденный baseline:

- `README.ru.md` всё ещё показывает `2.6.0` и содержит устаревшие release links;
- `HelpPanel` показывает `2.1.0`;
- `NODE_MIGRATION_PROGRESS.md` в одном месте указывает `51` Node route, хотя
  проверяемый contract равен `52`.

Исторические release notes не переписывать: номера старых версий внутри них
являются частью истории.

### Version metadata

Для релиза `2.9.1` синхронизировать:

- root `package.json`;
- `apps/desktop/package.json`;
- `packages/shared-types/package.json`;
- root/workspace entries в `package-lock.json`;
- dependency `@kubedeck/shared-types`;
- artifact и release document names.

Использовать существующий versioning workflow. Не обновлять зависимости и не
перегенерировать lockfile сверх изменения версии.

### Release contract

Расширить автоматическую проверку, чтобы рассинхрон не повторился:

- добавить `README.ru.md` и `CHANGELOG.md` в обязательные versioned documents;
- проверить наличие версии в обоих README, migration progress, changelog,
  release notes и regression checklist;
- проверить корректные ссылки обоих README на файлы в `docs/releases/`;
- проверить, что `HelpPanel` получает `appVersion` из `getDesktopInfo()`;
- запретить semantic-version literal внутри version-row `HelpPanel`;
- сохранить существующую проверку package/shared/lock version parity;
- сохранить Node `52` / Python `0`.

Одинаковые проверки должны входить в `release.contract.test.cjs` и
`verify-release.cjs`, либо вызываться из одного существующего release gate.
Новый documentation script не создавать без необходимости.

## Изменяемые файлы

| Файл | Изменение |
|---|---|
| `apps/desktop/src/renderer/App.tsx` | Node SSH targets, open/activate flow, settings |
| `apps/desktop/src/renderer/components/PodDrawer.tsx` | запуск SSH наружу вместо render внутри drawer |
| `apps/desktop/src/renderer/components/PodDrawerChrome.tsx` | Node SSH action, удаление SSH drawer-tab |
| `apps/desktop/src/renderer/components/BottomTerminalPanel.tsx` | union sessions, resize ownership, Pod/SSH render |
| `apps/desktop/src/renderer/components/NodeSshTab.tsx` | active lifecycle, hidden resize guard, compact connected layout |
| `apps/desktop/src/renderer/styles/terminal.css` | resizable workspace и Pod/SSH session layout |
| `apps/desktop/src/renderer/styles/modals.css` | адаптация существующих SSH controls к bottom surface |
| `apps/desktop/src/renderer/uiState.ts` | `bottomTerminalHeight` |
| `apps/desktop/src/renderer/components/HelpPanel.tsx` | runtime app version вместо `2.1.0` |
| `apps/desktop/src/renderer/locales/en.json` | актуальный Terminal Workspace help |
| `apps/desktop/src/renderer/locales/ru.json` | актуальный Terminal Workspace help |
| `apps/desktop/tests/renderer-controllers.contract.test.cjs` | renderer ownership, union, resize и security contracts |
| `apps/desktop/tests/release.contract.test.cjs` | Help/docs/version regression contract |
| `scripts/verify-release.cjs` | обязательная синхронизация Help и документов |
| `release-contract.json` | полный список versioned documents |
| package metadata и `package-lock.json` | версия `2.9.1` без dependency upgrade |
| README, changelog и актуальные docs | пользовательское поведение и release metadata |
| `docs/releases/RELEASE_NOTES_2.9.1.md` | release notes |
| `docs/releases/REGRESSION_CHECKLIST_2.9.1.md` | release-specific gates и smoke |

Backend Node SSH contract tests должны пройти без изменения production
backend-кода.

## Автоматические контракты

### Ownership и навигация

- [ ] `PodDrawer` больше не импортирует и не рендерит `NodeSshTab`.
- [ ] Node предоставляет header action `SSH`, а не SSH drawer-tab.
- [ ] `BottomTerminalPanel` рендерит Pod и Node SSH discriminated targets.
- [ ] Открытие того же Node активирует существующую SSH-вкладку.
- [ ] Pod и Node identities не конфликтуют.
- [ ] Общий лимит учитывает оба типа сессий.
- [ ] Смена resource/drawer-tab/cluster не размонтирует SSH session.
- [ ] Закрытие SSH-вкладки размонтирует только её `NodeSshTab`.
- [ ] Удаление cluster удаляет принадлежащие ему Pod и SSH sessions.

### Hidden session и PTY resize

- [ ] Скрытый `NodeSshTab` не вызывает fit и не отправляет resize.
- [ ] Активация SSH-вкладки выполняет fit после появления размеров.
- [ ] Нулевые/невалидные `cols` и `rows` не отправляются.
- [ ] Одинаковый размер не отправляется повторно.
- [ ] Скрытые Pod Terminal contracts продолжают проходить.

### Высота workspace

- [ ] В панели есть focusable horizontal separator.
- [ ] Drag вверх увеличивает, drag вниз уменьшает высоту.
- [ ] Высота не становится меньше `180px`.
- [ ] Над workspace остаётся минимум `160px`.
- [ ] Pointer cancel корректно завершает resize.
- [ ] Keyboard resize использует те же границы.
- [ ] Collapse скрывает handle и сохраняет высоту.
- [ ] CSS больше не фиксирует terminal row как `42vh`.
- [ ] Bottom Pod/SSH xterm не удерживает глобальный `min-height: 260px`.
- [ ] `UiState` содержит только геометрию, не SSH secrets.

### SSH security

- [ ] Target union не содержит password, passphrase или private key content.
- [ ] Tab label и command preview не показывают password/passphrase.
- [ ] Credentials не попадают в localStorage.
- [ ] Close вызывает существующие WebSocket close и xterm dispose.
- [ ] Существующие backend redaction/auth/origin contracts проходят без
  изменений.

### Documentation и version sync

- [ ] Help не содержит hardcoded `2.1.0` или другую semantic-version строку.
- [ ] Help показывает `desktopInfo.appVersion` из Electron metadata.
- [ ] Help на русском и английском описывает общий Pod/SSH workspace.
- [ ] `README.md` и `README.ru.md` имеют заголовок `2.9.1`.
- [ ] Artifact names в README используют `2.9.1`.
- [ ] Ссылки обоих README ведут в `docs/releases/` на существующие файлы.
- [ ] `CHANGELOG.md` содержит запись `2.9.1`.
- [ ] `NODE_MIGRATION_PROGRESS.md` показывает `2.9.1` и Node `52` / Python `0`.
- [ ] Architecture описывает общий renderer workspace и раздельные transports.
- [ ] Security фиксирует memory-only lifecycle SSH credentials.
- [ ] Release notes и regression checklist `2.9.1` существуют.
- [ ] Root, desktop, shared-types и lock metadata равны `2.9.1`.
- [ ] `verify:release` падает при устаревшем Help или любом обязательном
  versioned document.

## Ручной smoke

### Pod Terminal

- [ ] Открыть несколько Pod/container terminal-вкладок.
- [ ] Переключать вкладки и ресурсы; ввод и вывод продолжаются.
- [ ] Свернуть и развернуть workspace; сессии сохранены.

### Node SSH

- [ ] Открыть Node и нажать `SSH` в header actions.
- [ ] Подключиться через SSH agent/default keys.
- [ ] Проверить password auth.
- [ ] Проверить private key path/passphrase.
- [ ] Проверить jump-host path.
- [ ] Открыть другой resource и другой drawer-tab; SSH продолжает работать.
- [ ] Открыть SSH второго Node и переключаться между обеими сессиями.
- [ ] Переключаться между Pod Terminal и Node SSH.
- [ ] Свернуть workspace во время SSH-команды и вернуть его.
- [ ] Закрыть SSH tab; backend session завершается.
- [ ] Повторно открыть тот же Node после закрытия; создаётся новая session.
- [ ] Удалить cluster с открытым SSH; session закрывается.

### Resize

- [ ] Расширить workspace вверх и сузить вниз.
- [ ] Проверить drag без выделения текста и рывков.
- [ ] Проверить keyboard resize и focus-visible.
- [ ] Выполнить `stty size` в Pod Terminal и Node SSH до/после resize.
- [ ] Проверить min/max при минимальном размере окна.
- [ ] Перезапустить приложение; высота восстановлена.
- [ ] Проверить Light и одну тёмную тему.

### Help и документация

- [ ] Открыть Help в development build; версия совпадает с package metadata.
- [ ] Открыть Help в packaged build; версия совпадает с именем artifact.
- [ ] Проверить русскую и английскую локализацию Terminal Workspace.
- [ ] Проверить ссылки Documentation в обоих README.
- [ ] Убедиться, что Help/About не показывают разные версии.

## Regression gate

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `git diff --check`

## Не входит в 2.9.1

- объединение Pod exec и SSH backend protocol;
- общий transport/service abstraction;
- изменение ширины bottom workspace;
- индивидуальная высота для каждой вкладки;
- больше пяти одновременных sessions;
- сохранение SSH credentials;
- восстановление shell-сессий после перезапуска приложения;
- drag-and-drop terminal-вкладок;
- новый state manager;
- новая dependency;
- автоматическая правка исторических release notes.

## Критерии приёмки

- [ ] Node SSH открывается в той же нижней панели, что и Pod Terminal.
- [ ] Pod и SSH sessions одновременно доступны через общие вкладки.
- [ ] SSH переживает renderer-навигацию, collapse и переключение cluster.
- [ ] Пользователь может расширять и сужать workspace мышью и клавиатурой.
- [ ] xterm корректно синхронизирует PTY-размер только для активной session.
- [ ] SSH credentials остаются только в памяти соответствующего `NodeSshTab`.
- [ ] Закрытие session и удаление cluster освобождают ресурсы.
- [ ] Backend protocols, security contracts и dependencies не изменены.
- [ ] Help показывает runtime-версию без hardcoded release number.
- [ ] Русская/английская документация и release metadata соответствуют `2.9.1`.
- [ ] Release gate предотвращает повторный рассинхрон версии.
