# KubeDeck 2.0.0-beta.1 — Release Notes

Дата: 2026-06-22

## Статус

Первая beta-версия KubeDeck 2.0 фиксирует проверенный **Node-only** runtime baseline.

- Backend contracts: **49 Node / 0 Python**.
- Runtime: Node.js внутри Electron main process.
- Python/FastAPI child process: удалён.
- PyInstaller packaging: удалён.
- Встроенный `kubectl.exe`: отсутствует.

## Что вошло в KubeDeck 2.0

- Node Gateway для REST и WebSocket контрактов;
- системный kubectl runtime с timeout и output limits;
- Resource Snapshot Cache и live Resource Watch;
- resource details, events, YAML dry-run/apply и Secrets;
- delete/restart/redeploy/scale и Node operations;
- Pod Exec, Pod Terminal, Node SSH и Port Forward;
- Deployment logs;
- Problems Engine;
- Global Search;
- Related Resources;
- OpenAI-compatible LLM status/test/preview/analyze;
- Node-only build, verification и portable packaging.

## Изменения относительно Alpha 15

Новая пользовательская функциональность не добавляется.

- версия повышена до `2.0.0-beta.1`;
- Gateway tests закреплены с `--test-concurrency=1`;
- добавлен beta release contract;
- добавлен автоматический `verify:beta1`;
- добавлен полный ручной regression checklist;
- документация и имя portable синхронизированы с Beta 1.

## Известные ограничения

- поддерживается Windows 10/11 x64;
- требуется системный `kubectl` или настроенный путь к нему;
- LLM требует внешний OpenAI-compatible endpoint;
- beta предназначена для расширенного regression test перед RC.

## Артефакт

```text
apps\desktop\release\KubeDeck-Portable-2.0.0-beta.1-x64.exe
```

## Критерии принятия

- все автоматические проверки проходят без fail/cancelled;
- portable запускается без Python;
- `Node 49 / Python 0`;
- пройден `BETA_REGRESSION_CHECKLIST.md`;
- в release отсутствуют Python runtime, backend executable и `kubectl.exe`.
