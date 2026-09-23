# KubeDeck 2.27.1 regression checklist

2.27.1 makes compact tables reach the right edge of the window. Node-only
ownership is unchanged at Node 59 / Python 0, and no route changed.

Earlier 2.13.x through 2.27.0 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (296 tests, up from 295)
- [x] `npm --workspace apps/desktop run test:gateway` (185 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.27.1`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Tables

- [ ] On a wide monitor, Deployments: the header and row lines reach the right
  edge; the columns stay as wide as before.
- [ ] Hover and select a row: the highlight spans the whole width.
- [ ] Fit columns to content, and double-click a border: both still work.
- [ ] Stretch to the window width: the columns share the width as before.
- [ ] Drag a column narrower: the empty column grows, nothing else moves.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.27.0 installer build offers 2.27.1 and installs it without the wizard.
- [ ] Help and About report **2.27.1**.
