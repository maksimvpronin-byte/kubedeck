# KubeDeck 2.26.1 regression checklist

2.26.1 fixes the remembered SSH host keys table in Settings. Node-only ownership
is unchanged at Node 59 / Python 0, and no route changed.

Earlier 2.13.x through 2.26.0 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (294 tests, up from 293)
- [x] `npm --workspace apps/desktop run test:gateway` (185 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.26.1`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Remembered SSH host keys

- [ ] Settings > Remembered SSH host keys: every row is as wide as the header.
- [ ] The Forget button of every row is whole, at the right of the card.
- [ ] Fingerprints are shown in full; a narrow window wraps them.
- [ ] Forget removes the entry; Reload lists the rest.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.26.0 installer build offers 2.26.1 and installs it.
- [ ] Help and About report **2.26.1**.
