# KubeDeck 2.4.2 — Bulk Delete Feedback Cleanup Plan

Статус: реализация и автоматическая проверка завершены; ручной UI/Windows smoke отложен.

## Цель

Убрать после группового удаления ресурсов большую зелёную панель вида `Bulk delete completed. Deleted: N.`. Успешный результат уже понятен по исчезновению строк из таблицы, поэтому отдельное постоянное окно и кнопка `Close` не нужны.

Версия патча: `2.4.2`.

## Подтверждённый источник

`useBulkResourceActions` записывает bulk-delete состояния `requested`, `partial result` и `completed` в общий `message`. `App.tsx` показывает любое такое сообщение как `.action-status-panel` над таблицей.

Этот же `message` используется для операций с нодами. Поэтому нельзя просто удалить весь `action-status-panel`: необходимо отделить feedback bulk delete от node actions и сохранить полезные сообщения Drain/Cordon/Uncordon.

## UX-контракт 2.4.2

### Успешное bulk delete

- confirmation modal закрывается сразу после подтверждения;
- выбранные строки переходят в существующее состояние `Terminating`;
- после reload удалённые строки исчезают;
- панель `Bulk delete requested/completed` не создаётся;
- кнопка `Close` после успешного удаления не появляется;
- глобальная success-toast система ради этого патча не добавляется.

### Частичный или полный failure

- зелёная completion/status-панель не показывается;
- подробный результат остаётся в существующем ErrorPanel;
- ErrorPanel содержит количество удалённых и неудачных ресурсов;
- failed resources перечисляются без утечки Secret data;
- строки, которые удалить не удалось, возвращаются из `Terminating` в актуальное состояние после reload;
- Copy в ErrorPanel продолжает копировать диагностические сведения.

### Node actions

- Drain, Cordon и Uncordon продолжают показывать существующий action status;
- их кнопка `Close` и обработчик очистки не удаляются;
- ошибки node actions по-прежнему используют ErrorPanel.

## Границы патча

Входит:

- удаление status-панели только из bulk-delete потока;
- разделение bulk-delete и node-action message state;
- устранение дублирования partial failure между status-панелью и ErrorPanel;
- обязательный refresh строк после завершения попыток удаления;
- удаление неиспользуемых bulk-delete result CSS и переводов после проверки usages;
- renderer contracts, версия и release-документы `2.4.2`.

Не входит:

- изменение confirmation modal перед удалением;
- изменение Kubernetes delete API или Gateway;
- отмена состояния `Terminating`;
- добавление toast framework;
- изменение одиночного Delete в resource drawer;
- переработка node-action feedback.

## 1. Зафиксировать baseline

- [x] Начать от принятого `main` версии 2.4.1.
- [x] Запустить renderer tests, typecheck и build до изменений — 20/20 renderer tests.
- [x] Подтвердить успешный bulk delete, partial failure и полный failure по текущему коду/контрактам.
- [x] Составить список всех producers и consumers общего `message`.

## 2. Отделить node-action status

- [x] Переименовать общий `message` в явно ограниченный `nodeActionMessage`.
- [x] Оставить запись status только в `confirmNodeAction`.
- [x] Сохранить `clearNodeActionMessage` для кнопки `Close`.
- [x] Обновить `App.tsx`, чтобы `.action-status-panel` отображал только node-action feedback.
- [x] Не менять confirmation и progress поведение node actions.

## 3. Упростить bulk-delete success flow

- [x] Не записывать `Bulk delete requested` после подтверждения modal.
- [x] Не записывать `Bulk delete completed` после успешного завершения.
- [x] Не создавать отдельный success result object или toast.
- [x] Сохранить optimistic `Terminating` для выбранных строк.
- [x] После завершения удалить выбранную строку из drawer selection, если ресурс действительно удалён.
- [x] Обновить таблицу после всех попыток удаления.

## 4. Сохранить полноценные ошибки

- [x] При partial failure создавать только существующий `buildPartialActionError`.
- [x] Не дублировать partial result в `.action-status-panel`.
- [x] При полном failure также выполнять reload, чтобы failed rows не оставались `Terminating`.
- [x] Сохранить counts, resource identity и безопасно очищенные failure details.
- [x] Сохранить command preview там, где он уже доступен.
- [x] Не скрывать ErrorPanel автоматически.

## 5. Очистить мёртвый UI-код

- [x] Проверить отсутствие runtime usages `.bulk-delete-result-panel`.
- [x] Удалить неиспользуемые `.bulk-delete-result-panel`, stats/actions/failures CSS.
- [x] Удалить связанные layout selectors, так как они больше нигде не нужны.
- [x] Проверить usages переводов `bulkDelete.requested`, `bulkDelete.completed`, `bulkDelete.completedAt`.
- [x] Удалить только действительно неиспользуемые EN/RU ключи.
- [x] Сохранить стили confirmation modal `.bulk-delete-modal`, списка и scope metadata.

## 6. Автоматические контракты

- [x] Successful bulk delete не создаёт action message.
- [x] Partial failure создаёт ErrorInfo и не создаёт action message.
- [x] Full failure выполняет reload и восстанавливает актуальные rows.
- [x] Deleted rows исчезают после reload.
- [x] Удалённая selected row закрывает drawer; failed selected row остаётся доступной.
- [x] Node-action success status и Close продолжают работать.
- [x] В renderer source отсутствуют runtime usages удалённых bulk result CSS.
- [x] Confirmation modal и Copy resource list не изменены.
- [x] Secret failure details продолжают редактироваться.

## 7. Ручной smoke

- [ ] Удалить один ресурс через bulk selection: строки исчезают, зелёного окна нет.
- [ ] Удалить несколько ресурсов: строки исчезают, зелёного окна нет.
- [ ] Проверить медленное удаление: `Terminating` виден до reload.
- [ ] Проверить partial failure: виден только ErrorPanel.
- [ ] Проверить полный failure: строки не остаются `Terminating`.
- [ ] Проверить закрытие selected resource drawer после успешного удаления.
- [ ] Проверить Drain/Cordon/Uncordon status и кнопку `Close`.
- [ ] Проверить Light и одну тёмную тему.
- [ ] Проверить macOS packaged build; Windows smoke выполнить позже.

Текущий результат: встроенное browser-окно недоступно (`iab` не обнаружен), поэтому ручные пункты выше намеренно не отмечены. macOS DMG/ZIP собраны и автоматически проверены; отсутствие completion-панели нужно подтвердить в запущенном Electron-приложении.

## 8. Quality gate

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer` — 21/21.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway` — 70/70.
- [x] `npm run verify:release`.
- [x] `git diff --check`.

## 9. Релиз 2.4.2

Версию менять только после реализации и автоматических проверок.

- [x] Синхронизировать `2.4.2` в root, desktop, shared package и lock-файле.
- [x] Обновить README и README.ru.
- [x] Обновить CHANGELOG и Node migration status.
- [x] Создать `RELEASE_NOTES_2.4.2.md`.
- [x] Создать `REGRESSION_CHECKLIST_2.4.2.md`.
- [x] Проверить macOS/Windows artifact naming через release contract.
- [x] Собрать и автоматически проверить macOS arm64 DMG/ZIP.
- [ ] Собрать Windows Portable x64 позже на Windows.

## Критерий готовности

После успешного группового удаления таблица обновляется без зелёной completion-панели и кнопки `Close`. Ошибки остаются подробными и копируемыми, failed rows не зависают в `Terminating`, а feedback операций с нодами работает без изменений.
