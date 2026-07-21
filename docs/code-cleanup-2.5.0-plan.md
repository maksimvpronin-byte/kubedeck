# KubeDeck 2.5.0 — план удаления подтверждённого мусора

Статус: план подготовлен, проверка кода не начата.

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
| — | — | — | — | — | — | — |

Допустимые решения: `удалить`, `оставить`, `отложить`. Для `оставить` и `отложить` обязательно записать краткую причину.

## Секция A — карта entrypoints и владельцев

- [x] Зафиксировать baseline: tracked files, строки production/test-кода и размеры build chunks.
- [x] Составить карту root scripts, Electron main/preload/renderer entrypoints и Gateway routes.
- [x] Отметить dynamic и string-based связи, которые статический анализ может пропустить.
- [ ] Зафиксировать platform-only, migration, recovery и release-only владельцев.
- [ ] Не удалять код на этом этапе.

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

- [ ] Найти файлы и exports без входящих связей.
- [ ] Найти недостижимые route handlers и повторяющиеся helpers.
- [ ] Проверить устаревшие IPC/HTTP/WebSocket contracts.
- [ ] Проверить shutdown, recovery, platform и error paths отдельно от happy path.
- [ ] Для каждого кандидата выполнить обе проверки и заполнить таблицу.
- [ ] Удалять небольшими группами с одним владельцем.

Локальный gate: `npm run lint`, `npm run typecheck`, затронутые Gateway contracts и `npm run build`.

## Секция C — renderer

- [ ] Проверить компоненты, hooks, utils, imports, props, state и exports без потребителей.
- [ ] Проверить lazy imports, modal/drawer entrypoints и action routing.
- [ ] Найти дублирующие helpers только после сравнения поведения и edge cases.
- [ ] Не считать условный UI недостижимым без проверки состояния, feature availability и error path.
- [ ] Для каждого кандидата выполнить обе проверки и заполнить таблицу.

Локальный gate: `npm run lint`, `npm run test:renderer`, `npm run typecheck` и `npm run build`.

## Секция D — CSS, locales и assets

- [ ] Сопоставить selectors с JSX/TSX, динамическими class names и portal owners.
- [ ] Сопоставить locale keys со всеми вызовами перевода и составными ключами.
- [ ] Сопоставить assets с imports, HTML, CSS `url()`, packaging resources и документацией.
- [ ] Проверить theme tokens, accessibility states, print/reduced-motion и platform selectors.
- [ ] Визуально проверить затронутые экраны после удаления.

Локальный gate: renderer contracts, production build и ручной smoke затронутых экранов и тем.

## Секция E — тесты и test helpers

- [ ] Найти helpers и fixtures без вызовов.
- [ ] Найти тесты, полностью дублирующие другой тест без дополнительного контракта.
- [ ] Перед удалением теста доказать, что тот же failure остаётся пойман другим тестом.
- [ ] Не удалять тест только потому, что production-код был упрощён.
- [ ] Проверить, что все test-файлы включены в package scripts или намеренно запускаются отдельно.

Локальный gate: полный renderer и Gateway test suites с неизменным покрытием действующих контрактов.

## Секция F — dependencies, scripts и config

- [ ] Для каждой зависимости проверить imports/requires и `npm explain`.
- [ ] Отдельно проверить build-time, optional, native и platform-specific использование.
- [ ] Для package scripts проверить вызовы из README, CI, release scripts и ручных workflows.
- [ ] Для config-полей проверить документацию текущей версии инструмента и фактическую build/package команду.
- [ ] После удаления зависимости обновить lock обычным npm-механизмом без force-upgrade соседних пакетов.

Локальный gate: все scripts, которым принадлежал кандидат, затем полный `npm run verify` и `npm run verify:release`.

## Секция G — generated files и документация

- [ ] Проверить tracked `dist`, `release`, caches, logs, temporary и OS/editor files.
- [ ] Проверить `.gitignore`, `.gitattributes` и packaging include/exclude rules.
- [ ] Найти документы без входящих ссылок и документы, описывающие удалённые workflows.
- [ ] Не удалять исторические release notes/checklists без отдельного подтверждения принятой политики хранения.
- [ ] Исправить ссылки только после принятого удаления, без переписывания истории релизов.

Локальный gate: Markdown links, release contract, clean production build и проверка `git status` на generated artifacts.

## Секция H — второй полный проход

После первого цикла и всех принятых удалений провести проверку проекта заново, начиная от entrypoints.

- [ ] Повторно построить список файлов, exports, dependencies, scripts, selectors, locale keys и assets.
- [ ] Проверить новые сироты, появившиеся после удаления их последних потребителей.
- [ ] Каждый новый кандидат снова провести через две независимые проверки.
- [ ] Сравнить baseline и итог: production/test LOC, число файлов, dependencies и build chunks.
- [ ] Если второй проход не находит доказанного мусора, завершить удаление.

Второй полный проход не заменяет две проверки кандидата: это дополнительный контроль всей уборки.

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

- [ ] `npm run lint`.
- [ ] `npm run format:check`.
- [ ] `npm run test:renderer`.
- [ ] `npm run typecheck`.
- [ ] `npm run build`.
- [ ] `npm --workspace apps/desktop run test:gateway`.
- [ ] `npm run verify:release` после оформления версии 2.5.0.
- [ ] `git diff --check`.
- [ ] Проверить `git status`: generated artifacts и несвязанные изменения отсутствуют.
- [ ] Выполнить packaged smoke на поддерживаемых Windows и macOS перед выпуском artifacts.

## Критерии приёмки 2.5.0

- [ ] Каждый удалённый кандидат имеет две записанные независимые проверки.
- [ ] Для каждого оставленного спорного кандидата записана причина.
- [ ] Публичные API, IPC, HTTP, WebSocket и shared type contracts не изменены.
- [ ] Пользовательское поведение и внешний вид не изменены.
- [ ] Новые dependencies и speculative abstractions не добавлены.
- [ ] Итоговые числа файлов, LOC и dependencies не превышают baseline; исключения объяснены.
- [ ] Второй полный проход завершён.
- [ ] Полный regression gate и packaged smoke пройдены.

## Оставлено

Сюда заносятся элементы, которые выглядели лишними, но не прошли обе проверки на удаление.

| Кандидат | Причина оставить | Условие повторной проверки |
| --- | --- | --- |
| — | — | — |
