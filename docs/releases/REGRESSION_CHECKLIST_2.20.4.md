# KubeDeck 2.20.4 regression checklist

`App.tsx` split into seven modules. Every one of them is a move: the same JSX
and the same effects, reached through props instead of closures. Nothing about
what the application does was meant to change.

That makes this a "nothing moved" pass, but a wide one - the extracted pieces
are the shell itself, so almost every screen touches at least one of them. The
two places to look hardest are **navigation** (which tab and namespace scope a
section opens with) and the **lazy panels**, since their chunk boundaries moved
file.

Earlier 2.13.x through 2.20.3 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (93 tests)
- [x] `npm --workspace apps/desktop run test:gateway` (146 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**
- [x] All eight lazy chunks still built separately, unchanged in size

## Navigation: which tab, which namespace scope

This is `useSectionNavigation`, and it is where a mistake would hide. For each
section: click it in the sidebar and check both the tab it opens **and** what
the namespace selector shows.

- [x] **Nodes** → the nodes table, selector shows cluster-scoped and is disabled.
- [x] **Namespaces** → namespaces table, cluster-scoped.
- [x] **CRDs** → CustomResourceDefinitions, cluster-scoped.
- [x] **Workloads** → pods, and the namespaces you had chosen come back.
- [x] **RBAC** → service accounts, namespaces come back.
- [x] **Network** → services, namespaces come back.
- [x] **Storage** → persistent volume claims, namespaces come back.
- [x] **Config** → config maps, namespaces come back.
- [x] **Events** → events, namespaces come back.
- [x] **Overview** → namespaces come back (it has no table of its own).
- [x] Pick a specific namespace, go to Nodes, come back to Workloads: **that
  namespace is selected again**, not "all".
- [x] Do the same after switching clusters and back: each cluster remembers its
  own selection.
- [x] Expand and collapse each sidebar group; the state survives a restart.
- [x] Expand a CRD **API group**, open one of its resources; the group stays
  expanded and survives a restart.
- [x] Open **Port forwards** from under Network: the section opens and the
  drawer closes.
- [x] With unsaved YAML in the drawer, click another section: the discard
  prompt appears, and cancelling leaves you where you were.

## The lazy panels

Each should appear with the brief loading state and no flash of an error.

- [x] Overview, Help, About, Settings, Problems, Port forwards.
- [x] A resource drawer, and a Pod Terminal in the bottom workspace.
- [x] Switch between two of them repeatedly: no panel gets stuck loading.
- [x] A placeholder section (one with no table yet) still shows its placeholder.

## The shell

- [x] Cluster rail sits left of the resource tree; selecting, connecting,
  disconnecting and importing all behave as in 2.20.3.
- [x] Drag the **sidebar** edge to resize; the width survives a restart.
- [x] Drag the **drawer** edge to resize; the width survives a restart.
- [x] Namespace selector, global search and Ctrl+K command palette.
- [x] Backend and kubectl status line reads as before.
- [x] The resource tab strip appears only when there is more than one tab.

## The resource workspace

- [x] Open a row: the drawer appears in the right column.
- [x] Pin rows with double click, up to the tab limit; close tabs.
- [x] A tab still loading shows its status line with a working **Retry**.
- [x] Switching drawer tabs remembers the choice per resource kind.
- [x] Start a port forward from the drawer: it jumps to Port forwards.
- [x] Open a Pod Terminal and a Node SSH session from the drawer.
- [x] Delete a pod from the drawer's Related tab.
- [x] Cordon and uncordon a node from the drawer.

## Nothing else moved

- [x] The pods table's **usage column** keeps updating while the table sits
  still (this is `usePodUsageRefresh`): watch a busy pod for a minute without
  refreshing.
- [x] The drawer's usage panel and the table agree about the same pod.
- [x] Bulk delete and its confirmation; rename and disconnect modals.
- [x] Global Search opens the right object from a hit.
- [x] Run an **LLM** analysis on a pod: no Secret value or log line reaches the
  prompt.
- [x] Switch themes and languages.
- [x] Help and About report **2.20.4**.
