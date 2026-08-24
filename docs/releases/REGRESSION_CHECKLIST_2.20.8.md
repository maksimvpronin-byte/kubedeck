# KubeDeck 2.20.8 regression checklist

`!important` came off the generic primary button rule and off 52 declarations
that were only there to beat it. Analysis says one visible thing changed. The
analysis is a proxy - it reasons about selectors, not the DOM - so this pass is
about the pixels, and it is the widest one in the whole refactor: **every button
in the application, on every theme.**

The change is to `background`, so what to look for is a button that has gone the
wrong colour, or lost its colour entirely.

Earlier 2.13.x through 2.20.7 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css` (114 undocumented low-specificity `!important`, at budget)
- [x] `npm run format:check`
- [x] `npm run test:renderer` (114 tests)
- [x] `npm --workspace apps/desktop run test:gateway` (153 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**
- [x] Cascade diff: 27 flips, 26 on pairs that cannot share an element, 1 intended

## The one intended change

- [ ] **Watch diagnostics → Start watch button.** It should now be the muted
  `--surface-active` colour, not the filled primary blue. It has been wrong
  since the rule was written; this is what it was always meant to look like.
- [ ] Check it on **light** and on one dark theme - the two tokens differ most
  there.

## Every primary button, every theme

Run this list once per theme: light, midnight, nord, forest, plum, mocha,
graphite, system. A primary button is filled; a secondary one is outlined; a
danger one is red. None of them should have become flat, transparent, or the
wrong shade.

- [ ] **Drawer**: Apply, Save, Run, Dry run - filled, and their hover state.
- [ ] **Drawer**: Delete, Restart - still red, hover still red.
- [ ] **YAML toolbar**: the action buttons and the icon actions.
- [ ] **Logs toolbar**: the same.
- [ ] **Terminal toolbar** and **SSH toolbar**: Connect, Reconnect, Clear -
  these had their own `!important` chain, so they matter.
- [ ] **SSH host key prompt**: Trust / Reject.
- [ ] **LLM tab**: Analyse, and the prompt-preview buttons.
- [ ] **Modals**: delete confirmation, YAML apply, port forward, rename cluster,
  disconnect cluster, terminal container picker.
- [ ] **Settings**: Save, Import kubeconfig, and the per-cluster buttons.
- [ ] **Cluster rail**: import, connect, disconnect.
- [ ] **Problems** and **Port forwards** panels.
- [ ] **Manifest compare** toolbar.
- [ ] **Command palette** (Ctrl+K).
- [ ] A **disabled** primary button anywhere: still visibly disabled, not
  suddenly full-strength.

## Related tab and drawer controls

These two stylesheets still carry 211 of the 227 remaining `!important` and were
not restructured, so nothing in them should have moved at all.

- [ ] Related tab: chips, group headers, cards, hover, relation badges.
- [ ] Drawer sort indicators in the resource table.
- [ ] Resource Summary tiles.

## Nothing else moved

- [ ] Resource tables, Overview, Global Search.
- [ ] Run an **LLM** analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.20.8**.
