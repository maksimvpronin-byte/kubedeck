# KubeDeck 2.6.0 — план закреплённого Pod Terminal

Статус: план подготовлен, реализация не начата.

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

- [ ] Проверка 1: подтвердить, что единственная причина потери сессии — размонтирование `TerminalTab` вместе с `PodDrawer`.
- [ ] Проверка 2: подтвердить, что backend WebSocket не зависит от выбранного renderer resource после подключения.
- [ ] Проверить cleanup WebSocket/xterm при явном закрытии и shutdown приложения.
- [ ] Проверить текущий container picker и auto-connect flow.

## Минимальная архитектура

- Хранить один terminal target в `App`: cluster id/name, namespace, pod name/uid, containers и выбранный container.
- Передать из `PodDrawer` callback запуска terminal вместо владения долгоживущей terminal-сессией.
- Один раз смонтировать persistent terminal panel вне identity-bound `PodDrawer`.
- Скрывать/показывать панель без размонтирования `TerminalTab`.
- Повторный запуск terminal для другого pod требует явного подтверждения закрытия текущей активной сессии.

## Контракты

- [ ] Terminal owner расположен вне `PodDrawer` identity boundary.
- [ ] Смена resource/row не вызывает cleanup активного terminal WebSocket.
- [ ] Collapse/expand не размонтирует `TerminalTab`.
- [ ] Close вызывает один WebSocket close и dispose xterm.
- [ ] Вкладка сохраняет исходные cluster/namespace/pod/container metadata.
- [ ] Смена cluster не переназначает terminal на новый cluster.
- [ ] Повторный запуск не создаёт две скрытые сессии.
- [ ] Paste остаётся на единственном xterm input path.

## Ручной smoke

- [ ] Запустить netshoot terminal и выполнить команду.
- [ ] Открыть другой Pod, Service, Deployment и Node; terminal продолжает работать.
- [ ] Свернуть и вернуть terminal; вывод и ввод сохранены.
- [ ] Переключить cluster; terminal исходного cluster доступен и правильно подписан.
- [ ] Закрыть terminal и подтвердить завершение сессии.
- [ ] Запустить terminal повторно для другого pod/container.

## Regression gate

- [ ] `npm run lint`.
- [ ] `npm run format:check`.
- [ ] `npm run test:renderer`.
- [ ] `npm run typecheck`.
- [ ] `npm run build`.
- [ ] `npm --workspace apps/desktop run test:gateway`.
- [ ] `npm run verify:release` после оформления версии 2.6.0.
- [ ] `git diff --check`.

## Критерии приёмки

- [ ] Активный Pod Terminal переживает любую renderer-навигацию по ресурсам.
- [ ] К terminal можно вернуться одним действием через постоянную вкладку.
- [ ] Вкладка однозначно показывает target сессии.
- [ ] Ресурсы освобождаются только при явном закрытии, завершении backend-сессии или shutdown.
- [ ] Новые зависимости и лишние архитектурные слои не добавлены.
