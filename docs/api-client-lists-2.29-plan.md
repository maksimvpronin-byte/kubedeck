# KubeDeck 2.29.x — собственный HTTP-клиент к API-серверу, начиная со списков

Статус: в работе, версии не подняты (фиксы копятся до релизного коммита).
Фаза 1 (1A-1E, включая exec-плагины) сделана: транспорт подключён в
`KubectlRunner`, поэтому через него идут все `get --raw`, а не только списки.

## Цель

Убрать запуск процесса `kubectl` с горячего пути чтения. Сейчас каждый список,
каждое обновление по событию watch и каждый `kubectl top` — это отдельный
процесс: запуск `kubectl.exe` (на Windows с антивирусом — сотни миллисекунд),
разбор kubeconfig, при exec-авторизации ещё и запуск плагина, новое TLS-
соединение. Lens держит одно постоянное соединение на кластер и делает обычные
HTTP-запросы; отсюда основная разница в ощущаемой скорости.

Raw-чтение (2.28.3 и `b56e190` для CRD) уже убрало перекодирование `-o json`.
Этот план убирает то, что осталось: сам процесс.

Первая фаза — только списки (`routes/resourceLists.ts`). Остальные чтения,
watch и кеш в окне — следующие фазы, они опираются на клиент из первой.

## Правило для этого патча

Как обычно: **одна секция — один релиз**, документация в том же коммите, что и
код, полный автоматический gate. Секции 1A-1D по отдельности пользователю
ничего не дают, поэтому выходят одним релизом; дальше — по одной.

| Секция | Версия | Тип |
|---|---|---|
| 1A-1D — клиент для списков (сертификаты и токены) | 2.29.0 | feat |
| 1E — exec-плагины авторизации | 2.29.1 | feat |
| 2 — остальные чтения | 2.30.x | fix/feat по секциям |
| 3 — list+watch в бэкенде, дельты в окно | 2.31.0 | feat |
| 4 — последний список сразу при переключении | 2.31.x | fix |

Если на рабочих кластерах авторизация в основном через exec (kubelogin, OIDC,
облачные CLI), 1E стоит выпустить вместе с 2.29.0: без неё такие кластеры
останутся на kubectl и ускорения не увидят.

## Решение: свой клиент, не `@kubernetes/client-node`

- Нужно из него немного: разбор kubeconfig, TLS, токен, GET с таймаутом и
  отменой. Это несколько сотен строк на `node:https` и уже имеющемся `yaml`.
- `client-node` тянет большое дерево зависимостей (а с ним
  `docs/third-party-notices.md` и `release-contract.json`), своё понимание
  kubeconfig и свою модель ошибок, которую всё равно пришлось бы переводить в
  наши `KubectlError`.
- Всё, что свой клиент не понимает, уходит в kubectl, как сейчас. Полнота не
  нужна, нужна честная граница «умею / не умею».

---

## Фаза 1 — списки

### 1A — профиль подключения из kubeconfig

Новый модуль `backend/api/connectionProfile.ts`: kubeconfig кластера →
профиль или `null` («не умею, иди в kubectl»).

Кластер в KubeDeck — это файл с `current-context` (`clusterCommand` передаёт
только `--kubeconfig`), поэтому берётся контекст `current-context` и его
`cluster`/`user`. Поддерживается:

- cluster: `server`, `certificate-authority` / `-data`,
  `insecure-skip-tls-verify`, `tls-server-name`, `proxy-url`;
- user: `client-certificate` / `-data` + `client-key` / `-data`, `token`,
  `tokenFile` (перечитывать при изменении, как kubectl);
- user `exec` — в секции 1E; до неё профиль `null`.

Не поддерживается, профиль `null`: `auth-provider`, `username`/`password`,
`as`/`as-groups` (impersonation), несколько файлов в одном пути,
`namespace` контекста там, где он нужен (сейчас это только список с
`_cluster` для namespaced-типа, он и так идёт в kubectl).

Кеш профиля по `mtime`+`size` файла — тот же приём, что
`kubectlEnvironment()` в `kubectl/command.ts`. Пути к файлам сертификатов —
относительно каталога kubeconfig, как у kubectl.

Тесты: набор kubeconfig-фикстур, на каждую — ожидаемый профиль или `null`.

### 1B — транспорт

`backend/api/apiClient.ts`:

- один `https.Agent` на кластер, `keepAlive: true`, ограничение сокетов;
  пересоздаётся при смене профиля и сбрасывается вместе с остальными кешами
  кластера (`clearClusterReadCaches` в `gateway.ts`) и при отключении;
- `getJson(path, { timeoutMs, maxBytes, signal })`: `Accept: application/json`,
  `Accept-Encoding: gzip`, таймаут как у `--request-timeout` сейчас, отмена по
  `AbortSignal` с закрытием запроса, лимит размера ответа (как
  `OUTPUT_TOO_LARGE` в `runner.ts`);
- прокси: `HTTPS_PROXY`/`NO_PROXY` с той же добавкой `NO_PROXY`, что делает
  `kubectlEnvironment()` (localhost, частные сети, хост API-сервера), и
  `proxy-url` из kubeconfig. В Electron 43 встроен Node 24.18, где у
  `https.Agent` есть опция `proxyEnv` (с 24.5): прокси без новой зависимости.
  `proxy-url` передаётся туда же как `HTTPS_PROXY` этого агента;
- CA: если в kubeconfig CA не указан, kubectl на Windows доверяет системному
  хранилищу сертификатов, а Node по умолчанию — только встроенному набору
  Mozilla. Подмешать системные корни через `tls.getCACertificates("system")`
  (есть в Node 24.18), иначе кластер с публичным сертификатом за
  корпоративным TLS-прокси сломается у нас и не сломается в kubectl.

### 1C — ошибки в той же форме, что у kubectl

Окно различает ошибки по тексту: `isClusterUnavailableError` и
`isPermissionError` в `renderer/hooks/useResourceLoader.ts` ищут подстроки в
`rawStderr`. Клиент обязан бросать `KubectlError` с теми же `code` и текстом,
который их находит:

- HTTP-ответ со `Status` → `Error from server (<reason>): <message>`, код через
  существующий `classifyKubectlError`;
- 401 → `UNAUTHORIZED`, 403 → `FORBIDDEN`, 404 → `NOT_FOUND` (на нём держится
  откат raw → `kubectl get` в `listResource`);
- `ECONNREFUSED`, `EHOSTUNREACH`, `ENOTFOUND`, таймаут соединения → текст с
  `connection refused` / `no route to host` / `no such host` / `i/o timeout`;
- ошибки TLS → `TLS_ERROR` с `certificate ... unknown authority`.

`commandPreview` — `GET <server><path>` без заголовков; в лог бэкенда — строка
по образцу `node kubectl preview=...`: метод, путь, статус, байты, мс.
Контрактный тест: одна таблица «ситуация → code → что видит окно» для клиента
и для kubectl.

### 1D — подключение к спискам

В `listResource` (`routes/resourceLists.ts`) порядок становится:

1. профиль есть и настройка включена → `apiClient.getJson(rawPath)`;
2. иначе → `kubectl get --raw` (как сейчас);
3. `NOT_FOUND` на raw-пути → `kubectl get <resource> -o json` (как сейчас).

Discovery для CRD (`resources/customListPaths.ts`) идёт тем же транспортом.

Откат на kubectl — **только** когда профиль не построен или ошибка из
настройки клиента (не удалось прочитать файл сертификата, неподдерживаемый
прокси). Сетевые ошибки и ответы API-сервера отдаются как есть: повтор через
kubectl удвоил бы время до ошибки при упавшем VPN.

Настройка в панели настроек: «Читать списки напрямую через API», по умолчанию
включена. Это аварийный выключатель на случай кластера, который клиент
понимает не так, как kubectl.

Проверка приёмки на живых кластерах (лог бэкенда даёт время по каждому
запросу): `pods -A` на самом большом кластере, Argo CD Applications в `argocd`,
повторное открытие таблицы, обновление по событию watch. Цель — первый список
без запуска процесса, повторные — без нового TLS-рукопожатия.

### 1E — exec-плагины авторизации

- Запуск плагина по `exec` из kubeconfig: `command`, `args`, `env`,
  `apiVersion` (`client.authentication.k8s.io/v1` и `v1beta1`),
  `KUBERNETES_EXEC_INFO`, `provideClusterInfo`.
- Ответ `ExecCredential`: `token` или клиентский сертификат; кеш до
  `expirationTimestamp` минус запас; без срока — до первого 401.
- 401 → сбросить кеш, перезапустить плагин один раз, повторить запрос.
- Одновременные запросы ждут один запуск плагина (как `sharedDiscovery` в
  `resources/apiResourcesCache.ts`).
- `interactiveMode: Always` → профиль `null`, такие кластеры остаются на kubectl.

Это и есть главный выигрыш для кластеров с kubelogin: сейчас плагин
запускается внутри **каждого** kubectl.

---

## Фаза 2 — остальные чтения (2.30.x)

По одной секции, по убыванию частоты вызова:

1. `kubectl top pods/nodes` → `metrics.k8s.io` напрямую (`resources/metrics.ts`
   и фоновый `usageHistorySampler`, который сейчас запускает процесс по
   расписанию);
2. детали, YAML, связанные ресурсы, события (`routes/resourceDetails.ts`,
   `yaml.ts`, `relatedResources.ts`);
3. Overview, Problems, глобальный поиск (обходят кластер целиком);
4. discovery (`api-resources`) → `/api` и `/apis` с агрегированным discovery.

На kubectl остаются exec в под, терминал, логи с follow, port-forward, apply/
edit/delete — редкие операции, где запуск процесса незаметен.

## Фаза 3 — list+watch в бэкенде (2.31.0)

Сейчас watch — процесс `kubectl get ... --watch-only --output-watch-events`
(`routes/watch.ts`), событие сбрасывает кеш, окно перечитывает весь список.
Для Argo CD Applications, у которых статус меняется постоянно, это почти
непрерывное перечитывание.

Вместо этого — информер в бэкенде: список с `resourceVersion`, затем
`?watch=1&resourceVersion=...&allowWatchBookmarks=true` через клиент; объекты
в памяти бэкенда, изменения применяются по одному; `410 Gone` → перечитать
список. Окно получает по существующему WebSocket дельты
(добавлен / изменён / удалён, уже нормализованные строки), а не сигнал
«перечитай». `ResourceSnapshotCache` становится представлением информера.

## Фаза 4 — последний список сразу (2.31.x)

`useResourceLoader` сбрасывает строки при смене области. Когда у бэкенда есть
живой информер, его состояние отдаётся сразу, обновление идёт фоном — как в
Lens при возврате к уже открытому ресурсу.

## Риски

- **Расхождение с kubectl в разборе kubeconfig.** Граница «не умею → `null`»
  и аварийный выключатель в настройках; фикстуры из реальных kubeconfig
  (без секретов) в тестах.
- **Корпоративный прокси и CA на Windows.** См. 1B; проверить на рабочей
  машине до выпуска.
- **Память.** Ответ по-прежнему собирается целиком, как stdout kubectl
  сейчас; потоковый разбор — отдельно, если понадобится.
- **Секреты в логах.** Токены и сертификаты не попадают ни в `commandPreview`,
  ни в лог; `sanitizeKubectlText` применяется к телам ошибок так же, как к
  stderr.
