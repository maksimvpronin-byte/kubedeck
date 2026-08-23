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

- [ ] **Nodes** → the nodes table, selector shows cluster-scoped and is disabled.
- [ ] **Namespaces** → namespaces table, cluster-scoped.
- [ ] **CRDs** → CustomResourceDefinitions, cluster-scoped.
- [ ] **Workloads** → pods, and the namespaces you had chosen come back.
- [ ] **RBAC** → service accounts, namespaces come back.
- [ ] **Network** → services, namespaces come back.
- [ ] **Storage** → persistent volume claims, namespaces come back.
- [ ] **Config** → config maps, namespaces come back.
- [ ] **Events** → events, namespaces come back.
- [ ] **Overview** → namespaces come back (it has no table of its own).
- [ ] Pick a specific namespace, go to Nodes, come back to Workloads: **that
  namespace is selected again**, not "all".
- [ ] Do the same after switching clusters and back: each cluster remembers its
  own selection.
- [ ] Expand and collapse each sidebar group; the state survives a restart.
- [ ] Expand a CRD **API group**, open one of its resources; the group stays
  expanded and survives a restart.
- [ ] Open **Port forwards** from under Network: the section opens and the
  drawer closes.
- [ ] With unsaved YAML in the drawer, click another section: the discard
  prompt appears, and cancelling leaves you where you were.

## The lazy panels

Each should appear with the brief loading state and no flash of an error.

- [ ] Overview, Help, About, Settings, Problems, Port forwards.
- [ ] A resource drawer, and a Pod Terminal in the bottom workspace.
- [ ] Switch between two of them repeatedly: no panel gets stuck loading.
- [ ] A placeholder section (one with no table yet) still shows its placeholder.

## The shell

- [ ] Cluster rail sits left of the resource tree; selecting, connecting,
  disconnecting and importing all behave as in 2.20.3.
- [ ] Drag the **sidebar** edge to resize; the width survives a restart.
- [ ] Drag the **drawer** edge to resize; the width survives a restart.
- [ ] Namespace selector, global search and Ctrl+K command palette.
- [ ] Backend and kubectl status line reads as before.
- [ ] The resource tab strip appears only when there is more than one tab.

## The resource workspace

- [ ] Open a row: the drawer appears in the right column.
- [ ] Pin rows with double click, up to the tab limit; close tabs.
- [ ] A tab still loading shows its status line with a working **Retry**.
- [ ] Switching drawer tabs remembers the choice per resource kind.
- [ ] Start a port forward from the drawer: it jumps to Port forwards.
- [ ] Open a Pod Terminal and a Node SSH session from the drawer.
- [ ] Delete a pod from the drawer's Related tab.
- [ ] Cordon and uncordon a node from the drawer.

## Nothing else moved

- [ ] The pods table's **usage column** keeps updating while the table sits
  still (this is `usePodUsageRefresh`): watch a busy pod for a minute without
  refreshing.
- [ ] The drawer's usage panel and the table agree about the same pod.
- [ ] Bulk delete and its confirmation; rename and disconnect modals.
- [ ] Global Search opens the right object from a hit.
- [ ] Run an **LLM** analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Switch themes and languages.
- [ ] Help and About report **2.20.4**.
