# KubeDeck 2.0.5 — Release Notes

Дата: 2026-07-10

## Статус

Стабильный релиз KubeDeck 2.0.5 фиксирует проверенный **Node-only** runtime baseline и включает UX-доработки, выполненные после первичной стабилизации 2.0.

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

## Изменения относительно 2.0 baseline

- версия повышена до `2.0.5`;
- Gateway tests закреплены с `--test-concurrency=1`;
- добавлен release contract;
- добавлен автоматический `verify:release`;
- добавлен полный ручной regression checklist;
- документация и имена portable/mac artifacts синхронизированы со стабильной версией;
- включены исправления pod terminal, тем, языков, фильтров, namespaces, колонок таблиц и общего стиля кнопок.

## Известные ограничения

- поддерживается Windows 10/11 x64;
- требуется системный `kubectl` или настроенный путь к нему;
- LLM требует внешний OpenAI-compatible endpoint;
- релиз предназначен для стабильной установки после regression pass.

## Артефакт

```text
apps\desktop\release\KubeDeck-Portable-2.0.5-x64.exe
```

## Критерии принятия

- все автоматические проверки проходят без fail/cancelled;
- portable запускается без Python;
- `Node 49 / Python 0`;
- пройден `REGRESSION_CHECKLIST_2.0.5.md`;
- в release отсутствуют Python runtime, backend executable и `kubectl.exe`.
