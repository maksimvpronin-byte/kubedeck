# KubeDeck 2.5.0 — план удаления подтверждённого мусора

Статус: завершён. Два независимых прохода, полный release gate и пользовательский packaged/visual smoke KubeDeck 2.5.0 выполнены.

## Цель

Проверить весь versioned код и связанные файлы KubeDeck, найти элементы, которые не участвуют в сборке, runtime, тестах, packaging или документации, и удалить только кандидатов, подтверждённых двумя независимыми проверками.

Результат 2.5.0 должен содержать меньше поддерживаемого кода без изменения поведения, публичных контрактов и пользовательского интерфейса.

## Главный критерий удаления

Кандидат удаляется только при одновременном выполнении условий:

1. Первая проверка не находит действующего владельца или потребителя.
2. Вторая, независимая проверка подтверждает, что кандидат не нужен сборке, runtime, тестам, packaging или поддерживаемому workflow.
3. После удаления проходит локальный gate затронутой области.
4. После завершения секции проходит полный regression gate.

Одна проверка — недостаточное основание. Если результаты расходятся или назначение неясно, кандидат остаётся в коде и записывается в раздел «Оставлено» с причиной.

## Что считается мусором

- недостижимые файлы, функции, ветки и exports;
- неиспользуемые импорты, типы, props, state и локальные helpers;
- дублирующие реализации с одинаковым действующим контрактом;
- устаревшие CSS selectors, locale keys и статические assets без владельца;
- неиспользуемые scripts, package scripts и конфигурационные поля;
- прямые и development-зависимости без production, build или test-потребителя;
- старые compatibility paths, если поддерживаемый baseline их больше не вызывает;
- случайно versioned generated artifacts, временные файлы и пустые директории;
- устаревшие документы, ссылки и release-файлы, если политика репозитория не требует их хранения.

Не считаются мусором только из-за размера или редкого использования:

- обработка ошибок, redaction, validation и security boundaries;
- platform-specific код Windows/macOS;
- recovery, migration и backward-compatibility paths;
- accessibility и reduced-motion поведение;
- test helpers, которые защищают действующий контракт;
- release/package scripts, запускаемые вне обычной development-сборки.

## Область проверки

- `apps/desktop/src/main` и `apps/desktop/src/preload`;
- `apps/desktop/src/renderer`, включая styles, locales и assets;
- `apps/desktop/tests`;
- `packages/shared-types` и прочие versioned package-каталоги;
- root и desktop package manifests, TypeScript, Vite, Electron Builder и Biome config;
- `scripts`, packaging и release contracts;
- `README*`, `docs`, changelog, release notes и regression checklists;
- tracked files по `git ls-files` и правила игнорирования.

`node_modules`, `dist` и `release` проверяются только на случай ошибочного попадания в Git. Содержимое корректно игнорируемых generated-каталогов не анализируется как исходный код.

## Протокол двух проверок

Для каждого кандидата в таблице решений фиксируются путь, символ или ключ и два отдельных доказательства.

### Проверка 1 — статические связи

- найти все точные и вариантные упоминания через `rg`;
- проверить imports, exports, re-exports, dynamic imports и barrel-файлы;
- проверить IPC/HTTP route names, WebSocket paths, CSS class names, locale keys и строковые lookup;
- проверить package scripts, config globs, Electron Builder resources и release scripts;
- проверить обращения из тестов и документации.

Результат: перечисленные потребители либо подтверждённое отсутствие потребителей.

### Проверка 2 — независимый контракт

Выбрать проверку, отличную от простого повторного поиска:

- TypeScript diagnostics или временное локальное удаление с `typecheck`;
- production build и анализ фактически включённых entrypoints/chunks;
- связанный renderer или Gateway contract;
- запуск package/release verifier для scripts и config;
- проверка DOM/runtime-владельца для CSS, locale keys и assets;
- `npm explain` плюс поиск runtime `require`/`import` и выполнение всех scripts для зависимости;
- `git check-ignore`, `git ls-files` и воспроизводимая чистая build-проверка для generated files;
- проверка входящих Markdown-ссылок и release contract для документации.

Результат: конкретная команда или сценарий и его итог.

Два одинаковых `rg`-запроса не считаются двумя проверками.

## Таблица решений

Заполнять до удаления:

| ID | Кандидат | Проверка 1 | Проверка 2 | Риск | Решение | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| C-01 | Неиспользуемый pipes fallback Pod Terminal | Единственный `startPipeSession` не имел вызовов | `tsc --noUnusedLocals` отметил функцию; PTY/unavailable contracts подтверждают действующий flow | Средний | удалить | targeted terminal 4/4 |
| C-02 | IPC `getBackendUrl` и внешний `openPodShell` с генератором scripts | Renderer, tests, docs и scripts не имеют вызовов | Production build и terminal/auth contracts используют `getBackendAuth` + PTY WebSocket | Средний | удалить | build + targeted contracts |
| C-03 | `GatewayRouteOwner`, `GatewayRouteTransport`, `GatewayMigrationStatus` в shared-types | Symbol scan показал только определения | Backend `/migration/status` использует отдельный действующий `MigrationStatus`; typecheck/build проходят | Низкий | удалить | typecheck + build |
| C-04 | Семь repair/validate/finalize/cleanup PowerShell scripts старого layout | Действующих ссылок нет | Scripts требуют 1.0.x, Python backend или отсутствующие каталоги и противоречат Node-only release contract | Низкий | удалить | node-only/release contracts |
| C-05 | Старый CSS-блок `restart-diagnostics-*` | Selectors существуют только в CSS | Текущий `ResourceSummary` использует `pod-restart-*`; renderer contracts и build проходят | Низкий | удалить | renderer 27/27 + build |

Допустимые решения: `удалить`, `оставить`, `отложить`. Для `оставить` и `отложить` обязательно записать краткую причину.

## Секция A — карта entrypoints и владельцев

- [x] Зафиксировать baseline: tracked files, строки production/test-кода и размеры build chunks.
- [x] Составить карту root scripts, Electron main/preload/renderer entrypoints и Gateway routes.
- [x] Отметить dynamic и string-based связи, которые статический анализ может пропустить.
- [x] Зафиксировать platform-only, migration, recovery и release-only владельцев.
- [x] Не удалять код на этом этапе.

Критерий готовности: дальнейшие поиски опираются на полную карту входов, а не только на TypeScript imports.

Baseline 2026-07-21 после выпуска 2.4.5:

- 245 tracked-файлов;
- 153 production-файла TypeScript/TSX/CSS, 32 474 строки;
- TypeScript/TSX production-код — 25 854 строки;
- 20 test-файлов, 7 237 строк;
- renderer build assets — 866 119 байт после `npm run build` для 2.4.5;
- entrypoints: `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/main.tsx`;
- Gateway: 21 route-модуль и три WebSocket upgrade path — Watch, Pod Terminal и Node SSH;
- Electron main регистрирует семь строковых IPC handlers, preload экспортирует соответствующий renderer bridge;
- dynamic/string-based владельцы: IPC channel names, HTTP/WebSocket paths, lazy imports, CSS class names, locale keys, package scripts и Electron Builder resource rules;
- `apps/desktop/dist` и `apps/desktop/release` корректно исключены через `.gitignore` и не входят в tracked baseline.

## Секция B — main, preload и Gateway

- [x] Найти файлы и exports без входящих связей.
- [x] Найти недостижимые route handlers и повторяющиеся helpers.
- [x] Проверить устаревшие IPC/HTTP/WebSocket contracts.
- [x] Проверить shutdown, recovery, platform и error paths отдельно от happy path.
- [x] Для каждого кандидата выполнить обе проверки и заполнить таблицу.
- [x] Удалять небольшими группами с одним владельцем.

Локальный gate: `npm run lint`, `npm run typecheck`, затронутые Gateway contracts и `npm run build`.

## Секция C — renderer

- [x] Проверить компоненты, hooks, utils, imports, props, state и exports без потребителей.
- [x] Проверить lazy imports, modal/drawer entrypoints и action routing.
- [x] Найти дублирующие helpers только после сравнения поведения и edge cases.
- [x] Не считать условный UI недостижимым без проверки состояния, feature availability и error path.
- [x] Для каждого кандидата выполнить обе проверки и заполнить таблицу.

Локальный gate: `npm run lint`, `npm run test:renderer`, `npm run typecheck` и `npm run build`.

## Секция D — CSS, locales и assets

- [x] Сопоставить selectors с JSX/TSX, динамическими class names и portal owners.
- [x] Сопоставить locale keys со всеми вызовами перевода и составными ключами.
- [x] Сопоставить assets с imports, HTML, CSS `url()`, packaging resources и документацией.
- [x] Проверить theme tokens, accessibility states, print/reduced-motion и platform selectors.
- [x] Визуально проверить затронутые экраны после удаления.

Локальный gate: renderer contracts, production build и ручной smoke затронутых экранов и тем.

## Секция E — тесты и test helpers

- [x] Найти helpers и fixtures без вызовов.
- [x] Найти тесты, полностью дублирующие другой тест без дополнительного контракта.
- [x] Перед удалением теста доказать, что тот же failure остаётся пойман другим тестом.
- [x] Не удалять тест только потому, что production-код был упрощён.
- [x] Проверить, что все test-файлы включены в package scripts или намеренно запускаются отдельно.

Локальный gate: полный renderer и Gateway test suites с неизменным покрытием действующих контрактов.

## Секция F — dependencies, scripts и config

- [x] Для каждой зависимости проверить imports/requires и `npm explain`.
- [x] Отдельно проверить build-time, optional, native и platform-specific использование.
- [x] Для package scripts проверить вызовы из README, CI, release scripts и ручных workflows.
- [x] Для config-полей проверить документацию текущей версии инструмента и фактическую build/package команду.
- [x] После удаления зависимости обновить lock обычным npm-механизмом без force-upgrade соседних пакетов; зависимости не удалялись, lock изменён только для версии.

Локальный gate: все scripts, которым принадлежал кандидат, затем полный `npm run verify` и `npm run verify:release`.

## Секция G — generated files и документация

- [x] Проверить tracked `dist`, `release`, caches, logs, temporary и OS/editor files.
- [x] Проверить `.gitignore`, `.gitattributes` и packaging include/exclude rules.
- [x] Найти документы без входящих ссылок и документы, описывающие удалённые workflows.
- [x] Не удалять исторические release notes/checklists без отдельного подтверждения принятой политики хранения.
- [x] Исправить ссылки только после принятого удаления, без переписывания истории релизов.

Локальный gate: Markdown links, release contract, clean production build и проверка `git status` на generated artifacts.

## Секция H — второй полный проход

После первого цикла и всех принятых удалений провести проверку проекта заново, начиная от entrypoints.

- [x] Повторно построить список файлов, exports, dependencies, scripts, selectors, locale keys и assets.
- [x] Проверить новые сироты, появившиеся после удаления их последних потребителей.
- [x] Каждый новый кандидат снова провести через две независимые проверки.
- [x] Сравнить baseline и итог: production/test LOC, число файлов, dependencies и build chunks.
- [x] Если второй проход не находит доказанного мусора, завершить удаление.

Второй полный проход не заменяет две проверки кандидата: это дополнительный контроль всей уборки.

Результат второго прохода:

- `tsc --noUnusedLocals --noUnusedParameters` чист для main/preload и renderer;
- import graph не нашёл сирот, кроме `theme-bootstrap.js`, напрямую подключённого `index.html` и присутствующего в production build;
- exported-symbol scan и locale-key scan не нашли новых кандидатов;
- все 20 test-файлов входят в package scripts; доказуемых дублирующих контрактов нет;
- dependencies имеют runtime, build, test или CLI-владельцев; удаления не требуются;
- tracked generated artifacts отсутствуют, `dist` и `release` корректно игнорируются;
- итоговый diff до release-документов: 14 файлов, 3 добавленные и 1 120 удалённых строк;
- renderer CSS bundle уменьшился с 115,44 до 113,20 КБ без изменения JS chunks.

## Правила внесения изменений

- Сначала доказательства и запись в таблице, затем удаление.
- Один commit/patch — одна связанная группа кандидатов.
- Предпочитать чистое удаление; не создавать abstraction ради удаления нескольких строк.
- Не переименовывать и не форматировать соседний код без необходимости.
- Не заменять понятный рабочий код более коротким, но менее надёжным вариантом.
- Не добавлять новую dependency для поиска или удаления мусора: достаточно `rg`, TypeScript, Biome, npm и существующих тестов.
- Любое изменение поведения выносится из 2.5.0 или оформляется отдельным подтверждённым defect fix.
- При сомнении оставлять код.

## Полный regression gate

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer`; 27/27 tests.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway`; 73/73 tests.
- [x] `npm run verify:release` после оформления версии 2.5.0.
- [x] `git diff --check`.
- [x] Проверить `git status`: generated artifacts и несвязанные изменения отсутствуют.
- [x] Выполнить packaged/visual smoke; результат подтверждён пользователем.

## Критерии приёмки 2.5.0

- [x] Каждый удалённый кандидат имеет две записанные независимые проверки.
- [x] Для каждого оставленного спорного кандидата записана причина.
- [x] Действующие API, HTTP, WebSocket и shared type contracts не изменены; удалены только два неиспользуемых IPC channel.
- [x] Пользовательское поведение и внешний вид подтверждены пользователем после functional smoke.
- [x] Новые dependencies и speculative abstractions не добавлены.
- [x] Итоговые числа файлов, LOC и dependencies не превышают baseline.
- [x] Второй полный проход завершён.
- [x] Полный regression gate и packaged smoke пройдены.

## Оставлено

Сюда заносятся элементы, которые выглядели лишними, но не прошли обе проверки на удаление.

| Кандидат | Причина оставить | Условие повторной проверки |
| --- | --- | --- |
| `theme-bootstrap.js` | Загружается напрямую из `index.html`, до React восстанавливает тему и копируется в production build | Только при замене раннего theme bootstrap другим механизмом |
| Dynamic/xterm CSS selectors | `is-*` создаются шаблонно, `xterm-*` создаёт библиотека | Удалять только с DOM coverage и visual smoke |
| Смешанные `*-polish.css` overrides | Часть selectors устарела, но правила объединены с действующими владельцами | Разбирать отдельным visual cleanup на всех темах |
| CLI и `@types` dependencies | Используются package scripts, TypeScript или platform packaging без прямого import | Повторить после удаления соответствующего workflow/tool |
| Исторические release notes/checklists | Политика хранения истории отдельно не менялась | Удалять только после отдельного решения о retention документации |
