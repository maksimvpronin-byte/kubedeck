# KubeDeck 2.28.1 regression checklist

2.28.1 stops a table from scrolling sideways over empty columns. Node-only
ownership is unchanged at Node 59 / Python 0, and no route changed.

Earlier 2.13.x through 2.28.0 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (301 tests, up from 300)
- [x] `npm --workspace apps/desktop run test:gateway` (186 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.28.1`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Tables

- [ ] Pods in a cluster with long node names: fit columns, so Node is wide.
- [ ] Switch to a cluster with short node names: no horizontal scrollbar; Node
  is as wide as its names and the row ends in empty space.
- [ ] Back in the first cluster, Node is wide again.
- [ ] A narrow window where the columns genuinely do not fit: the scrollbar is
  there, and scrolling shows the columns past the edge.
- [ ] Drag a narrowed column's border: it moves from where it is drawn, without
  a jump.
- [ ] Stretch to the window width: unchanged.

## Updates

- [ ] An installed 2.28.0: Check for updates shows 2.28.1 in the new panel,
  with these notes and without their Verification section.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.28.0 installer build offers 2.28.1 and installs it without the wizard.
- [ ] Help and About report **2.28.1**.
