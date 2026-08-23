# KubeDeck 2.16.1 regression checklist

A single-fix release: the height of the resource table panel. The automated
gates below ran and passed during development, and all three row states - one
row, sixty rows and none - were rendered against the application's own
stylesheets before and after the change.

Earlier 2.13.x, 2.14.0, 2.15.x and 2.16.0 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## Where the pagination bar sits

- [ ] Open **CronJobs** (or Nodes) on a cluster with a handful of rows: the
  pagination bar is at the **bottom of the window**, not just under the last
  row. (This is the 2.16.1 fix.)
- [ ] Open **Pods** in a busy namespace: unchanged - the rows scroll and the bar
  is still at the bottom.
- [ ] Scroll a long list: the column header stays stuck to the top of the rows
  and the pagination bar never moves.
- [ ] Resize the window taller and shorter: the bar tracks the bottom edge and
  the rows take the difference.
- [ ] Switch between a long list and a short one: the bar does not jump up.

## The empty state

- [ ] Open a resource with no objects: "Nothing here yet" fills the space
  between the header and the pagination bar, centred, with its title and
  sentence close together rather than drifting apart.
- [ ] Filter a table down to nothing: the same, and **Clear filter** is inside
  the message and works.
- [ ] Clear the filter: the rows come back at the top of the scroll area.

## Nothing else moved

- [ ] Sort by a column, drag a header to reorder, drag its edge to resize: all
  unchanged, and the table still scrolls sideways rather than stretching the
  window.
- [ ] Select rows and use the bulk actions; on Nodes, Cordon / Uncordon / Drain
  still appear.
- [ ] The columns popover still opens whole on a short table, as in 2.15.2.
- [ ] Change **Page size** and step with First / Prev / Next / Last.
- [ ] Open the **Problems** view: its table is inside another panel and looks
  exactly as it did.
- [ ] Open a resource drawer over a short table, and open a bottom terminal:
  the table resizes around them and the bar stays at the bottom of what is
  left.
- [ ] Switch themes, light included: nothing about the table repaints
  differently.
- [ ] Connect and disconnect a cluster, and run an LLM analysis on a pod: both
  behave as in 2.16.0.
- [ ] Help and About report **2.16.1**.
