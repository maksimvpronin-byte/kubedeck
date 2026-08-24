# KubeDeck 2.21.1 release notes

The boot screen stayed until the cluster opened, which is not the same thing as
the window being usable. No route changes. Node-only ownership stays at Node 58 /
Python 0.

## What 2.21.0 got wrong

It ended the screen when `openLastCluster` settled. That is the last thing the
hook that owns the start does - but not the last thing that has to happen before
the window is worth looking at. The first resource table is loaded afterwards,
from an effect the hook cannot see, and until its rows arrive the application is
an empty shell.

Measured on a warm start, from `app.whenReady()`:

| | 2.21.0 |
|---|---|
| window and first frame of the boot screen | 150 ms |
| bundle parsed | 160 ms |
| gateway, `config.json`, `kubectl` | 300 ms |
| cluster open - **screen handed over** | 750 ms |
| first table requested | 850 ms |
| rows on screen | 1060 ms |

So the screen covered the first three quarters of the start and then let go,
leaving the last stretch looking exactly like the blank window it was built to
replace. On a cluster with real load, that stretch is seconds, not 300 ms.

## What it does now

A sixth stage, **Resources** / **Ресурсы**, reported by `useResourceLoader` with
the kind it is fetching (`pods`, `nodes`). The screen ends when its rows land.
Same start, measured again: rows at `05.241`, screen gone at `05.242`.

Two details this needed:

- **The hook that opens the cluster cannot start that stage** - it does not know
  whether a load is coming, only that one would begin within a moment. So it no
  longer ends the screen; it asks for the screen to end **once nothing is in
  flight** (`finishWhenIdle`, 600 ms of grace, against a measured 96 ms gap). A
  load that begins inside the grace period holds the screen open until it
  finishes; a section that loads no table at all - Overview, Settings, no
  clusters configured - lets it go at the end of the grace period.
- **Stage weights were re-cut** for six stages: interface 0.34, gateway 0.10,
  settings 0.04, kubectl 0.12, cluster 0.22, resources 0.18. As before, a start
  with measurements behind it replaces all six with its own.

`complete` also no longer overwrites a stage that has already failed, which
matters now that the loader reports both.

## Files

| File | |
|---|---|
| `apps/desktop/src/renderer/public/boot-screen.js` | the resources stage, `finishWhenIdle`, re-cut weights |
| `apps/desktop/src/renderer/bootProgress.ts` | `finishBootWhenIdle` replaces `finishBoot` |
| `apps/desktop/src/renderer/hooks/useResourceLoader.ts` | reports the first table |
| `apps/desktop/src/renderer/hooks/useClusterController.ts` | hands over when idle rather than outright |
| `apps/desktop/tests/boot-screen.contract.test.cjs` | 9 tests (was 8) |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **124 tests**
- `npm --workspace apps/desktop run test:gateway` - **154 tests**, unchanged
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- Timed against the running application, not only the suite: the hand-over is
  now within a millisecond of the first rows.
- `/migration/status` remains `node-only`, Node 58 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.21.1.md](./REGRESSION_CHECKLIST_2.21.1.md).
