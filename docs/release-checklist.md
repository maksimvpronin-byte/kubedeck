# KubeDeck release checklist

Этот checklist описывает актуальный Node-only release workflow. Целевая версия берётся из root и desktop package metadata; документ не фиксирует конкретный patch номер.

## Перед сборкой

1. Убедиться, что версии синхронизированы в `package.json`, `apps/desktop/package.json`, `package-lock.json`, README, Help/About, changelog и release metadata.
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

Не выполнять dependency upgrades, `npm audit fix` или lockfile refresh как побочный эффект релиза.

## Release payload

Проверить, что сборка:

- не содержит Python runtime, FastAPI/PyInstaller backend или legacy executable;
- не содержит встроенный `kubectl`;
- не содержит local config, kubeconfig, logs или credentials;
- содержит корректно собранный `node-pty` для целевой платформы;
- запускает только Electron/Node-owned runtime.

## Smoke test

1. Запустить packaged приложение и проверить `/health` и `/migration/status` (`node-only`, `49 Node / 0 Python`).
2. Импортировать или открыть kubeconfig-backed cluster.
3. Проверить namespace selector, resource list, refresh, cache и watch-driven update.
4. Открыть resource drawer: Summary, YAML, Describe, Events, Related и Logs.
5. Проверить Global Search и Problems.
6. Проверить YAML dry-run/apply и отказ для multi-document payload.
7. Проверить delete/restart/redeploy/scale и RBAC-denied paths.
8. Проверить Secret reveal/copy/auto-hide и отсутствие value в audit/logs.
9. Проверить Pod Terminal: input, paste, navigation keys, resize и reconnect.
10. Проверить Node SSH, включая password/key/jump-host paths, если доступны.
11. Проверить Port Forward start/open/stop и cleanup при выходе.
12. Проверить dark/light/system theme и ru/en/system language.
13. Проверить About diagnostics: они не должны включать kubeconfig content или Secret values.

## После проверки

- заполнить release-specific regression checklist;
- добавить release notes и changelog entry;
- зафиксировать platform/architecture и имена artifacts;
- отметить результаты typecheck, build, tests, packaging и manual smoke;
- commit/tag выполняются только после успешного release gate.
