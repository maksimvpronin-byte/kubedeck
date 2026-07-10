# KubeDeck — Remaining Work

Короткий список незакрытой работы после рефакторинга 2.1.x. Выполнять сверху вниз. Завершённые пункты удалять из файла, а не накапливать журнал.

## 1. Renderer test gap — DONE

Статус: `DONE` (2026-07-10).

Добавить focused-тест агрегации bulk partial failures:

- mixed success/failure;
- корректные completed/failed counts;
- безопасный `rawStderr` без данных Secret;
- сохранение command preview для Node actions.

Готово: `npm run test:renderer`, typecheck и build проходят.

Выполнено: добавлен общий formatter partial result, редактирование чувствительных сообщений и focused-тест mixed result/counts/Secret/Node command preview. Проверки: renderer 5/5, typecheck и build.

## 2. PodDrawer async ownership — DONE

Статус: `DONE` (2026-07-10).

Проверить оставшиеся эффекты `PodDrawer.tsx` и вынести только общие drawer-level lifecycle:

- reset состояния при смене ресурса;
- загрузку YAML/Describe;
- загрузку Events/Related;
- logs orchestration — только если её нельзя оставить владельцу `LogsTab`.

Не менять Terminal/SSH lifecycle и пользовательское поведение вкладок.

Готово: `PodDrawer` остаётся координатором layout/tab; typecheck, build и gateway suite проходят.

Выполнено: reset и загрузка YAML/Describe/Events/Related перенесены в `usePodDrawerResourceLifecycle`. Logs orchestration оставлена рядом с её download/filter/deployment state; Terminal/SSH lifecycle не менялся. Проверки: typecheck, build, gateway 69/69.

## 3. CSS visual verification — DONE

Статус: `DONE` (2026-07-10): пользователь собрал packaged-приложение на macOS и подтвердил исправную работу UI.

В packaged приложении проверить:

- dark/light/system theme;
- ширину окна 1120 px и минимальную поддерживаемую ширину;
- ResourceTable toolbar, resize/reorder/visibility;
- drawer, modals, terminal и Settings;
- отсутствие изменения каскада между functional stylesheets.

Готово: результаты отмечены в `REGRESSION_CHECKLIST_2.1.0.md`.

Выполнено: production CSS собирается без ошибок, размер и порядок stylesheet imports стабильны; ручная packaged-проверка UI подтверждена пользователем.

## 4. macOS manual flows — DONE

Статус: `DONE` (2026-07-10): пользователь подтвердил, что macOS-сборка и интерактивные функции работают.

Проверить оставшиеся незакрытые сценарии:

- file dialogs и Settings folder actions;
- Help/About, Problems, Audit и повторное открытие lazy panels;
- cluster import/rename/remove;
- Global Search и LLM;
- YAML dry-run/apply;
- resource mutations и denied RBAC;
- Secrets;
- Terminal input/resize/reconnect;
- Node SSH;
- Port Forward.

Готово: соответствующие macOS-пункты regression checklist отмечены фактическими результатами.

Подтверждено: packaged smoke из логов и последующая ручная приёмка macOS пользователем.

## 5. Windows acceptance — BLOCKED

Статус: `BLOCKED`: требуется Windows x64; на текущем macOS окружении результат подтвердить нельзя.

На Windows выполнить:

```powershell
npm.cmd run verify:node-only
npm.cmd run verify:release
npm.cmd run package:win
```

Затем проверить portable startup, table/drawer UI и Pod Terminal: copy/paste, Backspace/Delete, стрелки, Home/End, resize и `stty size`.

Готово: Windows-пункты checklist закрыты, artifact проверен, найденные дефекты вынесены в отдельные задачи.

## 6. Final acceptance — IN PROGRESS

Статус: `IN PROGRESS`.

Финальные команды:

```bash
npm run test:renderer
npm run typecheck
npm run build
npm --workspace apps/desktop run test:gateway
```

После закрытия macOS и Windows checklist:

- отметить KubeDeck 2.1.0 принятым;
- удалить этот файл;
- создать один итоговый commit.

Автоматические финальные команды на macOS выполнены: renderer 5/5, typecheck, build, gateway 69/69. macOS/UI приняты пользователем; текущий checkpoint commit разрешён. Итоговая кроссплатформенная приёмка ожидает только Windows acceptance.
