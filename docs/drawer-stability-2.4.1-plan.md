# KubeDeck 2.4.1 — Drawer Stability and YAML Cleanup Plan

Статус: реализация, автоматическая проверка и macOS UI smoke завершены; Windows smoke отложен.

## Цель

Убрать заметный рывок открытого resource drawer во время фонового обновления таблицы и очистить YAML-вкладку от крупных служебных result-панелей, которые дублируют состояние кнопок и основной ErrorPanel.

Версия релиза: `2.4.1`.

## Подтверждённые замечания

1. Открытый drawer визуально дёргается примерно с периодом auto-refresh, даже если выбранный Kubernetes-объект не изменился.
2. После `Reload YAML` появляется крупная панель `Reload YAML / Copy output` с текстом `YAML reloaded from the cluster`, хотя успешный результат уже показан состоянием кнопки `Reloaded`.
3. Аналогичные постоянные success/result-панели занимают место и меняют высоту содержимого drawer без достаточной пользы.

## Предварительная причина рывка

`usePodDrawerResourceLifecycle` подписан на весь объект `pod`. При каждом обновлении Resource Table строка может получить новый object reference, даже когда `uid`, имя, namespace и выбранный ресурс не изменились. Это повторно запускает drawer effects, включает общий `loading` и может временно добавлять `Loading...`, менять высоту контента или заново запрашивать активную вкладку.

Это рабочая гипотеза. Перед исправлением её нужно подтвердить тестом или временной диагностикой; не маскировать эффект только CSS-фиксом.

## Границы патча

Входит:

- стабильная identity выбранного ресурса во время фонового обновления rows;
- отсутствие повторной инициализации drawer из-за нового object reference той же строки;
- сохранение tab, scroll, focus, YAML draft и локальных состояний;
- удаление крупных YAML operation-output панелей для Reload, Dry-run и Apply;
- компактный итог операции возле управляющих кнопок;
- сохранение подробных ошибок в существующем ErrorPanel;
- автоматические контракты и версия `2.4.1`.

Не входит:

- отключение auto-refresh таблицы;
- изменение Kubernetes API, Gateway или kubectl-команд;
- изменение частоты refresh;
- скрытие реальных ошибок;
- переработка всего drawer или остальных вкладок.

## 1. Зафиксировать baseline и воспроизведение

- [x] Начать от принятого commit 2.4.0.
- [x] Подтвердить по пользовательскому smoke период рывка относительно configured auto-refresh.
- [x] Проверить YAML, Describe, Events, Logs и Summary вручную после исправления.
- [x] Зафиксировать причину: повторный API effect и `loading` из-за нового object reference строки.
- [x] Добавить тест, воспроизводящий новый object reference при той же resource identity.

## 2. Стабилизировать lifecycle drawer

- [x] Заменить зависимости effects от всего `pod` на стабильные примитивы: cluster, resource, uid, namespace и name.
- [x] Не сбрасывать drawer snapshot, если identity выбранного объекта не изменилась.
- [x] Не показывать глобальный `Loading...` при тихом обновлении той же строки.
- [x] Не перезапрашивать YAML/Describe только из-за обновления object reference.
- [x] Сохранить request generation и AbortController-защиту от stale responses.
- [x] При реальной смене объекта продолжать полностью сбрасывать старые данные и ошибки.
- [x] Обновлять изменившиеся summary-поля строки без сброса tab и локального UI state.

## 3. Сохранить пользовательское состояние

- [x] Активная вкладка не меняется во время auto-refresh.
- [x] Scroll position YAML/Describe/Logs не сбрасывается lifecycle-эффектом.
- [x] Focus остаётся на текущем control/editor без remount.
- [x] Несохранённый YAML draft не заменяется данными фонового refresh.
- [x] Search query и выбранные параметры Logs сохраняются.
- [x] Drawer width и положение resize handle не меняются.

## 4. Удалить лишние YAML result-панели

- [x] После успешного Reload не создавать панель `Reload YAML / Copy output`.
- [x] Для Reload использовать уже реализованное краткое состояние кнопки `Reloaded`.
- [x] После успешного Dry-run показывать компактный inline-статус без отдельной большой карточки.
- [x] После успешного Apply показывать компактный inline-статус без отдельной большой карточки.
- [x] При ошибке использовать основной ErrorPanel и не дублировать ту же ошибку второй панелью.
- [x] Удалить кнопку `Copy output`, так как отдельного operation output больше нет.
- [x] Удалить неиспользуемые `yamlOperationTitle`, `yamlOperationOutput`, props и CSS `.yaml-operation-output`.
- [x] Не удалять YAML editor, dirty-state, confirmation modal и защиту read-only CRD.

## 5. Автоматические контракты

- [x] Новый object reference с прежней identity не сбрасывает lifecycle.
- [x] Смена cluster/uid/name/namespace/resource выполняет полный reset.
- [x] Auto-refresh той же строки не включает drawer loading placeholder.
- [x] YAML draft сохраняется при обновлении строки.
- [x] Manual Reload по-прежнему запрашивает свежий YAML и показывает async feedback.
- [x] Reload/Dry-run/Apply success не создают `.yaml-operation-output`.
- [x] Ошибки Reload/Dry-run/Apply остаются видимыми и пригодными для копирования через ErrorPanel.
- [x] Renderer contracts, typecheck и build проходят — 20/20 renderer tests.

## 6. Ручной smoke

- [x] Оставить drawer открытым минимум на три цикла auto-refresh: визуального рывка нет.
- [x] Проверить Summary, YAML, Describe, Events и Logs.
- [x] Проверить длинный YAML со scroll и активным search.
- [x] Изменить YAML и дождаться auto-refresh: draft не потерян.
- [ ] Проверить Reload success/error.
- [ ] Проверить Dry-run success/error.
- [ ] Проверить Apply success/error и confirmation.
- [ ] Проверить все темы и `prefers-reduced-motion`.
- [x] Проверить macOS packaged build; Windows smoke выполнить позже на Windows.

Текущий результат: пользователь подтвердил стабильность drawer и сохранение состояния в macOS UI. macOS DMG/ZIP собраны и автоматически проверены; Windows smoke выполняется позже на Windows.

## 7. Quality gate

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer` — 20/20.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway` — 70/70.
- [x] `npm run verify:release`.
- [x] `git diff --check`.

## 8. Релиз 2.4.1

Версию менять только после реализации и автоматических проверок.

- [x] Синхронизировать `2.4.1` в root, desktop, shared package и lock-файле.
- [x] Обновить README и README.ru.
- [x] Обновить CHANGELOG и Node migration status.
- [x] Создать `docs/releases/RELEASE_NOTES_2.4.1.md`.
- [x] Создать `docs/releases/REGRESSION_CHECKLIST_2.4.1.md`.
- [x] Проверить macOS/Windows artifact naming через release contract.
- [x] Собрать macOS arm64 DMG/ZIP и автоматически проверить payload.
- [ ] Собрать Windows Portable x64 позже на Windows.

## Критерий готовности

Открытый drawer остаётся визуально неподвижным при фоновых обновлениях той же строки. Пользовательские tab, scroll, focus и YAML draft сохраняются. Успешные Reload, Dry-run и Apply больше не создают крупные дублирующие панели; ошибки остаются заметными и информативными.
