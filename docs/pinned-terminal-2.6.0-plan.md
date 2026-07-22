# KubeDeck 2.6.0 — план закреплённого Pod Terminal

Статус: реализация и автоматический regression gate завершены; ожидается ручной smoke.

## Цель

Сохранять запущенную Pod Terminal-сессию при навигации по ресурсам и давать возможность быстро вернуться к ней через постоянную вкладку интерфейса.

## Подтверждённая причина

- `TerminalTab` сейчас отрисовывается внутри `PodDrawer`.
- Identity drawer зависит от выбранного cluster/resource/row.
- При переходе к другому ресурсу terminal component размонтируется.
- Cleanup `TerminalTab` закрывает WebSocket и уничтожает xterm, поэтому диагностическая сессия завершается.

## MVP 2.6.0

- Одна закреплённая Pod Terminal-сессия одновременно.
- После запуска terminal живёт на уровне `App`, независимо от текущего drawer и выбранного ресурса.
- Постоянная вкладка показывает cluster, namespace, pod и container.
- Терминал можно открыть, свернуть, развернуть и явно закрыть.
- Размер панели можно менять вручную; последняя ширина и высота восстанавливаются при следующем запуске terminal.
- Навигация между Pods и другими ресурсами не размонтирует terminal.
- Переключение активного cluster не закрывает terminal; вкладка явно показывает исходный cluster.
- Закрытие вкладки завершает WebSocket и освобождает xterm.

## Не входит

- Несколько одновременных terminal-вкладок.
- Восстановление terminal после перезапуска приложения.
- Фоновое переподключение завершённой kubectl exec-сессии.
- Перенос Node SSH в тот же workspace.
- Новый state manager, router или dependency.

## Двойная проверка до изменения

- [x] Проверка 1: причиной потери сессии было размонтирование `TerminalTab` вместе с `PodDrawer`.
- [x] Проверка 2: backend WebSocket не зависит от выбранного renderer resource после подключения.
- [x] Cleanup WebSocket/xterm выполняется существующим cleanup при явном закрытии и shutdown приложения.
- [x] Существующие container picker и auto-connect flow сохранены.

## Минимальная архитектура

- Хранить один terminal target в `App`: cluster id/name, namespace, pod name/uid, containers и выбранный container.
- Передать из `PodDrawer` callback запуска terminal вместо владения долгоживущей terminal-сессией.
- Один раз смонтировать persistent terminal panel вне identity-bound `PodDrawer`.
- Скрывать/показывать панель без размонтирования `TerminalTab`.
- Повторный запуск terminal для другого pod требует явного подтверждения закрытия текущей активной сессии.

## Контракты

- [x] Terminal owner расположен вне `PodDrawer` identity boundary.
- [x] Смена resource/row не меняет persistent terminal owner.
- [x] Collapse/expand не размонтирует `TerminalTab`.
- [x] Close размонтирует один `TerminalTab`, вызывая существующий WebSocket close и dispose xterm.
- [x] Вкладка сохраняет исходные cluster/namespace/pod/container metadata.
- [x] Смена cluster не переназначает terminal на новый cluster.
- [x] Повторный запуск не создаёт две скрытые сессии.
- [x] Paste остаётся на единственном xterm input path.
- [x] Native resize сохраняет ширину и высоту в существующем UI state.

## Ручной smoke

- [ ] Запустить netshoot terminal и выполнить команду.
- [ ] Открыть другой Pod, Service, Deployment и Node; terminal продолжает работать.
- [ ] Свернуть и вернуть terminal; вывод и ввод сохранены.
- [ ] Изменить ширину и высоту, закрыть terminal и открыть снова; размер восстановлен.
- [ ] Переключить cluster; terminal исходного cluster доступен и правильно подписан.
- [ ] Закрыть terminal и подтвердить завершение сессии.
- [ ] Запустить terminal повторно для другого pod/container.

## Regression gate

- [x] `npm run lint`.
- [x] `npm run format:check`.
- [x] `npm run test:renderer` — 33/33.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] `npm --workspace apps/desktop run test:gateway` — 73/73.
- [x] `npm run verify:release` после оформления версии 2.6.0.
- [x] `git diff --check`.

## Критерии приёмки

- [ ] Активный Pod Terminal переживает любую renderer-навигацию по ресурсам.
- [ ] К terminal можно вернуться одним действием через постоянную вкладку.
- [ ] Вкладка однозначно показывает target сессии.
- [ ] Ресурсы освобождаются только при явном закрытии, завершении backend-сессии или shutdown.
- [x] Новые зависимости и лишние архитектурные слои не добавлены.
