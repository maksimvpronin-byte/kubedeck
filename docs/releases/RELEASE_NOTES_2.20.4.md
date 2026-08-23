# KubeDeck 2.20.4 release notes

Internal cleanup. No behaviour change, no route changes. Node-only ownership
stays at Node 58 / Python 0.

## What moved

`App.tsx` was 1028 lines: about 525 of orchestration between hooks, and one
JSX return of 416. It is 691 now, and its `return` reads as a list of the
things on screen - cluster rail, sidebar, topbar, tabs, section router,
resource workspace, terminal panel, and the three modals.

Seven modules came out of it:

```
221  components/AppSectionRouter.tsx     which surface a section shows
 94  components/AppSidebar.tsx           the resource tree, CRDs grouped by API group
 87  components/AppResourceWorkspace.tsx the right column: tabs and the drawer
 73  components/AppTopbar.tsx            namespace scope, search, status line
 22  components/LazySurface.tsx          the boundary every lazy panel mounts through
173  hooks/useSectionNavigation.ts       what a section opens with
 65  hooks/usePodUsageRefresh.ts         keeping the pods usage column current
```

Nothing changed about what any of them does.

## Two of those were not in the plan

The plan named the sidebar and the router. Those two come to about 205 lines,
which was not enough to get under 700, so three more seams had to be real ones.
They were:

**`useSectionNavigation`.** `selectSection` alone was 68 lines. Picking a
section has never been "show this section" - it also decides which tab opens
and in which namespace scope, because a cluster-scoped section has to switch
the selector to `_cluster` and leaving one has to put back the namespaces
chosen for that cluster. The same `if (selectedNamespaces.includes("_cluster"))
restoreNamespacedSelection()` appeared seven times and is now one named helper.

**`usePodUsageRefresh`.** The effect that refreshes the pods table's usage
column from already-recorded samples, with its interval constant and its
explanation of why it exists at all.

**`AppTopbar`.** Namespace selector, global search, status line.

## What it cost

The main bundle grew from 331.28 kB to 335.33 kB (gzip 101.91 → 102.90). That
is not a lazy chunk that moved: all eight are still separate and the same size
- `HelpPanel` 2.90 kB, `PortForwardsPanel` 3.18, `AboutPanel` 5.09,
`OverviewPanel` 11.11, `ProblemsPanel` 11.58, `SettingsPanel` 30.41,
`PodDrawer` 88.21, `BottomTerminalPanel` 363.96. It is the new modules
themselves: module boundaries and props where there used to be closures. About
1 kB gzipped, for an `App.tsx` that can be read.

## Six tests broke, and that was the point

Splitting a file that fifteen tests read the source of broke six of them - the
first real demonstration of what 2.20.3 measured when it found that 50 of the
93 renderer tests assert on source text rather than behaviour.

Not one assertion stopped being true. They were looking in `App.tsx` and the
subject had moved. Each was repointed: `function LazySurface` at
`components/LazySurface.tsx`, `<OverviewPanel>` and `{activeCluster &&
activeClusterConnected ? (` at `components/AppSectionRouter.tsx`,
`POD_USAGE_REFRESH_MS` and the aligned interval at
`hooks/usePodUsageRefresh.ts`, the topbar check at `components/AppTopbar.tsx`,
and "the rail sits left of the resource navigation" now compares against
`<AppSidebar>` instead of `<aside className="sidebar">`.

A behavioural test would have needed none of those edits.
