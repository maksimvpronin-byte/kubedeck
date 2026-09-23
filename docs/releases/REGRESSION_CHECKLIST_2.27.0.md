# KubeDeck 2.27.0 regression checklist

2.27.0 lays Settings out in sections, installs updates without the installer
wizard, and fixes the remembered SSH host keys table. Node-only ownership
is unchanged at Node 59 / Python 0, and no route changed.

Earlier 2.13.x through 2.26.0 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (295 tests, up from 293)
- [x] `npm --workspace apps/desktop run test:gateway` (185 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.27.0`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Settings in sections

- [ ] Settings shows the section list on the left and one section at a time.
- [ ] Open SSH, restart: Settings opens on SSH.
- [ ] Change the kubectl path, go to LLM: General is marked as unsaved; Save
  saves it and the mark goes.
- [ ] The jump host and LLM checkboxes sit on the line of their labels.
- [ ] Every card and button looks alike; Diagnostics and Local activity read
  in Russian with the RU interface.
- [ ] Narrow the window below 1300px: the sections move above the content.
- [ ] Light theme: cards, buttons and the section list are readable.

## Updates

- [ ] From an installed 2.26.x, About > Download, then Restart and install:
  no installer wizard appears, KubeDeck restarts on 2.27.0 in the same folder.

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
- [ ] A 2.26.0 installer build offers 2.27.0 and installs it.
- [ ] Help and About report **2.27.0**.
