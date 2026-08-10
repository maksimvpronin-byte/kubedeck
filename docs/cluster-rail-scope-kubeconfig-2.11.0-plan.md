# KubeDeck 2.11.0 — рельс кластеров, scope таблицы, редактор kubeconfig и иконка Windows

Статус: реализовано, автоматический gate зелёный. Открыты только пункты ручной
проверки — их нельзя закрыть без реального кластера и packaged-сборки Windows.

Коммиты: `4194ffe` (A), `67d8e45` (D), `1805279` (B), `b8cc708` (release
metadata 2.11.0), `6c15348` (C).

## Цель

Четыре независимых запроса от пользователя:

1. вынести переключение кластеров в вертикальный рельс иконок слева от
   навигации (Overview / Nodes / Pods), вместо выпадающего селектора в топбаре;
2. исправить баг: после переключения с одного namespace на `All namespaces`
   таблица продолжает показывать поды предыдущего namespace;
3. добавить кнопку редактирования YAML-манифеста (kubeconfig) кластера;
4. исправить иконку на Windows: у файла .exe иконка KubeDeck есть, а у
   запущенного приложения (окно, панель задач, Alt+Tab) — дефолтный значок
   Electron.

Уточнено с пользователем до написания плана:

- рельс **заменяет** `ClusterSelector` в топбаре, а не дублирует его;
- симптом бага (2) — в таблице остаются **строки старого namespace**, а не
  пустой/частичный список; это отсекает гипотезу «RBAC forbidden на `-A`» и
  указывает на срыв загрузки в renderer;
- пункт (3) — это правка **kubeconfig кластера** (server, user, context),
  а не «применить произвольный манифест в кластер».

## Правило для этого патча

Как в 2.10.2/2.10.3: документация правится в том же коммите, что и код.
Секции независимы, после каждой — полный gate, не смешивать секции в один
коммит. Порядок работы: **A → D → B → C** (A и D — баги, B и C — фичи;
D вынесена вперёд, потому что она маленькая и затрагивает только desktop shell
и packaging, то есть не конфликтует с renderer-секциями).

Ни одна секция не должна вводить новые npm-зависимости. Новые CSS-переменные
допускаются только с одновременным добавлением во все темы (`styles/tokens.css`
и тест `every color theme exposes the shared token contract`).

---

## Секция A — таблица показывает ресурсы предыдущего namespace (renderer, БАГ)

### Сценарий воспроизведения

1. Открыть кластер, выбрать в NamespaceSelector один namespace (например
   `kube-system`), раздел Workloads → Pods.
2. Дождаться загрузки таблицы.
3. Переключить NamespaceSelector на `All namespaces`.
4. Таблица остаётся с подами `kube-system`; счётчик `N shown of M` не меняется.
   Чем крупнее кластер и чем активнее в нём меняются поды, тем устойчивее
   состояние (на маленьком тестовом кластере может «само вылечиться»).

### Подтверждённая причина

Проверено чтением кода, не угадано:

- `App.tsx:72` — строки таблицы хранятся как `Record<resource, ResourceRow[]>`,
  ключ — **только имя ресурса**. Namespace-scope в состоянии не закодирован,
  поэтому строки, загруженные для `kube-system`, остаются валидными с точки
  зрения UI и после смены scope.
- `useResourceLoader.ts:73-80` — каждый вызов загрузчика **безусловно**
  прерывает предыдущий (`abortRef.current?.abort()`), включая случай, когда
  предыдущий запрос — это как раз новая широкая загрузка `kubectl get pods -A`.
- `useResourceLoader.ts:96-106` — ветка `isAbortError`: возвращает `false`,
  **не трогая `setRows`**. То есть после прерывания в таблице сохраняются
  строки предыдущего scope.
- `useResourceWatch.ts:61-67` — каждое событие watch планирует silent refresh
  через 350 мс; `App.tsx:227-235` добавляет собственный debounce 100 мс.
  На `All namespaces` watch подписан на `-A` (`routes/watch.ts:15-20`), то есть
  поток событий идёт со всего кластера, а не с одного namespace.
- Итог: `kubectl get pods -A -o json` на большом кластере выполняется дольше,
  чем интервал между watch-событиями всего кластера. Каждый silent refresh
  прерывает незавершённую загрузку, ветка abort строки не чистит — таблица
  «залипает» на данных предыдущего namespace, при этом ни ошибки, ни
  индикатора загрузки не показывается (`silent = true`).

Отдельно отмечу: `loadNamespaceResourceBatches` и backend
(`routes/resourceLists.ts:76-88`, `-A` для `namespace=all`) корректны, чинить
их не нужно.

### Задачи

- [x] `utils/kubeResources.ts` — добавить и экспортировать
  `resourceScopeKey(clusterId, resource, namespaces)`: нормализовать выбор
  через существующий `normalizeNamespaceSelection` и собрать строку
  `${clusterId}|${resource}|${ns.join(",")}`. Чистая функция, покрывается
  unit-тестом.
- [x] `useResourceLoader.ts` — хранить `loadedScopeRef: Map<resource, scopeKey>`
  (scope последних **применённых** строк). В начале запроса, если scope
  отличается от записанного, сразу:
  `setRows((current) => ({ ...current, [nextResource]: [] }))` и
  `clearPendingActions()`. Тогда при любом исходе (успех, ошибка, abort,
  timeout) в таблице не может остаться чужой scope: либо новые строки, либо
  пустое состояние с честным `loading`/ошибкой.
- [x] `useResourceLoader.ts` — coalescing вместо срыва: хранить
  `inFlightScopeRef`. Если пришёл **silent** вызов с тем же scope, что и
  выполняющийся запрос, — не вызывать `abort()`, а поднять флаг
  `pendingSilentRefreshRef` и вернуть `false`. После успешного завершения
  запроса, если флаг поднят, выполнить ровно один trailing silent refresh.
  Прерывание остаётся для не-silent вызовов (ручной Refresh) и для вызовов с
  другим scope (смена namespace/ресурса/кластера).
- [x] Записывать `loadedScopeRef` при успехе и при не-abort ошибке (пустая
  таблица тоже принадлежит scope), не записывать при abort/timeout.
- [x] Проверить, что `RESOURCE_LOAD_TIMEOUT` (`useResourceLoader.ts:99-104`)
  теперь показывается на пустой таблице, а не поверх чужих строк, — текст
  сообщения менять не нужно.
- [x] Не менять debounce watch (350 мс) и polling fallback: после coalescing
  они перестают быть причиной срыва, а лишние изменения таймингов усложняют
  проверку.

### Тесты

`apps/desktop/tests/renderer-controllers.contract.test.cjs` (harness
`loadTypeScript` уже умеет грузить хуки со stub-ами React):

- [x] `resourceScopeKey` — `["all"]`, `"kube-system"`, `["a","b"]`,
  `["_cluster"]`, дубликаты и пробелы дают ожидаемые ключи.
- [x] Смена scope очищает строки до await: fake `api.resources`, который
  не резолвится, — после вызова загрузчика `setRows` уже вызван с пустым
  массивом для этого ресурса.
- [x] Silent refresh с тем же scope во время выполняющегося запроса не
  вызывает `abort()` и не приводит ко второму `api.resources` до завершения
  первого; после завершения выполняется ровно один trailing refresh.
- [x] Не-silent вызов и вызов с другим scope по-прежнему прерывают текущий
  запрос.

### Риски

- Мигание пустой таблицы при смене namespace вместо мгновенной подмены строк.
  Это осознанный размен: показывать чужой scope хуже, чем показать `loading`.
  Проверить, что guard `App.tsx:217-226` (сброс залипшего `loading`) не гасит
  индикатор раньше времени на пустой таблице.
- Trailing refresh не должен превращаться в бесконечный цикл: флаг снимается
  **до** запуска trailing-запроса.

### Документация

- `docs/architecture.md`, раздел «Cache and live refresh» — добавить абзац:
  строки таблицы принадлежат scope `(cluster, resource, namespaces)`; смена
  scope очищает их до загрузки; silent refresh от watch не прерывает
  выполняющуюся загрузку того же scope.

---

## Секция B — рельс кластеров слева от навигации (renderer, фича)

### Что делаем

Узкая вертикальная колонка иконок слева от `.sidebar`: одна кнопка на кластер,
активный выделен, при наведении — полное имя. Внизу — кнопка импорта
kubeconfig. Выпадающий `ClusterSelector` из топбара удаляется, освободившееся
место отдаётся глобальному поиску.

### Задачи

- [x] Новый `components/ClusterRail.tsx`. Props: `clusters`, `activeClusterId`,
  `openingClusterId`, `unavailableClusterId`, `onSelect(cluster)`,
  `onImport()`, `t`. Экспортировать чистый хелпер `clusterInitials(displayName)`
  (1–2 символа, устойчив к пустой строке, юникоду и ведущим пробелам) — он
  тестируется отдельно.
- [x] Состояния кнопки: активный кластер (`aria-current="true"` + визуальное
  кольцо), открывающийся (`openingClusterId` — тот же `.spin`, что в
  `layout.css`), недоступный (`unavailableCluster` — маркер ошибки).
  `title` и `aria-label` — полное `displayName`.
- [x] Клавиатура: `nav` с `aria-label`, кнопки в естественном порядке табуляции,
  `ArrowUp`/`ArrowDown` перемещают фокус внутри рельса, `Enter`/`Space` —
  переключение. Порядок кластеров — тот же, что в `config.clusters`
  (ручная сортировка из `reorderClusters` уже персистится).
- [x] `App.tsx`: отрисовать `<ClusterRail>` первым потомком `.app-shell`,
  обработчик — тот же guard, что был у селектора:
  `if (confirmDrawerNavigation()) void openCluster(cluster)`; импорт —
  `importKubeconfig` из `useClusterController`. Удалить `<ClusterSelector>` из
  `<header className="topbar">` и его импорт.
- [x] Удалить `components/ClusterSelector.tsx` (проверить `grep -rn
  ClusterSelector src/` — сейчас единственный потребитель `App.tsx`).
- [x] `styles/layout.css`: `.app-shell` →
  `grid-template-columns: var(--cluster-rail-width, 56px) var(--sidebar-width, 236px) 1fr;`
  плюс блок `.cluster-rail` (вертикальный скролл при большом числе кластеров,
  фон `--sidebar-bg`, разделитель `--border`). `styles/panels.css`,
  `@media (max-width: 1100px)` — `grid-template-columns: 48px 68px 1fr`.
- [x] Пустое состояние: кластеров нет — рельс показывает только кнопку импорта
  с подсказкой `clusters.empty`.
- [x] i18n: новый ключ `clusters.rail` (aria-label рельса) в `locales/ru.json`
  и `locales/en.json`; переиспользовать `clusters.import`, `clusters.opening`,
  `clusters.empty`. Ключ `clusters.none` остаётся в использовании у
  `NamespaceSelector`/палитры — перед удалением проверить `grep`.
- [x] Топбар: пересчитать `grid-template-columns` в `.topbar` после удаления
  селектора, чтобы поиск и `status-line` не разъезжались (в том числе в
  media-блоке `max-width: 1100px`).

### Тесты

- [x] Заменить тест `cluster selector uses the themed in-app menu instead of a
  native select` (renderer-controllers, строка ~135) на тест рельса: нет
  `<select`, одна кнопка на кластер, активный помечен `aria-current`, в
  `App.tsx` нет импорта `ClusterSelector` и есть `ClusterRail`.
- [x] Unit-тест `clusterInitials`.
- [x] Source-assert: обработчик рельса вызывает `openCluster` только через
  `confirmDrawerNavigation()` (защита от потери несохранённого YAML в drawer).

### Риски

- Потеря функциональности при удалении селектора: в нём не было ничего, кроме
  выбора кластера (`ClusterSelector.tsx:41-74`), — переименование/удаление
  живут в Settings → Clusters и остаются там.
- Много кластеров (>15) — рельс должен скроллиться, а не сжимать иконки.
- Тема: проверить светлую/тёмную и `steel-graphite`, contrast активного
  состояния.

### Документация

- `docs/architecture.md`, «Renderer structure» — упомянуть `ClusterRail` как
  точку переключения кластеров.
- `README.md` / `README.ru.md` — если в описании UI упоминается селектор
  кластера в топбаре, поправить формулировку (проверить `grep -n "cluster"`).

---

## Секция C — редактирование kubeconfig кластера (backend + renderer, фича)

### Что делаем

В Settings → Clusters у каждой карточки появляется действие «Редактировать
kubeconfig». Оно открывает модальное окно с YAML содержимого файла
`kubeconfigs/<cluster-id>.yaml`, позволяет отредактировать и сохранить с
подтверждением по имени кластера. Файл содержит учётные данные, поэтому у
секции отдельные требования безопасности.

### Backend

- [x] `config/configStore.ts`:
  - `readKubeconfig(clusterId)` → `{ content, path, managed, sizeBytes }`;
  - `writeKubeconfig(clusterId, content)` — только для managed-пути
    (уже есть хелпер `managedPath(...)`, см. `configStore.ts:467`); запись
    атомарная (tmp + `rename`, как в `importCluster`, `configStore.ts:423-440`),
    режим файла `0o600`, предыдущее содержимое сохраняется в
    `<cluster-id>.yaml.bak` (одна копия, перезаписывается);
  - лимит `MAX_KUBECONFIG_BYTES = 1 MiB`, превышение — ошибка, не запись;
  - валидация через уже имеющуюся зависимость `yaml`: документ парсится,
    ошибок парсинга нет, корень — объект, есть массивы `clusters` и `contexts`
    (и `users`, если он не пустой); `kind`, если указан, равен `Config`.
    Иначе — `INVALID_KUBECONFIG` с номером строки, как в
    `routes/yaml.ts:64-84`.
- [x] `routes/clusters.ts`: `GET /clusters/{cluster_id}/kubeconfig` и
  `PUT /clusters/{cluster_id}/kubeconfig`. PUT требует confirmation с
  `typedName === cluster.displayName` (тот же паттерн, что у apply YAML,
  `validation.confirmationString`).
- [x] `gateway.ts`: после успешного PUT выполнить тот же teardown, что и при
  удалении кластера (`gateway.ts:244-254`), но без удаления самого кластера:
  `watchManager.stopCluster`, `portForwardManager.stopCluster`,
  `terminalWebSocket.stopCluster`, `sshWebSocket.stopCluster`,
  `resourceCache.clear(clusterId, "cluster.kubeconfig.update")`,
  `clearResourceDefinitionCache`, `clearNodeDiskMetricsCache`. Иначе после
  смены server/context останутся живые сессии и кэш от старого endpoint.
- [x] Audit: `cluster.kubeconfig.read` и `cluster.kubeconfig.update` — только
  метаданные (`clusterId`, `name`, `sizeBytes`, `documentCount`, результат).
  Содержимое, токены, сертификаты в audit и в лог **не попадают**; в
  `commandPreview` kubeconfig-путь не раскрывается (`docs/security.md:97`).
- [x] `routeOwnership.ts` — два новых маршрута, `targetRelease`/`migratedIn`
  `2.11.0`, `sourceModule: "routes/clusters.ts"`.

### Renderer

- [x] `api.ts`: `kubeconfig(clusterId, signal?)` и
  `saveKubeconfig(clusterId, content, typedName)`.
- [x] Вынести из `YamlTab.tsx` редактор (слой подсветки + textarea,
  `YamlTab.tsx:196-222` вместе с `highlightYaml`/`highlightYamlLine`) в
  `components/YamlSourceEditor.tsx` и переиспользовать в обоих местах — по
  правилу дедупликации из 2.10.2, копию подсветки не заводить.
- [x] Новый `components/KubeconfigEditorModal.tsx`: контент грузится только по
  явному открытию; баннер-предупреждение, что файл содержит учётные данные;
  действия Save (подтверждение вводом имени кластера) / Cancel (подтверждение
  при несохранённых изменениях); ошибки через `asErrorInfo` + `ErrorPanel`.
- [x] `ClusterPanel.tsx`: кнопка `clusters.editKubeconfig` в `row-actions`,
  disabled при `reorderingClusters`/`openingClusterId`.
- [x] После успешного сохранения: если правился активный кластер — вызвать
  `openCluster(cluster)` (перечитать namespaces и resource definitions),
  иначе ничего не переоткрывать.
- [x] Содержимое kubeconfig **никогда** не попадает в `uiState`/localStorage,
  в LLM-контекст и в глобальный поиск; state модалки очищается при закрытии.

### Тесты

- [x] Новый `apps/desktop/tests/kubeconfig.contract.test.cjs` (добавить в
  скрипт `test:gateway` в `apps/desktop/package.json`): GET отдаёт содержимое
  managed-файла; PUT с валидным YAML пишет атомарно и создаёт `.bak`;
  невалидный YAML → 400 `INVALID_KUBECONFIG`; >1 MiB → 413; неверный
  `typedName` → 422; audit-запись не содержит содержимого файла; после PUT
  ресурсный кэш кластера очищен.
- [x] renderer-controllers: `YamlSourceEditor` используется и `YamlTab`, и
  модалкой (source-assert); модалка не вызывает `saveUiState`.

### Риски

- Пользователь может сломать доступ к кластеру. Смягчение: `.bak`, валидация
  структуры до записи, подтверждение по имени и понятное сообщение об ошибке
  при следующем открытии кластера (существующий `UnavailableClusterPanel`).
- Файл вне `kubeconfigs/` (импорт когда-либо изменится или запись правилась
  вручную): редактор в этом случае открывается **read-only** с причиной, PUT
  отклоняется.
- Рост числа маршрутов ломает release-contract — см. Release sync.

### Документация

- `docs/api.md` — два новых маршрута и их коды ошибок.
- `docs/security.md` — раздел про kubeconfig: редактируется из UI, хранится
  `0600` в app-data, содержимое не логируется, не аудируется и не уходит в LLM;
  запись только внутрь `kubeconfigs/`.
- `docs/architecture.md` — упоминание редактора в разделе Storage/Renderer.

---

## Секция D — иконка приложения на Windows (main process + packaging, БАГ)

### Сценарий воспроизведения

1. Собрать портейбл (`npm run package:win`), посмотреть
   `KubeDeck-Portable-<version>-x64.exe` в проводнике — иконка KubeDeck на месте.
2. Запустить приложение. Окно, панель задач, Alt+Tab и предпросмотр окна
   показывают стандартный значок Electron.
3. То же самое в dev-режиме (`npm run dev`).

### Подтверждённая причина

Проверено чтением конфигурации и main process; причин **три**, и они
независимы — исправлять нужно все, иначе симптом останется частично:

- `apps/desktop/src/main/main.ts:111-124` — `new BrowserWindow({...})`
  создаётся без свойства `icon`. На Windows окно в этом случае берёт иконку
  из ресурсов исполняемого файла процесса, а не из ассетов приложения.
- `apps/desktop/electron-builder.yml`, блок `win` —
  `signAndEditExecutable: false`. Этот флаг выключает не только подпись, но и
  rcedit-правку ресурсов **внутреннего** `KubeDeck.exe` (иконка и version info).
  При этом иконка внешней портейбл-обёртки берётся из `win.icon` на этапе
  NSIS и не зависит от rcedit — отсюда и наблюдаемая асимметрия: файл в
  проводнике «правильный», а запускается извлечённый inner exe с иконкой
  Electron. В git не зафиксирована причина, по которой флаг выставлен в
  `false` (пришёл ещё из сквошнутого `97d75d0`), поэтому его возврат нужно
  подтверждать реальной сборкой, а не считать бесплатным.
- `apps/desktop/electron-builder.yml`, `files:` — в payload попадают только
  `dist/**/*` и `package.json`. Каталог `assets/` в сборку не входит, поэтому
  даже после добавления `icon:` в `BrowserWindow` файл не найдётся в runtime.

Дополнительно: `app.setAppUserModelId(...)` нигде не вызывается
(`grep -n setAppUserModelId src/main/main.ts` — пусто). Без AppUserModelID
Windows группирует окно по хост-процессу, что портит иконку и закрепление в
панели задач даже при корректном `BrowserWindow.icon`.

`assets/icon.ico` уже валидный многоразмерный ICO (6 изображений, включая
256×256) — конвертировать ничего не нужно, история с падающим PNG→ICO
конвертером из 2.9.2 здесь не воспроизводится.

### Задачи

- [x] `electron-builder.yml`, `files:` — добавить `assets/icon.ico` и
  `assets/icon-512.png` (нужен для окна на Linux). Не тянуть в payload
  `kubedeck-icon-source.png` (1.6 МБ) и `icon.png`; `icon.icns` для macOS
  подставляет сам electron-builder из `mac.icon`.
- [x] `main.ts` — хелпер `resolveWindowIcon()`: на `win32` берёт
  `assets/icon.ico`, иначе `assets/icon-512.png`; путь строится от `__dirname`
  (`dist/main` → `../../assets/...`); загрузка через
  `nativeImage.createFromPath`. Если `image.isEmpty()` — не передавать `icon`
  вовсе и записать предупреждение через `logDesktop`, приложение не должно
  падать из-за иконки.
- [x] `main.ts` — передать полученный icon в `new BrowserWindow({...})`
  (`main.ts:111`). Это же чинит dev-режим, где процесс — `electron.exe`.
- [x] `main.ts` — вызвать `app.setAppUserModelId("dev.kubedeck.app")` до
  `app.whenReady()`; значение обязано совпадать с `appId` из
  `electron-builder.yml`. На не-Windows вызов безвреден, но лучше ограничить
  `process.platform === "win32"`, чтобы не вводить в заблуждение.
- [x] `electron-builder.yml` — `win.signAndEditExecutable: true`, чтобы rcedit
  прописал иконку и version-info (ProductName, FileDescription, версия) во
  внутренний `KubeDeck.exe`. Подпись при этом не выполняется: сборка идёт с
  `CSC_IDENTITY_AUTO_DISCOVERY=false` и без сертификата
  (`scripts/build-portable-windows.ps1`). **Если** rcedit падает в конкретной
  среде сборки — откатывать только этот пункт: runtime-иконка от него не
  зависит, а свойства файла останутся дефолтными.
- [x] Проверить, что macOS не регрессирует: там иконка берётся из бандла
  `.icns`, `BrowserWindow.icon` игнорируется.

### Тесты

- [x] `apps/desktop/tests/release.contract.test.cjs` (там уже читается
  `electron-builder.yml` и скрипты сборки): ассерты, что `files:` содержит
  `assets/icon.ico`, что `win.signAndEditExecutable` не выключен, и что
  `main.ts` вызывает `setAppUserModelId` и передаёт `icon` в `BrowserWindow`.
- [x] Проверить, что `verify:release` проходит: `verifyReleasePayload`
  (`scripts/verify-release.cjs:199-235`) работает по denylist, добавление
  ассетов его не нарушает.

### Ручная проверка (обязательна, автотестами не заменяется)

- [ ] Windows: `npm run package:win`, запустить портейбл — иконка окна, панели
  задач, Alt+Tab, предпросмотра и закрепления должна быть KubeDeck.
- [ ] Windows: свойства извлечённого `KubeDeck.exe` → «Подробно»: имя продукта
  и версия KubeDeck (проверяет пункт про `signAndEditExecutable`).
- [ ] `npm run dev` — иконка окна тоже KubeDeck, а не Electron.

### Риски

- rcedit исторически бывал источником падений сборки (ср. историю с icon-tool
  в 2.9.2). Смягчение: пункт про `signAndEditExecutable` отделён от остальных
  и откатывается независимо.
- Чтение иконки из asar: `nativeImage.createFromPath` работает с asar-путями,
  но если в packaged-сборке иконка окажется пустой — запасной вариант вынести
  `assets/icon.ico` в `extraResources` и читать из `process.resourcesPath`.
  Проверять именно на packaged-сборке, dev тут ничего не доказывает.

### Документация

- `docs/release-checklist.md` — в ручной прогон Windows добавить проверку
  иконки окна/панели задач и свойств exe.
- `CHANGELOG.md` / release notes 2.11.0 — user-visible fix.
- `docs/releases/REGRESSION_CHECKLIST_2.11.0.md` — пункт про иконку.

---

## Release sync 2.11.0

- [x] Версия `2.11.0` в `package.json`, `apps/desktop/package.json`
  (и зависимость `@kubedeck/shared-types`), `packages/shared-types/package.json`,
  пересобрать `package-lock.json`.
- [x] `release-contract.json`: `nodeRoutes` 54 → **56** (две новых
  kubeconfig-ручки). Синхронно — константы в
  `apps/desktop/tests/release.contract.test.cjs:68-73` (`/56/`,
  `Node 56 / Python 0`) и `docs/release-checklist.md:50`.
- [x] `docs/architecture.md:104` — там сейчас устаревшее `52 Node / 0 Python`
  при фактических 54; в этом патче привести к 56.
- [x] `CHANGELOG.md` — запись 2.11.0: Секции A (таблица показывала ресурсы
  предыдущего namespace) и D (иконка запущенного приложения на Windows) как
  bugfix, B и C как features.
- [x] `docs/releases/RELEASE_NOTES_2.11.0.md` и
  `docs/releases/REGRESSION_CHECKLIST_2.11.0.md` по образцу 2.10.3.
- [x] `README.md` / `README.ru.md` — версия и ссылки на release notes/checklist.
- [x] `NODE_MIGRATION_PROGRESS.md` — короткая запись про 2.11.0.
- [x] `docs/third-party-notices.md` — версия в шапке.

## Автоматический gate (после каждой секции)

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`

Итог после секции C: `npm run verify` зелёный — renderer 59 тестов (было 53),
gateway 109 тестов (было 103, из них 5 новых в
`tests/kubeconfig.contract.test.cjs`). `verify:release` подтверждает
`Node 56 / Python 0` и версию 2.11.0.

Дополнительно проверено вживую (не заменяет ручной прогон ниже): рельс
отрисован в dev-сборке renderer через Vite — `.app-shell` даёт
`56px 236px 1fr`, на ширине 1000px переключается на `48px 68px 1fr`,
горизонтального переполнения нет.

## Ручная проверка (нужна, автотесты её не заменяют)

- [ ] Секция A: на реальном кластере с несколькими namespace открыть Pods в
  одном namespace, переключить на `All namespaces` — таблица должна пройти
  через пустое/loading состояние и показать поды всех namespace; повторить
  туда-обратно 5–10 раз и при активном изменении подов.
- [ ] Секция B: рельс в светлой/тёмной/`steel-graphite` теме, на узком окне
  (<1100px), с 1, 3 и 15+ кластерами; переключение кластера при открытом
  drawer с несохранённым YAML должно спрашивать подтверждение.
- [ ] Секция C: отредактировать kubeconfig неактивного и активного кластера,
  сохранить заведомо битый YAML (должна быть ошибка без записи), проверить
  наличие `.bak` и что после смены `server` старые watch/port-forward/terminal
  сессии закрыты.
- [ ] Секция D: см. её собственный блок ручной проверки (packaged-сборка +
  dev-режим). Это единственная секция, которую нельзя закрыть без сборки
  портейбла на Windows.

## Отклонения от плана при реализации

- Маршруты kubeconfig вынесены в отдельный модуль
  `routes/clusterKubeconfig.ts`, а не добавлены в `routes/clusters.ts`:
  валидация, audit и обработка ошибок для них самостоятельные, и в
  `clusters.ts` они бы только размывали границу модуля.
- Teardown кластера вынесен в общий `releaseClusterRuntime()` в `gateway.ts` и
  переиспользован удалением кластера — вместо копии того же блока.
- Отдельный ключ `clusters.rail` не заводился: aria-label рельса —
  существующий `clusters.title`.
- Методы API названы `clusterKubeconfig`/`saveClusterKubeconfig` (не
  `kubeconfig`/`saveKubeconfig`), чтобы не путать с импортом kubeconfig.
- Release sync выполнен **до** секции C отдельным коммитом: release contract
  test проверяет число маршрутов против release-документов текущей версии,
  поэтому бампнуть маршруты до 56 без версии 2.11.0 нельзя, не переписывая
  release notes 2.10.3.
- Кроме `release.contract.test.cjs`, число маршрутов зашито ещё в четырёх
  gateway-тестах (`gateway`, `watch`, `port-forward`, `pod-terminal`) — они
  тоже обновлены на 56; в плане это не было учтено.

## Не входит в патч

- Цветовая метка на кластер в рельсе (prod/dev) — потребует новых токенов во
  всех темах; отдельная задача.
- Переименование/удаление кластера из контекстного меню рельса — остаётся в
  Settings → Clusters.
- Редактирование kubeconfig, лежащего вне `kubeconfigs/`, и слияние
  multi-context kubeconfig.
- Применение произвольного манифеста в кластер («Create resource from YAML») —
  backend `PUT /clusters/{id}/yaml/apply` это уже умеет, но точка входа в UI
  не запрашивалась; отдельный план, если понадобится.

## Критерий завершения

Таблица ресурсов никогда не показывает строки чужого namespace-scope, а
silent refresh от watch не срывает выполняющуюся загрузку. Переключение
кластеров выполняется из рельса слева, `ClusterSelector` удалён, топбар не
разъезжается ни в одной теме и ширине окна. kubeconfig кластера редактируется
из Settings с валидацией, подтверждением, `.bak` и закрытием живых сессий
кластера; содержимое файла не попадает в лог, audit, uiState и LLM. Запущенное
приложение на Windows показывает иконку KubeDeck в окне, панели задач и
Alt+Tab — и в packaged-сборке, и в dev. Версия и release-документы
синхронизированы на 2.11.0, `nodeRoutes: 56`. Полный gate зелёный.
