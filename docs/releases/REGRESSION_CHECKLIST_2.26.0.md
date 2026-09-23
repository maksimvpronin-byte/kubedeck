# KubeDeck 2.26.0 regression checklist

2.26.0 makes tables as wide as their columns, with an option to stretch them and
a way to fit columns to their content. Node-only ownership is unchanged at Node
59 / Python 0, and no route changed.

Earlier 2.13.x through 2.25.0 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (293 tests, up from 291)
- [x] `npm --workspace apps/desktop run test:gateway` (185 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.26.0`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Compact tables

- [ ] On a wide monitor, Pods is as wide as its columns with empty room to the
  right; the columns do not widen with the window.
- [ ] Columns menu > Stretch to the window width: the table fills the window
  as before. Switch to Nodes: it is still compact. Back on Pods: stretched.
- [ ] Restart: each tab keeps its choice.
- [ ] Fit columns to content: every column fits its longest value on screen;
  headers are not cut to "A…"; the Usage bars keep their width.
- [ ] Double-click the border of Name: only Name is fitted.
- [ ] Drag a column narrow: it stops at 48px.
- [ ] Reset columns: widths, order, hidden columns and the stretch option go
  back to the defaults.
- [ ] A narrow window still hides the secondary columns as before.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.25.0 installer build offers 2.26.0 and installs it.
- [ ] Help and About report **2.26.0**.
