# KubeDeck 2.21.0 release notes

A start-up screen: the window opens immediately and says what it is waiting for.
No route changes. Node-only ownership stays at Node 58 / Python 0.

## What starting KubeDeck used to look like

Nothing, and then everything.

`app.whenReady()` started the local gateway and waited for it. Only then was the
window created, and the window then sat empty while the renderer bundle was
parsed, while `config.json` was read, while `kubectl version` answered, and while
the cluster that was open last was reopened - which, on a cluster that is slow or
gone, is where the whole wait actually lives. Every one of those steps was
invisible. A start that took four seconds and a start that had hung looked
exactly alike.

## What it looks like now

The window opens straight away and paints a boot screen: the KubeDeck mark, a
progress bar, and the five stages the start is actually made of, each with what
it is loading.

```
Запуск KubeDeck                                    46%   осталось около 4 с
Готовим рабочее место
  ● Интерфейс          бандл, стили, тема
  ● Локальный шлюз     127.0.0.1 · сессионный токен
  ● Настройки          config.json
  ● kubectl            версия клиента
  ◌ Кластер            prod-eu-central
```

Details worth knowing:

- **The bar follows the work, not a timer.** A stage fills its own share of the
  bar and stops at 92% of it; it only completes when the work behind it reports
  back. The bar never moves backwards.
- **The estimate comes from the previous start.** Each start is measured and the
  five durations are stored in `localStorage`. The next start uses them both to
  size the stages - a cluster that took four seconds owns most of the bar, not a
  fixed quarter of it - and to say how much is left. The very first start shows
  no estimate at all, because it has nothing honest to base one on.
- **It can always be dismissed.** After three seconds a "Continue in background"
  button appears, and twenty seconds after the interface is up the screen hands
  over on its own. An unreachable cluster cannot hold the window: the application
  is behind the screen, already running, with its own connection state.
- **A stage that fails says so** - the row turns red and carries the error - and
  the screen still steps aside about a second later, because the application's
  own error surface is the one that explains it.

## The window and the gateway now start together

The gateway is no longer waited for before the window is created; both start at
once and `kubedeck:getBackendAuth` awaits the gateway's address instead of
handing back an empty one. That is what makes an early window possible, and it
takes the gateway's start off the visible wait entirely.

## The window is no longer the wrong colour

`BrowserWindow` painted a fixed `#101317` before any page existed - a dark flash
for everyone on the Light theme, and not quite any theme's background for
everyone else. It now reads the stored theme from `config.json` and uses that
theme's background, which is also the colour the boot screen paints over it.

## Why the screen is a plain script

`renderer/public/boot-screen.js` is not part of the bundle. The longest stage it
reports is the loading of that bundle, so it has to be on screen before it -
which also means it cannot use `styles/tokens.css` or `i18n.ts`. It carries the
seven theme backgrounds and a two-language dictionary of its own, and
`tests/boot-screen.contract.test.cjs` fails if either drifts from the sources
they were copied from. The renderer reports stages through `bootProgress.ts`,
whose calls are no-ops once the screen has handed over.

The language it starts in comes from `localStorage`, written by
`applyLanguagePreference` for the same reason the theme already was: the settings
that hold it arrive from the gateway, which is one of the stages being reported.

## Files

| File | |
|---|---|
| `apps/desktop/src/renderer/public/boot-screen.js` | new - the screen itself |
| `apps/desktop/src/renderer/bootProgress.ts` | new - the stages, and the calls that move them |
| `apps/desktop/tests/boot-screen.contract.test.cjs` | new - 8 tests |
| `apps/desktop/src/main/main.ts` | window and gateway start together; themed window background |
| `apps/desktop/src/renderer/index.html` | the screen is painted before the module bundle |
| `apps/desktop/src/renderer/main.tsx` | reports the interface stage |
| `apps/desktop/src/renderer/hooks/useClusterController.ts` | reports gateway, settings, kubectl and cluster |
| `apps/desktop/src/renderer/utils/language.ts` | stores the resolved language for the screen |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **123 tests** (115 + 8)
- `npm --workspace apps/desktop run test:gateway` - **154 tests**, unchanged
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- `/migration/status` remains `node-only`, Node 58 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.21.0.md](./REGRESSION_CHECKLIST_2.21.0.md).
