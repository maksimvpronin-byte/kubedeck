# KubeDeck Security Notes

Документ описывает актуальную модель безопасности Node-only runtime KubeDeck 2.x.

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
- Config хранит пути и настройки, но не должен попадать в diagnostic clipboard целиком.
- Resource cache, decoded Secrets и session state не сохраняются на диск.
- Secret audit содержит только metadata и никогда не содержит decoded value.
- Временные terminal scripts удаляются по lifecycle и не должны содержать credentials.

Kubeconfig content, authorization headers, LLM API keys, Secret values и session token запрещено логировать.

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

## Long-running sessions

Watch, Pod Terminal, Node SSH и Port Forward имеют явного владельца lifecycle:

- session привязана к cluster и локальному gateway;
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
- API key не возвращается публичными status/config responses и не попадает в audit/logs.
- Ошибка внешнего LLM не должна включать исходный request payload в log.

## Packaging invariants

Release gate должен подтверждать отсутствие Python/FastAPI runtime, legacy backend executable, встроенного `kubectl`, kubeconfig, config и локальных logs в payload, а также прохождение Node-only и release contract tests.

Unsigned macOS build требует явного пользовательского обхода Gatekeeper и не предоставляет гарантий code signing/notarization.
