# KubeDeck 2.18.0 regression checklist

Node labels and annotations. The automated gates below ran and passed during
development, and the table cells and the drawer section were both rendered
against the application's own stylesheets with a real k3s node's labels and
annotations before release.

Earlier 2.13.x, 2.14.0, 2.15.x, 2.16.x and 2.17.0 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## Roles

- [ ] Open **Nodes**: a **Roles** column sits between Status and Usage, reading
  `control-plane`, `worker` and so on - never `Role: true`.
- [ ] A control-plane node's chip is picked out from the others.
- [ ] A node with no role label leaves the cell empty rather than showing
  something meaningless.
- [ ] Sort by Roles, and filter the table by `control-plane`.
- [ ] No role appears among the label chips any more.

## Label chips

- [ ] Labels a human set (`team`, `gpu`, a vendor's own) come first; zone and
  instance type follow; OS and architecture only when there is room.
- [ ] Two chips are shown and their values are readable in full, not cut after
  three characters.
- [ ] Click a chip: the filter box fills with `key=value` and the list narrows
  to the nodes carrying it. **The node does not open.**
- [ ] Click anywhere else in the row: the node opens as before.
- [ ] Clear the filter: every node is back.

## The +N popover

- [ ] Click `+N`: a popover lists every label as `key=value` in monospace.
- [ ] It is never cut off, on a cluster with two nodes as much as on one with
  fifty, and it opens upwards when there is no room below.
- [ ] It follows the button when the window is resized or the table scrolls.
- [ ] Click a row in it: the list is filtered by that label and the popover
  closes.
- [ ] `Escape` and a click outside both close it.
- [ ] A node with two labels or fewer shows no `+N` at all.

## Labels and annotations in the drawer

- [ ] Open a node: a **Labels and annotations** section is on its Summary.
- [ ] Keys are complete - no `flannel.alpha.coreos.c…` - and a long key wraps.
- [ ] Groups are named by the domain in front of the slash; what has no domain,
  or somebody else's, is open, and the `*.kubernetes.io` groups start collapsed.
- [ ] Expand a collapsed group and collapse it again.
- [ ] Type in the section's filter: labels and annotations both narrow, groups
  holding matches open, and the counter reads `n of N`.
- [ ] An annotation with a long value (flannel's backend data, k3s node args)
  is cut with a **More** button that shows the rest, and **Less** puts it back.
- [ ] `kubectl.kubernetes.io/last-applied-configuration` is **not** listed -
  and it is still in the YAML tab.
- [ ] Copy the labels, then the annotations: the clipboard holds one
  `key=value` per line.
- [ ] Open a node with no annotations: only the Labels block is shown.
- [ ] Open a Pod, a Deployment and a Service: none of them shows the section.

## Nothing else moved

- [ ] The columns popover still opens whole and behaves as in 2.15.2 - it now
  shares its placement code with the labels popover.
- [ ] Node Usage bars, Cordon / Uncordon / Drain, and SSH all behave as before.
- [ ] Sorting, filtering, column reorder and resize on every other table.
- [ ] The pagination bar is still at the bottom of the window.
- [ ] Switch themes, light included: the chips, the popover and the section all
  repaint.
- [ ] Connect and disconnect a cluster, and run an LLM analysis on a pod: both
  behave as in 2.17.0.
- [ ] Help and About report **2.18.0**.
