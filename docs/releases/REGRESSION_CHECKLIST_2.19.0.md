# KubeDeck 2.19.0 regression checklist

Sorting and filtering nodes by an annotation. The automated gates below ran and
passed during development, and the column, its sort menu and its popover were
driven against the application's own stylesheets with three nodes carrying
different annotations before release.

Earlier 2.13.x, 2.14.0, 2.15.x, 2.16.x, 2.17.0 and 2.18.0 checklists still
apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## The Annotations column

- [ ] Open **Nodes**: there is no Annotations column, and **Annotations** is
  listed unticked in the columns menu.
- [ ] Tick it: the column appears, each cell reading `N annotations`.
- [ ] A node with a single annotation reads `1 annotation`, not `1 annotations`.
- [ ] A node with none leaves the cell empty.
- [ ] Untick it again, reload the application: it is still hidden - and a
  cluster where it was ticked still has it.
- [ ] **Reset columns**: the column goes back to hidden rather than appearing
  along with everything else.

## Sorting by one annotation

- [ ] Click the Annotations header: a menu lists the annotation keys the loaded
  nodes carry, the ones on the most nodes first.
- [ ] Pick one: the header shows that key beside the arrow, and the rows
  reorder by its value.
- [ ] Pick a numeric one (`node.alpha.kubernetes.io/ttl`): `5` sorts before
  `30`, not after it.
- [ ] Click the same key again: the direction flips.
- [ ] Nodes that do not carry the chosen annotation sit at the bottom when
  sorting descending.
- [ ] Sort by an annotation, then hide the column: the sort falls back to a
  column that is still on screen rather than staying on a hidden one.
- [ ] Reorder the columns with an annotation sort active: the header stays
  marked.

## Reading and filtering

- [ ] Click `N annotations`: a popover lists every key with its value beneath
  it, and scrolls when there are many.
- [ ] It is never cut off, opens upwards when there is no room below, and
  follows the button while the table scrolls.
- [ ] `Escape` and a click outside close it; clicking it does **not** open the
  node.
- [ ] Click an entry: the filter box fills with `key=value` and the list
  narrows to the nodes carrying it.
- [ ] Type part of an annotation value into the filter box with the column
  shown: the matching nodes are found. (This could not work before 2.19.0.)
- [ ] Hide the column and search for the same text: it no longer matches, since
  the filter searches the columns on screen.

## Nothing else moved

- [ ] The columns menu and the labels `+N` popover open, dismiss and follow
  exactly as before - all three now share one hook.
- [ ] Label chips still filter the list, and Roles is still its own column.
- [ ] The node drawer's Labels and annotations section is unchanged.
- [ ] Sorting by Usage on Nodes, Pods and Namespaces still offers CPU / RAM /
  Disk and behaves as before.
- [ ] Sorting, filtering, paging and column resize on tables that have no
  annotations column at all.
- [ ] Connect and disconnect a cluster, and run an LLM analysis on a pod: both
  behave as in 2.18.0.
- [ ] Help and About report **2.19.0**.
