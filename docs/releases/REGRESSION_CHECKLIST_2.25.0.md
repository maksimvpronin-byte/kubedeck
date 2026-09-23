# KubeDeck 2.25.0 regression checklist

2.25.0 shows node pressure in the Nodes table's Status column, makes each table
keep its own columns across tab switches and restarts, pins the Settings save
button, names the open cluster above the resource tree with a menu, and names
and locates imported kubeconfigs better. Node-only ownership
is unchanged at Node 59 / Python 0, and no route changed.

Earlier 2.13.x through 2.24.5 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (277 tests, up from 269)
- [x] `npm --workspace apps/desktop run test:gateway` (184 tests, up from 182)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.25.0`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Nodes - Status column

- [ ] A healthy node shows a green **Ready** and nothing else.
- [ ] A node with MemoryPressure (or DiskPressure / PIDPressure) shows it in
  amber before a green Ready; hovering it shows the kubelet's reason and
  message.
- [ ] A NotReady node shows a red **NotReady**.
- [ ] A cordoned node ends with an amber **SchedulingDisabled**; uncordoning
  removes it.
- [ ] Typing `MemoryPressure` in the table filter leaves only the nodes under
  memory pressure.
- [ ] The node drawer still shows the Pressure fact.

## Columns

- [ ] Hide a column on Nodes, switch to Pods: Pods shows its own columns, not
  the Nodes choice.
- [ ] Back on Nodes, the hidden column is still hidden.
- [ ] Change columns on two tabs, restart the app: each tab opens with its own
  columns, widths and order.
- [ ] Hide a column and switch tabs immediately: the change is kept.
- [ ] Reset columns on one tab does not touch another.

## Settings

- [ ] The title and **Save settings** sit at the top of Settings and stay in view
  while scrolling to the SSH and LLM sections.
- [ ] Change the refresh interval: **Unsaved changes** appears; put it back and
  it goes.
- [ ] With a change not saved, click another section in the sidebar: a question
  appears. Cancel keeps Settings with the change; OK leaves and the change is
  gone on return.
- [ ] Same from a workspace tab and from the command palette.
- [ ] Save, then leave: no question.

## Adding a cluster

- [ ] Add a cluster from a kubeconfig in some folder; add another: the picker
  opens in that folder.
- [ ] Restart the app and add a cluster: the picker still opens there.
- [ ] A kubeconfig with `clusters: - name: k8s1-prod` is listed as
  **k8s1-prod**, not by its file name.
- [ ] A kubeconfig with several clusters is listed under the current context's
  cluster.
- [ ] Renaming a cluster still works.

## Open cluster and cluster menu

- [ ] With a cluster open, the top of the sidebar shows its avatar and full
  name; a long name ends with an ellipsis and the tooltip has it whole.
- [ ] A click on it opens the menu; Connect is off while connected. Rename,
  Edit kubeconfig, Settings and Remove each do what they say.
- [ ] Right-click a cluster on the rail: the same items, Remove in red.
- [ ] Hover a cluster on the rail: the tooltip shows its name, API server and
  state.
- [ ] With the window narrower than 1100px the sidebar collapses to icons and
  the header shows only the avatar.
- [ ] Import a kubeadm kubeconfig (`name: kubernetes`): it is listed under the
  API server's host.

## Settings layout

- [ ] The cluster cards show name and path in full on the first line, arrows on
  the right, actions under them; nothing overlaps at any window width.
- [ ] Local activity says "stored locally on this computer".

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.24.5 installer build offers 2.25.0 and installs it.
- [ ] Help and About report **2.25.0**.
