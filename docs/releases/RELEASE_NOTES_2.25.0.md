# KubeDeck 2.25.0 release notes

An addition to the Nodes table, a fix to every table, the open cluster named
above the resource tree, and changes to Settings and to adding a cluster. Node-only ownership
stays at Node 59 / Python 0, and no route changed.

## Node pressure in the Status column

A node under memory pressure is still Ready, and the Status column printed only
"Ready" - so it looked exactly like a healthy node.

- Every node condition other than Ready that is True - MemoryPressure,
  DiskPressure, PIDPressure, NetworkUnavailable - is shown in amber, first.
- Ready follows in green, or NotReady in red; a cordoned node ends with
  SchedulingDisabled in amber.
- Hovering a word shows the condition's reason and message from the kubelet,
  and the table filter matches them, so "MemoryPressure" or
  "KubeletHasInsufficientMemory" finds the affected nodes.

## Column choices survive a restart

One table serves every resource tab, and switching tabs changed only the key its
column preferences were stored under. The widths, order and hidden columns on
screen stayed those of the tab the table had opened on, and were then saved
under the new tab's key - so what a tab was left with was overwritten by another
tab's choice, and a restart brought back the wrong set.

- Each tab now reads its own widths, order and hidden columns when it opens.
- A column shown or hidden just before switching tabs is written under the tab
  it was changed on, instead of being dropped with the pending save.

## Settings: the Save button stays in view

The Save button sat halfway down the Settings form, under the LLM section, out
of sight after a change to the theme or the language at the top.

- Title and Save now sit in a bar pinned to the top of the form, which stays in
  view while the form scrolls and says **Unsaved changes** when there are some.
- Leaving Settings with changes not saved - from the sidebar, a workspace tab, a
  cluster in the rail or the command palette - asks before discarding them.
  Putting a value back the way it was is not a change.

## Adding a cluster

- The kubeconfig picker opens in the folder the previous kubeconfig was picked
  from. The folder is kept in `dialog-state.json` beside `config.json`; a
  folder that no longer exists is not offered.
- A new cluster is named after the cluster in its kubeconfig
  (`clusters[].name`): the one the current context points at, else the first
  one listed. A file that names no cluster, or does not parse, still goes by its
  file name, and the name can be changed as before.

## The open cluster, named where you work

The rail has room for two letters, and its tooltip said only the name - for
clusters built with kubeadm, "kubernetes" every time.

- The top of the sidebar shows the open cluster: its avatar in the rail's colour
  and its full name, in place of the product name. A click opens the cluster's
  menu. With the sidebar collapsed to icons, only the avatar remains.
- The rail's right-click menu and that menu offer the same actions: connect,
  disconnect, rename, edit kubeconfig, settings, and remove - the last set apart
  and in red. Editing the kubeconfig no longer needs a trip to Settings.
- A cluster's tooltip names its API server under its name. The server is read
  from the stored kubeconfig when the config is served, and never saved.
- On import, a generic cluster name - `kubernetes`, `default`, `local`,
  `cluster`, `k3s-default` - is replaced by the API server's host.

## Settings layout

- The cluster cards were one row: four text buttons took the width and left the
  name a column a few letters wide, with the order arrows drawn over it. The
  name and kubeconfig path now take the first line, with the arrows; the actions
  sit under them, Remove apart on the right.
- The Settings column is wider: 960px, up from 720px.
- "Stored locally on this Mac" said the wrong thing on Windows and Linux; it now
  says "this computer".

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **277 tests**, up from 269: each tab keeps its own
  columns across a switch and a change made just before switching is saved; a
  node under pressure shows it beside Ready; the settings save bar comes first,
  and a change is reported as unsaved until it is put back or the panel goes;
  the rail menu renames, edits the kubeconfig, opens settings and removes; the
  tooltip names the API server; the sidebar names the open cluster and opens the
  same menu
- `npm --workspace apps/desktop run test:gateway` - **184 tests**, up from 182:
  an imported kubeconfig is named after its cluster, or its server's host when
  the name is generic; the config names each cluster's server without storing
  it; the picker's last folder is
  remembered and forgotten once gone. The node list test now checks the
  conditions a node row carries
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.25.0`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.25.0.md](./REGRESSION_CHECKLIST_2.25.0.md).
