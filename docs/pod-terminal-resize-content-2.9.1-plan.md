# KubeDeck 2.9.1 — растягивание содержимого Pod Terminal

Статус: реализовано; автоматические проверки пройдены, ручной smoke ожидается.

## Симптом

Нижняя Terminal Workspace увеличивается при drag вверх, но само окно xterm
Pod Terminal сохраняет прежнюю высоту. Ниже терминала появляется свободное
место.

## Причина

`TerminalTab` содержит два прямых элемента:

1. `.terminal-toolbar`;
2. `.terminal-screen.xterm-host`.

При этом `.pod-terminal` всё ещё использует старую сетку из четырёх строк:

```css
grid-template-rows: auto auto auto minmax(0, 1fr);
```

xterm занимает вторую `auto`-строку, а растущая `1fr`-строка остаётся пустой.
`ResizeObserver` и `FitAddon` получают размеры самого `.xterm-host`, поэтому
не могут заполнить место, которое CSS выделил другой строке.

Node SSH использует flex-column и уже отдаёт свободную высоту `.xterm-host`
через `flex: 1 1 100px`; менять его layout без воспроизводимого дефекта не
нужно.

## Минимальный патч

В `apps/desktop/src/renderer/styles/drawer.css` заменить сетку
`.pod-terminal` на две фактические строки:

```css
grid-template-rows: auto minmax(0, 1fr);
```

React-компоненты, resize-handle, сохранение высоты, WebSocket и backend
protocol не менять.

## Автоматическая проверка

- [x] Renderer contract фиксирует две строки `.pod-terminal`.
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `git diff --check`

## Ручной smoke

- [ ] Открыть Pod Terminal и подключиться.
- [ ] Растянуть нижнюю workspace вверх: граница xterm должна дойти до нижней
      границы панели.
- [ ] Сузить workspace: toolbar остаётся видимым, xterm уменьшается без
      переполнения.
- [ ] Выполнить `stty size` до и после resize: число rows должно измениться.
- [ ] Переключиться на Node SSH и убедиться, что его существующее растягивание
      не изменилось.

## Критерий приёмки

Высота активного Pod xterm следует за высотой Terminal Workspace, а
`FitAddon` отправляет новый PTY-размер без изменений SSH и backend-кода.
