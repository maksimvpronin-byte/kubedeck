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

## Polishing

Five passes over the new work and the code around it, each finding up to five
problems and fixing them.

Bugs:

- The settings form was reset whenever the config was fetched again - which
  importing, renaming or opening a cluster from Settings all do - and unsaved
  edits vanished. It is now reset only when the saved settings change.
- Unsaved settings were asked about when nothing left Settings (opening a
  cluster from the rail). The question now comes only when the section changes.
- A workspace tab whose cluster failed to open stayed on "loading" for good. It
  is marked unavailable.
- Every failed cluster open, and a refused cluster removal, escaped as an
  unhandled rejection; the removal also showed nothing. Both are on screen now.
- Reorder, import and rename answered without the API server, so the rail's
  tooltips lost it after a drag.
- The tab strip above a table did not move ClusterRoles and ClusterRoleBindings
  to the _cluster scope the tree uses; it now takes the tree's path.
- Enter in the rename field could send a second rename while the first was out.

Rough edges:

- A filter typed on one resource tab emptied the next; each tab starts clean.
- Nodes sorted by Status put a node under pressure among the healthy ones.
- The cluster menu could run off the bottom of the window.
- Save settings reported "Settings saved" for a no-op; it is disabled instead.
- Settings cluster cards showed KubeDeck's UUID-named kubeconfig copy; they show
  the API server, with the path in the tooltip.
- The same kubeconfig imported twice got the same name; the second is " (2)".
- The YAML-discard and remove-cluster confirmations were English only.

Removed:

- 746 lines of CSS for classes no component renders (92 rules, 227 selectors).
- 34 translation keys nothing reads, from both locales.
- 15 byte-identical copies of `isRecord` in the backend; one is left.
- `aggregateSourceCacheSize`, `defaultSortKeyForColumn`, `formatAgeAgo`, and
  an unreachable English confirm in `removeCluster`.
- Raw NUL bytes in three backend sources are written as `\u0000` escapes, so
  the files are no longer binary to grep.

## Polishing, second pass

Five more passes, over data hooks, the backend, the drawer, its tabs and the
overview panels. The backend held up - kubectl processes, caches and cluster
removal were already sound - so most of what was found is in the renderer.

Bugs:

- **Security:** the drawer is not remounted when another Secret is selected. A
  value revealed on one Secret stayed on screen under the next until that one
  loaded - for good if it could not be read - with its auto-hide timer already
  cleared, and Copy would have copied it and audited the wrong Secret.
  Everything revealed or being edited is now dropped on the switch.
- An LLM analysis that answered after the drawer moved on put its answer under
  the new object and switched off the new analysis's spinner; an open prompt
  preview stayed with the next object.
- The overview kept the previous cluster's or scope's numbers until the next
  arrived, and called them stale if that load failed. Problems did the same
  with the previous cluster's list and kept its namespace and kind filters.
- Problems and Port forwards showed a failure twice - in their panel and on the
  banner - and their polls cleared the banner on every success. The overview
  and the watch status poll cleared it too; each now clears only its own error.
- Problems' error blinked off and on with every silent poll; copying a problem
  or a port-forward URL with the clipboard refused was an unhandled rejection,
  and the port-forward panel said "Copied" regardless.

Rough edges:

- The drawer header, tabs, action buttons and confirmation dialogs, the log
  viewer, the port-forward panel and the terminal limit are translated.
- A node's conditions are shown in the drawer's summary as on the table.
- Cached node disk readings go on the table in one update, not one per node;
  the overview's refresh is no longer rebuilt after every answer.

Removed and guarded:

- Unused props (ProblemsPanel's and PortForwardsPanel's onError) and
  unreachable entries in supportedActions.
- A release contract rejects any raw control character in the sources.

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **288 tests**, up from 269: each tab keeps its own
  columns across a switch and a change made just before switching is saved; a
  node under pressure shows it beside Ready; the settings save bar comes first,
  and a change is reported as unsaved until it is put back or the panel goes;
  the rail menu renames, edits the kubeconfig, opens settings and removes; the
  tooltip names the API server; the sidebar names the open cluster and opens the
  same menu; settings edits survive a config reload and Save is off with
  nothing to save; a tab of an unreachable cluster stops loading; a filter does
  not follow to the next tab; nodes sort on their conditions; the cluster menu
  is moved back inside the window; a revealed Secret is dropped when another
  is selected; a late LLM answer is not shown for the next object; overview and
  problems drop the previous cluster's data; polls clear only their own error;
  sources carry no raw control characters
- `npm --workspace apps/desktop run test:gateway` - **184 tests**, up from 182:
  an imported kubeconfig is named after its cluster, or its server's host when
  the name is generic, and " (2)" when it is taken; the config and a reorder
  name each cluster's server without storing it; the picker's last folder is
  remembered and forgotten once gone. The node list test now checks the
  conditions a node row carries
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.25.0`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.25.0.md](./REGRESSION_CHECKLIST_2.25.0.md).
