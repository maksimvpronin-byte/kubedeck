# KubeDeck 2.28.0 regression checklist

2.28.0 shows what a new version changes in About, gives Settings and About one
button style, and writes ages past a year in years. Node-only ownership is
unchanged at Node 59 / Python 0, and no route changed.

Earlier 2.13.x through 2.27.1 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (300 tests, up from 296)
- [x] `npm --workspace apps/desktop run test:gateway` (186 tests, up from 185)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.28.0`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Updates

The panel appears from the first version after this one: 2.28.0 is the first
build that reads the notes, so it shows them when 2.28.1 or later is released.

- [ ] An installed 2.28.0, once a newer release exists: Check for updates shows
  the panel with the new version, 2.28.0 as installed, and the release's notes
  without their Verification section.
- [ ] Download shows a progress bar; Restart and install then installs without
  the wizard.
- [ ] The portable build shows the panel with Open releases instead of Download.
- [ ] A development run says once that it cannot update.

## Settings and About

- [ ] Every section of Settings: all buttons are the same height and size.
- [ ] Clusters: Remove is red; Open, Rename and Edit kubeconfig are not.
- [ ] Local activity: each entry offers Copy JSON; the limit and Refresh share
  a line.
- [ ] About: Refresh, Copy diagnostics, the update buttons and Open match.
- [ ] The same in a light theme.

## Ages

- [ ] A resource older than a year shows 1y…d in the Age column and the drawer.
- [ ] Sorting by Age still orders oldest and newest correctly.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.27.1 installer build offers 2.28.0 and installs it without the wizard.
- [ ] Help and About report **2.28.0**.
