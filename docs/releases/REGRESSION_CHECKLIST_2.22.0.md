# KubeDeck 2.22.0 regression checklist

2.22.0 stops the kubectl work behind a request the client has abandoned. The
answers themselves are unchanged, so this checklist is mostly about proving that
nothing was cancelled that should have finished.

Earlier 2.13.x through 2.21.1 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (124 tests, unchanged)
- [ ] `npm --workspace apps/desktop run test:gateway` (157 tests, was 154)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, Node 58 / Python 0

## What must now stop

With a task manager (or `Get-Process kubectl`) open next to the application:

- [ ] Click quickly through five or six kinds in the resource tree on a cluster
  with a big pod list. The kubectl processes of the abandoned tabs disappear
  instead of piling up; only the tab actually on screen keeps one.
- [ ] Open the command palette and type a long query slowly (Ctrl+K, then
  `nginx-ingress-controller`). Processes come and go, but they do not accumulate
  one fan-out per keystroke.
- [ ] Open Problems, then immediately switch to Overview, then back. The panel
  left behind does not keep loading in the background.
- [ ] Open a pod drawer, go to Related, and close the drawer while it is still
  loading. Its lists stop.

## What must still finish

- [ ] Leave a resource table open on a slow, wide cluster and do not touch
  anything: the load completes and the rows appear, exactly as before.
- [ ] A search left alone returns its results, with the same ranking as before.
- [ ] Overview and Problems, left on screen, refresh on their interval.
- [ ] The **usage history** keeps recording while tabs are switched: open a pod
  drawer after a few minutes of browsing and the usage chart still has points.
  (The sampler is deliberately not tied to any request.)
- [ ] The **node disk bars** still fill on the nodes table, including right
  after switching to it from another tab.

## What must not be lost

- [ ] Switch away from a resource tab mid-load and back again: the table loads
  normally, and does not behave as though the cache had been wiped.
- [ ] Log (`%APPDATA%/KubeDeck/logs`): abandoned requests leave no
  `gateway ... failed` lines, and no `KUBECTL_CANCELLED` surfaces as an error
  banner in the UI.
- [ ] A genuinely failing request still reports properly: point a cluster at an
  unreachable endpoint and confirm the error panel and the log line are the same
  as before.
- [ ] Disconnect a cluster while a list is loading: the existing "cluster is
  disconnected" behaviour is unchanged.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.22.0**.
