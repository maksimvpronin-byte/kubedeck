# KubeDeck 2.24.4 regression checklist

2.24.4 fixes the Logs tab flashing while Follow is on. Node-only ownership is
unchanged at Node 59 / Python 0, and no route changed.

Earlier 2.13.x through 2.24.3 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (268 tests, up from 265)
- [x] `npm --workspace apps/desktop run test:gateway` (182 tests)
- [x] Both suites on Node 22.12 as well as 24
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.24.4`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Follow

The report: a pod that logs every ten seconds, Follow on, the table refreshing
every ten seconds.

- [ ] Open that pod's Logs tab and turn Follow on. Watch it for a minute: new
  lines appear at the bottom, and the tab never flashes to *No log lines*.
- [ ] While following, let the table refresh (or press Refresh on the table):
  the log does not reload or jump.
- [ ] Only one `kubectl logs -f` runs for the tab (Task Manager or `ps`), not a
  new one per table refresh.
- [ ] Drop the VPN for half a minute and bring it back: the log keeps its lines
  while it is down and continues on its own afterwards.
- [ ] Follow a pod, then delete it (or let a Job's container finish): the tab
  keeps the last lines and does not reload every second.
- [ ] The hint under the toolbar says Follow streams new lines.
- [ ] Switching container, tail, Timestamps or Previous while following starts
  the stream over with the new settings.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.24.3 installer build offers 2.24.4 and installs it.
- [ ] Help and About report **2.24.4**.
