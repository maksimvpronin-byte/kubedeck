# KubeDeck 2.24.5 regression checklist

2.24.5 fixes the Disk bars flickering on the Nodes table. Node-only ownership is
unchanged at Node 59 / Python 0, and no route changed.

Earlier 2.13.x through 2.24.4 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (269 tests, up from 268)
- [x] `npm --workspace apps/desktop run test:gateway` (182 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.24.5`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Nodes

The report: a cluster of about seventy nodes, the Nodes table open, the yellow
Disk bars flashing.

- [ ] Open Nodes on a wide cluster and watch it for a minute: the Disk bars
  stay drawn while the table refreshes.
- [ ] A node that goes NotReady shows the new status at once; its Disk bar
  stays as it was.
- [ ] After five minutes the disk readings are fetched again and change where
  the disks changed, without the bars going blank in between.
- [ ] A node whose kubelet cannot be reached still shows N/A for Disk.
- [ ] Sorting by Disk % still orders the rows by the readings on screen.
- [ ] Switching to another cluster does not show the first cluster's disk
  readings.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.24.4 installer build offers 2.24.5 and installs it.
- [ ] Help and About report **2.24.5**.
