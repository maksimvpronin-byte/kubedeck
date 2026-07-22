# KubeDeck 2.3.1 — Regression Checklist

Дата: 2026-07-14

## Automated gate

- [x] `npm run verify:release`.
- [x] `npm run lint` и format check.
- [x] `npm run test:renderer`; 12/12 tests.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway`; 69/69 tests.
- [x] Release contracts: Node 50 / Python 0.

## Namespace selector and theme

- [x] Длинные namespace-имена отображаются целиком в одну строку без обрезки.
- [x] Минимальная ширина меню равна ширине селектора, максимальная — ширине самого длинного namespace.
- [x] Полное имя дополнительно доступно через tooltip.
- [x] Тёмная тема использует обновлённую сине-графитовую палитру.

## LLM security boundary

- [x] Renderer не запрашивает Pod/Deployment logs при preview или анализе.
- [x] Актуальные LLM request types не содержат `logs` и `previousLogs`.
- [x] Legacy payload с log-полями отклоняется до вызова provider.
- [x] Sentinel из запрещённых полей отсутствует в prompt, HTTP response, gateway log и audit.
- [x] LLM prompt явно сообщает, что Kubernetes-логи недоступны по политике безопасности.
- [x] Обычные вкладки Pod/Deployment Logs продолжают использовать Kubernetes log API независимо от LLM.

## Cluster ordering

- [x] Drag-and-drop и кнопки вверх/вниз формируют одинаковый полный список cluster IDs.
- [x] Порядок сохраняется на диске и загружается новым экземпляром `ConfigStore`.
- [x] Rename/open сохраняют порядок; remove удаляет только выбранный элемент; import добавляет кластер в конец.
- [x] Дубликаты, неизвестные и пропущенные IDs отклоняются без частичной записи.
- [x] Audit `cluster.reorder` не содержит kubeconfig paths.
- [x] UI откатывает оптимистичный порядок при ошибке API и блокирует конфликтующие действия во время сохранения.

## Manual release smoke

- [ ] Проверить сортировку минимум трёх кластеров мышью и кнопками, затем перезапустить приложение.
- [ ] Проверить LLM preview/analyze через тестовый provider с сетевой фиксацией payload.
- [x] Windows portable x64 artifact собран и прошёл release payload validation.
- [ ] Запустить ручной UI smoke Windows portable x64.
- [x] macOS arm64 DMG/ZIP artifacts собраны и прошли release payload validation.

## Acceptance

- [x] Автоматические контракты KubeDeck `2.3.1` выполнены.
- [x] `KubeDeck-Portable-2.3.1-x64.exe` собран и автоматически проверен.
- [ ] Cross-platform packaged smoke должен быть отмечен после проверки соответствующих artifacts.
