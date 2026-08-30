# KubeDeck 2.23.7 regression checklist

2.23.7 changes what a selection looks like in the YAML editor, splits one colour
token into two, and removes 173 `!important` from the stylesheets. The last of
those is the reason this pass matters: every removal was proved not to change any
resolved value in any of the eight themes, but no such check can hover, and 32 of
the 54 rules left sit on `:hover`, `:focus` and `:active`.

Earlier 2.13.x through 2.23.6 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css` - the ratchet is 0 and refuses any new undocumented flag
- [x] `npm run format:check`
- [x] `npm run test:renderer` (232 tests, up from 224)
- [x] `npm --workspace apps/desktop run test:gateway` (170 tests, unchanged)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## The selection in the YAML editor

The one this release exists for. Open a Pod's YAML tab and drag a selection
across a block of keys, values and a comment.

- [x] The band is a tint of the theme's own accent - dark in a dark theme - and
  not a pale lilac.
- [x] Every character under it stays readable: keys, strings, numbers, the
  comment.
- [x] The selection is still obviously a selection.
- [x] Repeat with the editor unfocused (click elsewhere, then look): the
  selection is still the theme's colour.
- [x] Search in the same tab: matches and the current match still look as they
  did in 2.23.6.

## The chips that use the accent as text

`--primary-text` is new. Five places use it.

- [x] The `+N` chip on node labels, in the table.
- [x] The control-plane role chip on a master node.
- [x] An `is-info` workload condition.
- [x] A code span in a Related row, and the tick beside the chosen item in a
  container or shell picker.
- [x] Each still reads as its theme's colour: nord blue, forest green, mocha
  amber, plum violet - darker or lighter is fine, grey is not.

## Buttons, everywhere, in all eight themes

173 `!important` were removed. The arithmetic says nothing moved; the states
below are what it could not see.

- [x] Drawer action buttons: idle, hover, disabled.
- [x] YAML and Logs toolbar buttons, including the square icon buttons - still
  square, still aligned.
- [x] The container and shell pickers in Pod Terminal: the chosen item, a hovered
  item, and one that is neither.
- [x] Related cards: hovering one still tints it and the card still reads.
- [x] Group headers and badges in the Related panel keep their shape and
  background.
- [x] The drawer's width at a narrow window (under 1280px).
- [x] Every one of the above in **system, light, midnight, nord, forest, plum,
  mocha and graphite**.

## Standard smoke test

- [x] Connect a cluster; browse pods, deployments, services and nodes.
- [x] Open a resource drawer and walk its tabs, including Logs with follow on.
- [x] Edit and apply a manifest: dry-run and apply behave as before.
- [x] Start and stop a Port Forward.
- [x] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [x] Help and About report **2.23.7**.
