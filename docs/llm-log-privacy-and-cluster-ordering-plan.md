# LLM log privacy and cluster ordering

Статус: реализовано в KubeDeck 2.3.0.

## Security invariant

KubeDeck не получает и не передаёт Kubernetes log streams в LLM-контур. Это относится к текущим и предыдущим Pod logs, агрегированным Deployment logs и любым log tails независимо от размера контекста, модели или sanitizer.

Renderer формирует LLM-контекст только из identity, YAML, Describe, Events, status/conditions и Related Resources. Gateway отклоняет запросы с верхнеуровневыми полями `logs` или `previousLogs` ошибкой `400 LLM_LOG_CONTEXT_FORBIDDEN` до построения prompt и вызова provider. Содержимое запрещённых полей не записывается в response, gateway logs или audit.

Обычный просмотр Pod и Deployment logs внутри KubeDeck не изменён и не связан с LLM-анализом.

## Persistent cluster ordering

Пользователь может менять порядок кластеров drag-and-drop или кнопками вверх/вниз. Renderer отправляет полный массив cluster IDs в `PUT /clusters/order`; Gateway принимает только точную перестановку существующего списка, после чего `ConfigStore` атомарно сохраняет новый порядок в `AppConfig.clusters`.

Порядок переживает перезапуск, rename и open. Remove сохраняет взаимный порядок оставшихся элементов, import добавляет новый кластер в конец. Audit хранит только IDs, без kubeconfig paths.

## Verification

- renderer contract подтверждает отсутствие Kubernetes log API в LLM-потоке;
- LLM gateway contracts проверяют fail-closed rejection и отсутствие sentinel leakage;
- cluster contracts проверяют persistence, validation, rename/open/remove/import и audit redaction;
- полный `npm.cmd run verify` проходит с 11 renderer и 69 gateway tests.
