# KubeDeck 2.15.2 regression checklist

A single-fix release: the columns popover in the resource table. The automated
gates below ran and passed during development, and the fix was reproduced and
verified against the application's own stylesheets before and after the change.

Earlier 2.13.x, 2.14.0, 2.15.0 and 2.15.1 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## The popover on a short table

- [ ] Open **Nodes** on a cluster with a handful of nodes and press the columns
  button: the whole list is visible, down to the last column. (This is the
  2.15.2 fix - it used to be cut off just below the table.)
- [ ] Untick a column: it disappears from the table and the popover stays open.
- [ ] Untick everything but one: the last ticked box is disabled.
- [ ] **Reset columns** restores the default set, with the popover still open.
- [ ] Do the same on Pods, where the table fills the window: unchanged.

## Where the popover puts itself

- [ ] Shrink the window until there is little room under the button: the
  popover opens **upwards** and still shows its header.
- [ ] With a very short window, the list scrolls inside the popover instead of
  running off the screen.
- [ ] Resize the window with the popover open: it stays attached to the button.
- [ ] Scroll the table with the popover open: it stays attached to the button.
- [ ] Open it on the narrowest window the layout allows: it stays inside the
  window, not cut off at the right edge.

## Closing it

- [ ] Click outside the popover: it closes.
- [ ] Click the button again: it closes.
- [ ] Press **Escape**: it closes. (New in 2.15.2.)
- [ ] Click inside the popover, on a label or on Reset columns: it stays open.

## Nothing else moved

- [ ] The popover is readable in every theme, light included, and the **Reset
  columns** button looks the same as before.
- [ ] Drag a column header to reorder and drag its edge to resize: unchanged,
  and the popover lists the new order.
- [ ] Sort by a header, filter, and page through the table: unchanged.
- [ ] Open a drawer over the table, then a modal: the popover does not show
  through either.
- [ ] Connect and disconnect a cluster, and run an LLM analysis on a pod: both
  behave as in 2.15.1.
