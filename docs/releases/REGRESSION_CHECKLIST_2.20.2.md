# KubeDeck 2.20.2 regression checklist

Three stylesheets renamed, two merged into one, and 126 `!important`
declarations removed. No rule changed its value and no rule changed its
position relative to any rule it competes with - a cascade checker compared
18211 competing declaration pairs before and after and found zero differences.

That checker reasons about selectors, not about the DOM. This pass is the part
it cannot do: looking at the pixels. Everything below should be **identical to
2.20.1**, so the check is "nothing moved", not "the new thing works".

Earlier 2.13.x through 2.20.1 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (93 tests)
- [x] `npm --workspace apps/desktop run test:gateway` (146 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**
- [x] Cascade equivalence: 18211 pairs, 0 flipped, 0 gone, 0 new

## Do this on every theme

Run the three blocks below once per theme. The renamed files carry
theme-conditional rules (`:root[data-theme="light"] …`), so **light is the one
most likely to show a difference** - do it first, and do not skip the rest.

- [x] light
- [x] midnight
- [x] nord
- [x] forest
- [x] plum
- [x] mocha
- [x] graphite
- [x] system (follows the OS setting; flip the OS theme and watch it repaint)

## Resource drawer

- [x] Open a pod. Header, tabs and the action row look as they did: buttons the
  same size, the same spacing, the same colours.
- [x] **Primary buttons** in the drawer - Apply, Save, Run - keep their filled
  look, including on hover and when disabled.
- [x] **Danger buttons** - Delete, Restart - stay red, on hover too.
- [x] Icon buttons (copy name, close) keep their size and hover state.
- [x] The **YAML** toolbar: buttons, search field and the fold control.
- [x] The **Logs** toolbar: the follow toggle, filter field, icon actions.
- [x] The **Terminal** and **SSH** toolbars, both in the drawer and in the
  bottom workspace - their primary buttons are the ones most exposed by this
  change.
- [x] The **LLM** tab: the panel background, the border and the buttons in it.
  In **light** theme especially - two stylesheets set this panel's colours.
- [x] Sort indicators in the resource table: the arrow sits next to the label,
  a long column name still ellipsises instead of pushing the arrow out.

## Related tab

This is the merged file, so it is the most likely place for a difference.

- [x] The toolbar: the filter select keeps its width and sits on the same line.
- [x] The relation summary reads as a row of separated chips, not pills with
  borders, and the `·` separator appears between them but not after the last.
- [x] Group headers: uppercase title, count aligned right, a thin rule between
  groups and none above the first.
- [x] Result cards: the name ellipsises, the namespace sits right of it, the
  relation badge keeps its pill, and the `code` fragment keeps its frame.
- [x] Hovering a card highlights the whole row.
- [x] The owner, selector, storage, RBAC and config relation badges keep their
  distinct colours.
- [x] A resource with no related objects, and one with a diagnostics error,
  both render as before.

## Resource Summary

- [x] Tiles: the grid reflows at a narrow window instead of clipping, and the
  success/warning/pending/danger/neutral tones are unchanged.
- [x] The container rows and the restart card, on a pod that has restarted.
- [x] Warning events and problem rows.
- [x] Service endpoints, including a not-ready one.
- [x] The **How to reach it** block added in 2.20.0 is untouched.
- [x] The usage history chart: range buttons, the active one, the bars, the
  limit marker and the legend.
- [x] ResourceQuota usage bars.

## Nothing else moved

- [x] Cluster rail, namespace selector, resource tables, pagination.
- [x] Overview, Problems, Global Search, Port forwards, Audit, Settings.
- [x] Modals: delete confirmation, port-forward, rename cluster, manifest
  compare.
- [x] The command palette (Ctrl+K).
- [x] A **Secret** tab still hides values, and reveal/copy/auto-hide behave as
  before.
- [x] Run an **LLM** analysis on a pod: the panel renders and no Secret value
  or log line reaches the prompt.
- [x] Help and About report **2.20.2**.
