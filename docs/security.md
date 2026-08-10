# KubeDeck Security Notes

Документ описывает актуальную модель безопасности Node-only runtime KubeDeck 2.x.

## Известные ограничения

- На системах без доступного keyring (типично для headless Linux без
  `gnome-keyring`/`kwallet`) Electron `safeStorage` недоступен. LLM API key в
  этом случае не шифруется: существующий plaintext-ключ остаётся на диске (но
  с правами `0600`), а сохранение нового ключа отклоняется с
  `SECRET_STORAGE_UNAVAILABLE`. UI показывает предупреждение через
  `secretStorageAvailable` в `GET /llm/status`.
- Release-сборки Windows и Linux не подписаны — решено не делать. macOS
  собирается unsigned по умолчанию; opt-in подпись и notarization готовы
  (см. `docs/macos-signing.md`), но не выполнялись — требуют Apple Developer
  Program membership.
- Linux собирается только как AppImage x64 (без `deb`/`rpm`/`arm64`), macOS —
  только arm64 (без Intel). Решено не делать.

## Trust boundaries

- Electron main process и встроенный Node Gateway считаются privileged runtime.
- Renderer не имеет Node integration и получает только ограниченный API через preload.
- Kubernetes clusters, kubeconfig, resource YAML, logs и ответы внешнего LLM считаются недоверенными данными.
- Локальный gateway доступен только через loopback, но loopback сам по себе не считается аутентификацией.

## Local gateway

- Gateway слушает случайный порт только на `127.0.0.1`.
- Для каждого запуска Electron генерирует случайный 256-bit session token.
- Все HTTP endpoints, кроме `GET /health`, требуют `X-KubeDeck-Token`.
- WebSocket endpoints требуют тот же token в query или header.
- Сравнение token выполняется через timing-safe comparison.
- HTTP и WebSocket проверяют Origin; разрешены production file origin и локальный Vite dev server.
- Gateway и все управляемые дочерние процессы закрываются при завершении приложения.

Session token не должен записываться в логи, audit, config или persistent storage.

## Electron and IPC

Текущий desktop runtime: Electron 43.1.0 с Chromium 150 и Node 24.18. Поддерживаемая ветка Electron используется вместе с `contextIsolation`, Chromium sandbox и отключённым `nodeIntegration`.

BrowserWindow использует `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` и preload bridge с фиксированным набором методов. Renderer navigation ограничена packaged `file:` document либо origin локального Vite dev server; создание новых окон запрещено.

IPC handlers обязаны валидировать enum-like arguments, Kubernetes identifiers, URLs и пути. Renderer не должен получать произвольный filesystem или process API.

Внешнее открытие допускается только для явно разрешённых локальных port-forward URLs; остальные URL отклоняются.

## Local data

- Импортированные kubeconfig копируются в app-data `kubeconfigs/`.
- Kubeconfig кластера редактируется из Settings через `GET`/`PUT /clusters/{cluster_id}/kubeconfig`. Запись разрешена только для копий внутри `kubeconfigs/`, выполняется атомарно (tmp + rename) с правами `0600`, ограничена 1 MiB и проходит проверку структуры kubeconfig до замены файла. Предыдущее содержимое сохраняется рядом как `<cluster-id>.yaml.bak` с теми же правами.
- Содержимое kubeconfig не попадает в audit (пишутся только `sizeBytes`, число clusters/contexts), в logs, в persisted UI state и в LLM-контекст. После успешной записи watch, port-forward, terminal и SSH сессии кластера останавливаются, а его кэши очищаются.
- Подтверждённые SSH host key fingerprints хранятся в `hostkeys.json` с правами `0600`.
- Config хранит пути и настройки, но не должен попадать в diagnostic clipboard целиком.
- Resource cache, decoded Secrets и session state не сохраняются на диск.
- Secret audit содержит только metadata и никогда не содержит decoded value.
- Временные terminal scripts удаляются по lifecycle и не должны содержать credentials.

Kubeconfig content, authorization headers, LLM API keys, Secret values и session token запрещено логировать.

## LLM API key storage

- LLM API key хранится не в `config.json`, а зашифрованным через Electron
  `safeStorage` в `<appDataRoot>/secrets/llm-api-key.bin`; каталог `secrets/`
  имеет права `0700`, файл — `0600` (POSIX).
- `config.json` хранит только `llm.apiKeyConfigured: boolean` — признак того,
  что ключ сохранён, без самого значения.
- Расшифрованное значение существует только в памяти процесса на время
  исходящего запроса к LLM endpoint (`chatCompletion`) и никогда не
  записывается на диск и не логируется.
- При первом запуске после обновления one-shot миграция
  (`migratePlaintextLlmSecret`) переносит уже сохранённый plaintext-ключ из
  `config.json`, `config.backup.json`, `config.broken.json` и оставшихся
  temp-файлов в encrypted storage и вычищает эти файлы. Если encrypted storage
  недоступен, миграция не расшифровывает и не удаляет ключ, но ужесточает права
  файла до `0600`.
- `PUT /settings` принимает отдельное поле `apiKeyUpdate`
  (`keep`/`replace`/`clear`) — само значение никогда не попадает в
  `AppConfig`/`Settings`, которые возвращаются клиенту.
- `POST /llm/test` поддерживает тот же `apiKeyUpdate`, что позволяет проверить
  ещё не сохранённый ключ, не записывая его на диск.

## Redaction

Desktop/backend logging и command preview маскируют строки с распространёнными sensitive markers: token, password, Secret, authorization, API key, private key и certificate data.

Redaction является дополнительной защитой, а не разрешением логировать произвольные payload. Routes для YAML, Secrets, terminal, SSH и LLM должны логировать только безопасные metadata.

## Kubernetes commands

- `kubectl` запускается без shell с массивом аргументов.
- Resource names, namespaces, container names и actions валидируются.
- YAML передаётся только через stdin и ограничивается одним объектом на запрос.
- Команды имеют timeout и output limits.
- Mutating operations используют confirmation metadata, audit и `kubectl auth can-i`, где это предусмотрено контрактом.
- Cache инвалидируется после успешных mutations.

Command preview не должен раскрывать kubeconfig path или credentials.

## SSH host keys

Node SSH проверяет host key целевого хоста и jump host. Проверка выполняется в
`hostVerifier` во время key exchange, то есть **до** user authentication:
пароль, passphrase и подпись агента не покидают процесс, пока ключ не принят.

Модель доверия — TOFU с явным подтверждением:

- известный и совпавший fingerprint — подключение без вопросов;
- неизвестный хост — сессия останавливается, renderer получает
  `host-key-request` с host, port, алгоритмом и SHA256-fingerprint и ждёт
  `host-key-decision`; отказ, закрытие сокета и таймаут 120 секунд завершают
  попытку;
- изменившийся ключ отклоняется безусловно, диалог подтверждения в этом случае
  не показывается; снять доверие можно только явным удалением записи в Settings.

Jump host и target проверяются независимо: доверие к одному не распространяется
на другой.

Подтверждённые fingerprint хранятся в `hostkeys.json` внутри app-data. Файл
пишется атомарно (временный файл и `rename`) с правами `0600` в каталоге `0700`.
Повреждённый или отсутствующий store считается пустым: все хосты снова требуют
подтверждения и ни один не получает доверие молча.

Fingerprint публичного ключа не является секретом — это именно то значение,
которое пользователь сверяет с `ssh-keyscan`, — поэтому он попадает в audit
вместе с host, port и алгоритмом. Пароли, passphrase и содержимое приватных
ключей в audit и логи по-прежнему не записываются.

HTTP-контракт управления доверием намеренно неполный: `GET /ssh/known-hosts`
перечисляет записи, `DELETE /ssh/known-hosts` удаляет одну. Маршрута, который
добавляет host key, не существует — доверие выдаётся только через подтверждение
в интерактивной сессии.

## Long-running sessions

Watch, Pod Terminal, Node SSH и Port Forward имеют явного владельца lifecycle:

- session привязана к cluster и локальному gateway;
- нижняя terminal workspace сохраняет только identity и высоту панели; SSH password и passphrase существуют только в памяти смонтированной renderer-сессии;
- переключение terminal workspace не закрывает WebSocket, а явное закрытие вкладки завершает соответствующую session;
- процессы останавливаются при закрытии приложения или удалении cluster;
- unmanaged external port-forward не останавливаются KubeDeck;
- managed process проверяется до принудительной остановки;
- terminal/SSH WebSocket требует token и разрешённый Origin.

## LLM boundary

- LLM endpoint настраивается пользователем и является внешней системой.
- KubeDeck не запрашивает и не отправляет в LLM текущие, previous или агрегированные Kubernetes log streams.
- Renderer не добавляет логи в LLM-запрос, а gateway отклоняет legacy-поля `logs` и `previousLogs` до построения prompt.
- Перед отправкой оставшийся разрешённый resource context проходит sanitizer; sanitizer не заменяет запрет передачи логов.
- Secret values, credentials и чувствительные structured fields должны удаляться.
- API key не возвращается публичными status/config responses и не попадает в audit/logs; `GET /llm/status` возвращает только `secretStorageAvailable`.
- Ошибка внешнего LLM не должна включать исходный request payload в log.

## Packaging invariants

Release gate должен подтверждать отсутствие Python/FastAPI runtime, legacy backend executable, встроенного `kubectl`, kubeconfig, config и локальных logs в payload, а также прохождение Node-only и release contract tests.

Unsigned macOS build требует явного пользовательского обхода Gatekeeper и не предоставляет гарантий code signing/notarization.
