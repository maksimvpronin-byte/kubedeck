# KubeDeck release checklist

Этот checklist описывает актуальный Node-only release workflow. Целевая версия берётся из root и desktop package metadata; документ не фиксирует конкретный patch номер.

## Перед сборкой

1. Убедиться, что версии синхронизированы в `package.json`, `apps/desktop/package.json`, `packages/shared-types/package.json`, `package-lock.json`, README, changelog и release metadata, а Help/About получает версию динамически из Electron.
2. Проверить чистоту release branch и отсутствие случайных local artifacts.
3. Выполнить автоматические проверки:

```bash
npm run typecheck
npm run build
npm run test:renderer
npm --workspace apps/desktop run test:gateway
```

На Windows дополнительно:

```powershell
npm.cmd run verify:node-only
npm.cmd run verify:release
npm.cmd run package:win
```

На macOS:

```bash
npm run package:mac
```

По умолчанию сборка не подписана. Для подписи и notarization см.
[docs/macos-signing.md](./macos-signing.md) — это опциональный шаг, требующий
собственного Apple Developer Program membership.

Не выполнять dependency upgrades, `npm audit fix` или lockfile refresh как побочный эффект релиза.

## Release payload

Проверить, что сборка:

- не содержит Python runtime, FastAPI/PyInstaller backend или legacy executable;
- не содержит встроенный `kubectl`;
- не содержит local config, kubeconfig, logs или credentials;
- содержит корректно собранный `node-pty` для целевой платформы;
- запускает только Electron/Node-owned runtime.

## Автоматический прогон против живого кластера

До ручного smoke стоит прогнать `npm run smoke:cluster` — он поднимает собранный
gateway против настоящего кластера и проверяет маршруты, которые обслуживают
таблицы, панели, поиск, drawer и watch, печатая при этом реальные тайминги (а не
цифры с фикстур):

```bash
KUBEDECK_SMOKE_KUBECONFIG=~/.kube/config npm run smoke:cluster
```

Только чтение: GET-маршруты, открытие кластера (`cluster-info` плюс список
namespace) и один watch, который тут же останавливается. Ничего не применяется,
не удаляется и не масштабируется, а kubeconfig копируется во временный app-data,
который удаляется в конце. Без `KUBEDECK_SMOKE_KUBECONFIG` скрипт объясняет себя
и выходит с нулём, поэтому в CI он не запускается.

Переменные: `KUBEDECK_SMOKE_KUBECTL` (путь к kubectl), `KUBEDECK_SMOKE_NAMESPACE`
(по умолчанию `all`), `KUBEDECK_SMOKE_REPORT` (записать таблицу таймингов в файл
— удобно прикладывать к release notes).

Прогон не заменяет ручной smoke ниже: он не открывает окно, не проверяет
терминал, SSH и port-forward и ничего не мутирует.

## Smoke test

1. Запустить packaged приложение и проверить `/health` и `/migration/status` (`node-only`, `57 Node / 0 Python`).
2. Импортировать или открыть kubeconfig-backed cluster.
3. Проверить namespace selector, resource list, refresh, cache и watch-driven update.
4. Открыть resource drawer: Summary, YAML, Describe, Events, Related и Logs.
5. Проверить Global Search и Problems.
6. Проверить YAML dry-run/apply и отказ для multi-document payload.
7. Проверить delete/restart/redeploy/scale и RBAC-denied paths.
8. Проверить Secret reveal/copy/auto-hide и отсутствие value в audit/logs.
9. Открыть Pod Terminal в нижней workspace: проверить input, paste, navigation keys, reconnect, переключение и явное закрытие.
10. Открыть Node SSH в той же workspace: проверить persistence при навигации, password/key/jump-host paths и отсутствие credentials в persisted UI state.
11. Изменить высоту workspace мышью и клавиатурой, свернуть/развернуть панель, перезапустить UI и проверить восстановление допустимой высоты.
12. Проверить Port Forward start/open/stop и cleanup при выходе.
13. Проверить dark/light/system theme и ru/en/system language.
14. Проверить Help/About: версия совпадает с packaged app, описание terminal workspace актуально, diagnostics не включают kubeconfig content или Secret values.
15. Windows: проверить иконку KubeDeck у окна, в панели задач и Alt+Tab, а также ProductName/версию в свойствах распакованного `KubeDeck.exe`.

## После проверки

- заполнить release-specific regression checklist;
- добавить release notes и changelog entry;
- зафиксировать platform/architecture и имена artifacts;
- отметить результаты typecheck, build, tests, packaging и manual smoke;
- commit/tag выполняются только после успешного release gate.
