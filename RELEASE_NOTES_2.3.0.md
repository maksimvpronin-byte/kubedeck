# KubeDeck 2.3.0 — Release Notes

Дата подготовки: 2026-07-13

KubeDeck 2.3.0 усиливает границу безопасности LLM-интеграции и добавляет управляемый пользователем порядок кластеров. Runtime остаётся Node-only: все 50 backend-контрактов принадлежат Node.js, Python/FastAPI runtime и встроенный `kubectl` отсутствуют.

## Основные изменения

### Kubernetes-логи не передаются в LLM

- LLM-анализ больше не запрашивает текущие или предыдущие логи Pod и Deployment.
- Поля `logs` и `previousLogs` удалены из renderer/backend TypeScript-контрактов.
- `/llm/analyze-resource` и `/llm/preview-resource-prompt` отклоняют legacy-запросы с log-полями до построения prompt (`400 LLM_LOG_CONTEXT_FORBIDDEN`).
- Preview, provider payload, gateway logs и audit не получают содержимое Kubernetes-логов.
- Для диагностики остаются разрешены YAML, Describe, Events, status/conditions и Related Resources; перед отправкой они проходят sanitization и truncation.
- Обычная вкладка Logs внутри KubeDeck продолжает работать без изменений.

### Ручной порядок кластеров

- Кластеры можно переставлять drag-and-drop или доступными с клавиатуры кнопками вверх/вниз.
- Новый порядок оптимистично отображается в UI и атомарно сохраняется в `AppConfig.clusters`.
- Порядок сохраняется после перезапуска, rename и open; новый кластер добавляется в конец списка.
- Новый endpoint `PUT /clusters/order` принимает точную перестановку cluster IDs, отклоняет дубликаты, неизвестные и пропущенные ID и пишет безопасное audit-событие без kubeconfig paths.

## Проверка

Обязательный автоматический gate:

```powershell
npm.cmd run verify:release
npm.cmd run verify
```

Gate включает lint, format check, 11 renderer tests, TypeScript typecheck, production build и 69 gateway contract tests.

## Artifacts

- Windows x64: `apps\desktop\release\KubeDeck-Portable-2.3.0-x64.exe`;
- macOS arm64: `apps/desktop/release/KubeDeck-2.3.0-arm64.dmg` и `.zip`.
