# KubeDeck 2.10.0 — лицензия, проверка SSH host key и сборка для Linux

Статус: реализовано. Автоматические проверки, доступные вне целевых платформ,
пройдены; ручной smoke на Ubuntu LTS и packaged-сборки трёх платформ ожидаются.

## Цель

Закрыть три независимых замечания, каждое из которых сейчас блокирует
распространение продукта:

- **A** — репозиторий не имеет лицензии, поэтому им юридически нельзя
  пользоваться;
- **B** — Node SSH подключается без проверки host key, поэтому пароль может
  быть отправлен подменённому хосту;
- **C** — нет сборки для Linux, то есть для основной платформы SRE.

Секции независимы и выполняются по одной. Порядок A → B → C выбран по
возрастанию риска: A не трогает код, B меняет протокол SSH-сессии, C меняет
packaging.

## Правила безопасного выполнения

- Выполнять секции по одной, следующую начинать после прохождения gate
  предыдущей.
- Сначала добавлять проверку, которая падает на текущем коде.
- Не смешивать секции в один коммит; каждая должна ревьюиться отдельно.
- Не добавлять зависимости: существующих Node, Electron, React, `ssh2` и
  встроенного test runner достаточно.
- Не менять публичные HTTP-контракты без отдельной необходимости.
- После каждой секции запускать полный gate и `git diff --check`.

## Шаг 0 — найти потерянную работу

Перед секцией B обязательно. В `apps/desktop/dist/` лежат скомпилированные
модули, которых **нет ни в `src/`, ни в git** (`git status` чист, `dist/`
в `.gitignore`):

| Файл в `dist` | Что это | Есть в `src` |
|---|---|---|
| `main/backend/ssh/sshHostKeyStore.js` | готовый store host keys | нет |
| `main/backend/security/secretStore.js` | интерфейс secret store | нет |
| `main/backend/security/memorySecretStore.js` | in-memory реализация | нет |
| `main/backend/security/migrateSecrets.js` | миграция plaintext LLM key | нет |
| `main/security/electronSafeStorageSecretStore.js` | `safeStorage` реализация | нет |

Это означает, что часть работы уже была написана и собрана, но не
закоммичена или потеряна при переключении веток.

- [x] Проверить `git stash list`, `git fsck --lost-found`, локальные ветки и
  другие рабочие машины.
- [x] Если ветка находится — использовать её как основу, а не писать заново.
- [x] Модули `security/*` (шифрование LLM API key) в этот патч **не** брать —
  см. «Не входит в патч».

### Результат шага 0

Работа найдена: `git stash` и локальные ветки пусты, но `git fsck --lost-found`
дал dangling tree `6205ca1`, содержащий полное дерево исходников. Коммита у него
никогда не было, поэтому `git gc` удалил бы её безвозвратно.

Дерево сохранено в ветку **`recovered/2.10.0-diagnostics-wip`** (коммит
`6f430c7`, родитель — `c1aeffb`).

Содержимое: 52 файла, +3372 строки — **другой** 2.10.0 под названием
«Diagnostics Workspace & Secure LLM Pipeline», с собственным планом на 1571
строку. В него входят Diagnostics Workspace, `kube-doctor.sh`, NDJSON-парсер,
санитизация LLM-контекста, `SecretStore` на Electron `safeStorage` и
`SshHostKeyStore`.

Важно для секции B: `hostVerifier` в этой ветке подключён **только** к
`diagnostics/diagnosticRunner.ts`. В `ssh/nodeSshWebSocket.ts` его нет, то есть
интерактивный Node SSH оставался непроверенным и там. Из ветки взят и приведён к
стилю проекта только `sshHostKeyStore.ts`; всё остальное реализовано заново.

Ветка `recovered/2.10.0-diagnostics-wip` не сливалась и остаётся основой для
отдельного релиза 2.11.0.

Не удалять `apps/desktop/dist/` до завершения шага 0.

## Секция A — лицензия Apache-2.0

### Подтверждённая причина

В корне нет файла `LICENSE`, README не содержит секции о лицензии, ни один из
трёх `package.json` не объявляет поле `license`. Публичный репозиторий без
лицензии по умолчанию означает «все права защищены»: любой, кто склонирует
KubeDeck, формально нарушает авторское право. Для цели «набрать пользователей
и репутацию» это прямой блокер — часть компаний просто не разрешает своим
сотрудникам ставить софт без явной лицензии.

Выбрана **Apache-2.0**: она даёт явный патентный грант, отдельно защищает имя
и товарные знаки (§6), не мешает выпустить платные функции поверх открытого
ядра позже и является стандартом в CNCF-экосистеме, где живут Kubernetes и
Headlamp.

### Задачи

- [x] Добавить `LICENSE` — полный неизменённый текст Apache License 2.0.
- [x] Добавить `NOTICE` с правообладателем и годом.
- [x] Явно зафиксировать в `NOTICE`, что имя **KubeDeck** и иконка лицензией не
  передаются: Apache-2.0 §6 не даёт прав на товарные знаки, и это единственная
  защита от форка под тем же именем.
- [x] Добавить `"license": "Apache-2.0"` в `package.json`,
  `apps/desktop/package.json`, `packages/shared-types/package.json`.
- [x] Добавить секцию License в `README.md` и `README.ru.md`.
- [x] Создать `docs/third-party-notices.md` со списком production-зависимостей
  и их лицензий. Проверить фактически по `node_modules`, а не по памяти:
  `node-pty`, `ssh2`, `ws`, `yaml`, `diff`, Electron, React, React DOM,
  `@xterm/xterm`, `lucide-react`.
- [x] Не добавлять лицензионные заголовки в каждый исходный файл: Apache-2.0
  этого не требует, а diff затронет все 28 тысяч строк и обесценит ревью.

### Контракты

- [x] `LICENSE` существует и начинается со строки `Apache License`.
- [x] `NOTICE` существует и содержит год и правообладателя.
- [x] Все три `package.json` объявляют `Apache-2.0`.
- [x] `docs/third-party-notices.md` перечисляет каждую production-зависимость
  из `apps/desktop/package.json`.

Проверку добавить в `scripts/verify-release.cjs` рядом с существующими
document-инвариантами и внести файлы в `requiredDocuments`
`release-contract.json`.

## Секция B — проверка SSH host key

### Подтверждённая причина

- `apps/desktop/src/main/backend/ssh/nodeSshWebSocket.ts`, функция
  `connectConfig()` собирает `ConnectConfig` из host, port, username,
  `readyTimeout` и данных выбранного метода аутентификации.
- Ни `hostVerifier`, ни `hostHash` в конфигурацию не передаются:
  `grep -rn "hostVerifier" apps/desktop/src apps/desktop/tests` не даёт
  результатов.
- `ssh2` без `hostVerifier` принимает **любой** предъявленный host key. KubeDeck
  не отличает настоящую ноду от MITM и передаёт ему пароль либо passphrase от
  приватного ключа.
- Та же функция используется для jump host (`connectClient(connectConfig(
  payload.jump, ...))`), поэтому непроверенными остаются оба звена цепочки.
- `docs/security.md` подробно описывает session token, Origin, sandbox,
  redaction и lifecycle, но host key verification не упоминает вообще. Это
  пробел в модели безопасности, а не осознанный компромисс.

### Модель поведения

Выбран **TOFU с явным подтверждением**, как в OpenSSH:

1. Первое подключение к паре `host:port` — gateway считает SHA256-fingerprint
   предъявленного ключа и запрашивает решение пользователя.
2. Renderer показывает `host:port`, алгоритм ключа и `SHA256:...`; доступны
   «Подключиться и запомнить» и «Отмена».
3. При подтверждении fingerprint сохраняется в `hostkeys.json`.
4. Известный и совпавший ключ — подключение без диалога.
5. **Несовпадение ключа — безусловный отказ.** Кнопки «всё равно подключиться»
   в этом диалоге нет. Снять доверие можно только явным удалением записи в
   Settings.

Ключевое требование корректности: `hostVerifier` в `ssh2` вызывается на этапе
handshake **до** аутентификации. Значит при неизвестном или изменившемся ключе
пароль и passphrase не должны покидать процесс. Это отдельный тест, а не
предположение.

### Задачи

- [x] Восстановить `apps/desktop/src/main/backend/ssh/sshHostKeyStore.ts`:
  `sshSha256Fingerprint()`, `canonicalSshHost()`, `lookup()`, `remember()`,
  формат `{ version: 1, hosts: {} }`.
- [x] Хранилище — `<appDataRoot>/hostkeys.json`: каталог `0700`, файл `0600`,
  atomic write через временный файл и `rename`, `chmod` на POSIX.
- [x] Передавать `hostVerifier` в `connectConfig()` для target и для jump.
- [x] `hostVerifier` асинхронный; при отсутствии решения пользователя дольше
  120 секунд — отказ и закрытие соединения.
- [x] Ввести коды ошибок `SSH_HOST_KEY_UNKNOWN`, `SSH_HOST_KEY_MISMATCH`,
  `SSH_HOST_KEY_TIMEOUT`, `SSH_HOST_KEY_REJECTED` рядом с существующими
  SSH-ошибками.
- [x] Расширить WebSocket-протокол Node SSH двумя сообщениями:
  server→client `host-key-request`, client→server `host-key-decision`.
  Существующие типы сообщений не менять и не переупорядочивать.
- [x] Renderer: диалог подтверждения в `NodeSshTab`, строки в `en.json` и
  `ru.json`. Fingerprint показывать моноширинным шрифтом целиком, без
  сокращения.
- [x] Settings: список запомненных host keys с host, port, алгоритмом, датой и
  удалением по одному.
- [x] Audit: фиксировать доверие и mismatch как metadata (host, port,
  алгоритм, fingerprint). Fingerprint публичен и секретом не является.
- [x] `docs/security.md`: новый раздел «SSH host keys», правки разделов
  «Long-running sessions» и «Local data».

### Контракты gateway

- [x] Неизвестный хост: сессия не отправляет пароль и passphrase до решения
  пользователя.
- [x] Подтверждение записывает в store корректный SHA256 и создаёт файл с
  правами `0600` на POSIX.
- [x] Повторное подключение к запомненному хосту проходит без запроса.
- [x] Изменившийся ключ отклоняется, store не перезаписывается.
- [x] Явный отказ пользователя и таймаут закрывают соединение и уничтожают
  клиент без утечки сессии.
- [x] Jump host проверяется отдельно от target; доверие к одному не
  распространяется на другой.
- [x] `canonicalSshHost` нечувствителен к регистру, учитывает порт и
  нормализует IPv6 в скобках.
- [x] Пароль, passphrase и содержимое ключа не попадают в лог и audit ни при
  одной из четырёх новых ошибок.

### Контракты renderer

- [x] Диалог показывает host, port, алгоритм и полный fingerprint.
- [x] При mismatch кнопка доверия отсутствует.
- [x] Строки присутствуют в обоих языках.
- [x] Существующие Pod Terminal и SSH-вкладки Terminal Workspace не меняют
  поведения при навигации.

## Секция C — сборка Linux AppImage x64

### Подтверждённая причина

- `apps/desktop/electron-builder.yml` содержит только секции `win` и `mac`.
- `scripts/verify-release.cjs` знает artifacts `windows` и `mac`; для Linux
  проверок payload нет.
- В `apps/desktop/assets/` есть только `icon.ico`, `icon.icns` и исходный
  `icon.png` на 1.6 МБ — иконки нужного для Linux размера нет.
- README объявляет Linux как `Not supported yet`.
- `node-pty` — нативная зависимость и требует prebuild под linux-x64.

Выбран **AppImage x64**: один самодостаточный файл без установки, прямой
аналог уже существующей Windows Portable-сборки. `deb`, `rpm` и `arm64` в этот
релиз не входят.

### Задачи

- [x] Добавить секцию `linux` в `electron-builder.yml`: target `AppImage`,
  arch `x64`, `category: Development`, иконка из PNG.
- [x] Добавить `assets/icon-512.png` (ровно 512×512). Текущий исходник на
  1.6 МБ для этого не подходит.
- [x] Проверить фактическое имя артефакта: electron-builder подставляет для
  AppImage `x86_64`, а не `x64`. В тест записывать **реально полученное** имя,
  а не ожидаемое.
- [x] Добавить `dist:linux` в `apps/desktop/package.json` и `package:linux` в
  корневой `package.json`.
- [x] Добавить `scripts/build-linux.sh` по образцу `scripts/build-macos.sh`.
- [x] Исправить `apps/desktop/scripts/electron-after-pack.cjs`: сейчас он
  безусловно строит путь через `${productFilename}.app`, что осмысленно только
  для macOS. На Linux он не падает, но выполняет бессмысленную работу. Добавить
  явную проверку `context.electronPlatformName === "darwin"`.
- [x] `scripts/verify-release.cjs`: artifact `linux` — наличие AppImage,
  отсутствие Python-runtime и встроенного `kubectl`, наличие prebuild
  `node-pty` под linux-x64 в `app.asar.unpacked`.
- [x] Проверить `appDataRoot` на Linux: Electron даёт `~/.config/KubeDeck`,
  fallback `~/.kubedeck` не должен ломаться.
- [x] Проверить поиск `kubectl` в `PATH` и приём абсолютного пути в Settings.
- [x] **Sandbox:** Electron под Linux в AppImage может потребовать SUID-sandbox
  или `--no-sandbox`. Проверить, что окно стартует с **включённым** sandbox.
  Если нет — задокументировать ограничение, но sandbox не отключать: это
  прямое нарушение инварианта `docs/security.md`.
- [x] README.md и README.ru.md: перевести Linux в поддерживаемые платформы,
  указать требования (x64, glibc, FUSE 2 для AppImage, системный `kubectl`).
- [x] CI: добавить job сборки AppImage на `ubuntu-latest` — сборка без
  публикации, чтобы Linux не ломался незаметно.

### Обязательный ручной smoke на Linux

Минимум один Ubuntu LTS:

1. AppImage запускается двойным кликом и из терминала.
2. Импорт kubeconfig, список ресурсов, namespace selector, watch.
3. Pod Terminal — проверка `node-pty` под Linux: ввод, paste, навигационные
   клавиши, reconnect.
4. Node SSH — включая новый диалог host key из секции B.
5. Port Forward: start, open, stop и cleanup при выходе.
6. Темы, язык, Help показывает версию 2.10.0.
7. Права `~/.config/KubeDeck` и `hostkeys.json`.

## Открытый вопрос для этапа реализации

`release-contract.json` фиксирует `nodeRoutes: 52`. Если управление
запомненными host keys получит собственные HTTP-маршруты, это число нужно
поднять. Если управление пойдёт через существующий settings-роут и WebSocket
Node SSH — число остаётся прежним. Решение принять при реализации секции B и
отразить в контракте и в `/migration/status`.

## Автоматический gate

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `git diff --check`

## Release sync 2.10.0

- [x] поднять root, desktop, shared-types и lock metadata до `2.10.0`;
- [x] обновить Help, README.md, README.ru.md, CHANGELOG.md и migration status;
- [x] создать `docs/releases/RELEASE_NOTES_2.10.0.md` и
  `docs/releases/REGRESSION_CHECKLIST_2.10.0.md`;
- [x] обновить таблицу поддерживаемых платформ в обоих README;
- [x] собрать и сверить версии трёх артефактов: Windows Portable x64,
  macOS arm64 DMG/ZIP, Linux AppImage x64.

Минорная версия, а не патч: добавляется платформа, меняется протокол
Node SSH-сессии и появляется новый пользовательский диалог.

## Не входит в патч

- Linux `deb`, `rpm` и `arm64` — отдельный релиз.
- Подпись и нотаризация macOS.
- Шифрование LLM API key через Electron `safeStorage`. Восстановленные из
  `dist` модули `security/*` относятся к отдельной задаче; смешивать их с
  SSH-патчем нельзя. Зафиксировать как долг на 2.10.1 — сейчас ключ лежит в
  `config.json` открытым текстом и без ограничения прав файла.
- Чтение системного `~/.ssh/known_hosts`.
- SSH-агент, форвардинг агента и новые методы аутентификации.
- Изменение архитектуры хранения config.
- Рефакторинг `App.tsx` и расширение `format:check` на директории — оба нужны,
  но это отдельный chore-патч.

## Критерий завершения

Репозиторий содержит `LICENSE` Apache-2.0, `NOTICE` с оговоркой о товарном
знаке и перечень лицензий зависимостей; все три `package.json` объявляют
лицензию. Node SSH не подключается к хосту с неизвестным ключом без явного
подтверждения пользователя, безусловно отклоняет изменившийся ключ, хранит
доверенные fingerprint в файле с правами `0600` и позволяет отозвать доверие
в Settings; ни в одном из этих сценариев credentials не покидают процесс и не
попадают в логи. AppImage x64 собирается воспроизводимо, проходит release
gate и ручной smoke на Ubuntu LTS с включённым sandbox. Автоматический gate
пройден полностью, документация и артефакты имеют версию 2.10.0.
