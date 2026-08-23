## 2.20.6 - Internal cleanup: table cells and problem classification get their own files

No behaviour change. No route changes. Node-only ownership stays at Node 58 /
Python 0.

`ResourceTable.tsx` was 629 lines, exactly half of it cells that nothing
outside the table ever used - the table body reached all of them through one
function. It is 327 now, over `resourceTable/UsageCells.tsx` (139),
`resourceTable/rowStatus.ts` (95, the pure helpers), `resourceTable/
StatusCells.tsx` (51) and `resourceTable/formatCell.tsx` (33).
`ProblemsPanel.tsx` was 578 and is 232, over `ProblemsPanelParts.tsx` (215, the
five sub-components) and `problemsModel.ts` (141, the classification).

`formatCell` was meant to stay in the table as its dispatcher, but it dragged
along five imports only it needed; in its own file the cell folder is
self-contained and the table imports one name.

Splitting these broke six tests. Five were repointed at the files their subject
moved to - thirteen source-text assertions have now been edited purely because
code moved. The sixth was replaced: a regex over the table's source asserting
that a container which is merely not ready reads as pending rather than as a
failure is now six calls to `containerTone(...)` with the answers written out.

The pure functions being importable also made room for 16 new behavioural
tests. `problemsModel.ts` gets 10: classification from an explicit category and
from the row's own text, severity ordering, guidance grouping capped at four,
the locator that opens the object a problem is about rather than the event that
reported it, the clipboard diagnostic, row keys, filter deduplication.
`rowStatus.ts` gets 6: which problem a health reason names first, trimming to
the first clause and to 72 characters, container cubes from states and from
bare names, CPU and byte formatting, and the request percentage that rounds but
does not clamp. The renderer suite goes from 93 to 109 tests, and the share
that only greps source text drops from 54% to 46%.

One new test failed first run - the expectation was wrong, not the code:
`problemOpenLocator` builds a stable uid even for a row with no separate
target, because a problem row carries no Kubernetes uid of its own.

Sixth of the sections in `docs/file-structure-refactor-plan.md`.

## 2.20.5 - Internal cleanup: the drawer's tab bodies leave PodDrawer

No behaviour change. No route changes. Node-only ownership stays at Node 58 /
Python 0.

`PodDrawer.tsx` was 551 lines with 17 `useState` and no local helpers at all.
It is 390 now, with 11. Two modules came out: `components/PodDrawerTabBody.tsx`
(211 lines, the `tab === …` chain and the CRD notices) and
`hooks/usePodDrawerLlm.ts` (39). Seven of the seventeen states were the LLM
tab's - loading, error, answer, model, elapsed time, context size, truncation -
along with their reset, which had been sitting inside the drawer's general
per-object reset effect. They are one hook now, and the reset lives where the
state does: an analysis belongs to the object it was run against, so moving to
another object clears it.

Lifting the tab chain out naively would have taken about fifty props, since it
reads nearly everything the drawer gets from its four hooks. Instead the
component takes those bundles whole - `lifecycle`, `logs`, `yamlActions`, `llm`
- typed as `ReturnType<typeof usePodDrawerX>`. The hooks already define
cohesive groups, so handing one over as a single value is more honest than
restating forty names: 25 props instead of ~50, and no new types. The drawer no
longer destructures `logs` at all, or half of `lifecycle`.

The tab body landed in the drawer's own chunk rather than the main bundle:
PodDrawer 88.21 → 89.27 kB, index unchanged at 335.33 kB.

The plan asked for 320 lines and this stops at 390. The remaining 70 are modal
state, the action handlers and the header with its six modals - the drawer
itself, not another chain to lift. Splitting further would mean a component per
modal.

Two more grep contracts needed repointing, bringing the running total to eight
source-text assertions edited purely because code moved - the cost 2.20.3 put a
number on.

Fifth of the sections in `docs/file-structure-refactor-plan.md`.

## 2.20.4 - Internal cleanup: App.tsx stops being the whole shell

No behaviour change. No route changes. Node-only ownership stays at Node 58 /
Python 0.

`App.tsx` was 1028 lines - about 525 of orchestration between hooks and one
JSX return of 416. It is 691 now, and its `return` reads as a list of what is
on screen: cluster rail, sidebar, topbar, tabs, section router, resource
workspace, terminal panel, three modals. Seven modules came out of it:
`components/AppSectionRouter.tsx` (221 lines, which surface a section shows),
`components/AppSidebar.tsx` (94, the resource tree with CRDs grouped by API
group), `components/AppResourceWorkspace.tsx` (87, the right column),
`components/AppTopbar.tsx` (73), `components/LazySurface.tsx` (22),
`hooks/useSectionNavigation.ts` (173) and `hooks/usePodUsageRefresh.ts` (65).

Two of the hooks were not in the plan. The sidebar and the router come to about
205 lines, not enough to get under 700, so three more seams had to be real
ones. `selectSection` alone was 68 lines: picking a section has never been
"show this section", it also decides which tab opens and in which namespace
scope, and the same `if (selectedNamespaces.includes("_cluster"))
restoreNamespacedSelection()` appeared seven times. `usePodUsageRefresh` is the
effect that keeps the pods table's usage column current from recorded samples.

Code splitting is intact: all eight lazy chunks are still separate and the same
size. The main bundle grew from 331.28 kB to 335.33 kB (gzip 101.91 → 102.90) -
not a chunk that moved, but the new modules themselves, module boundaries and
props where there used to be closures.

Six tests broke, which was the point. 2.20.3 measured that 50 of the 93
renderer tests assert on source text rather than behaviour; splitting a file
fifteen of them read proved what that costs. Not one assertion stopped being
true - they were looking in `App.tsx` and the subject had moved - and each was
repointed at the file it moved to. A behavioural test would have needed none of
those edits.

Fourth of the sections in `docs/file-structure-refactor-plan.md`.

## 2.20.3 - Internal cleanup: the renderer test junk drawer is sorted

No application code changed at all - `apps/desktop/src` is byte-identical to
2.20.2. No route changes. Node-only ownership stays at Node 58 / Python 0.

`tests/renderer-controllers.contract.test.cjs` was the largest file in the
repository: 2581 lines, 93 tests, 189 `readFileSync` calls, with themes,
namespace selection, manifest compare, SSH, the cluster rail, pagination, watch
coalescing, bulk actions, workspace tabs, drawer lifecycle and async action
feedback all sharing it. It is now twelve domain files - `theme`,
`namespace-selection`, `resource-table`, `workspace-tabs`, `bulk-actions`,
`drawer-lifecycle`, `yaml-editor`, `resource-usage`, `watch-and-loading`,
`resource-detail`, `release-surface` and the remainder under the original name
- over a shared `tests/helpers/renderer.cjs` holding `loadTypeScript`,
`resolveRendererModule` and the deterministic scheduler. Largest is 426 lines.
The same 93 tests pass, none rewritten, and `test:renderer` names all twelve
explicitly the way `test:gateway` already named its own.

The split doubled as an audit. Classifying all 93 by whether they execute
renderer code or only read a source file: 31 behavioural, 12 mixed, and 50 that
assert on source text alone. More than half the suite is a grep - a test that
breaks when a CSS class is renamed and passes straight through a real
regression. All 50 now carry `// grep contract: asserts on source text, not
behaviour.` in the code, and every file holding one explains what the marker
means. They were not rewritten here: this release is a move, and turning a grep
into a behavioural test changes what is being asserted.

Two gateway test files stay over 700 lines,
`resource-lists.contract.test.cjs` (798) and `llm.contract.test.cjs` (792).
They were never part of this section and are left alone.

Third of the sections in `docs/file-structure-refactor-plan.md`.

## 2.20.2 - Internal cleanup: the CSS hotfix layer stops being one

No user-visible change - not a colour, not a spacing, not a state. No route
changes. Node-only ownership stays at Node 58 / Python 0.

Three stylesheets still carried a header calling them a hotfix for 1.0.5 or
1.1.1: `drawer-controls-polish.css` (677 lines, 139 !important),
`related-panel-polish.css` (654 lines, 228 !important) and
`resource-summary-polish.css` (516 lines). Nine minor versions later, changing
anything about the drawer, the Related tab or a resource Summary still meant
guessing which of two files would win. They are now `drawer-controls.css`,
`related-panel.css` and `resource-summary.css`, the old 27-line
`related-panel.css` is merged into the first of those, and each begins with a
line about what it covers and why it loads where it loads. Seventeen
stylesheets instead of eighteen. 126 of the folder's 406 `!important`
declarations are gone.

Reading all eighteen with a parser, in the import order the renderer actually
uses, contradicted the assumption this patch started from.
`resource-summary-polish.css` was never an override layer: not one of its 75
selectors appears anywhere else, so there was nothing to fold it into.
`drawer-controls-polish.css` is barely one either - 213 selectors, 8 of them
shared - and folding it into `drawer.css` would have been a bug, because it
loads after `terminal.css` on purpose, to settle primary-button colours that
`terminal.css` also sets with `!important`. Only `related-panel-polish.css` was
a real layer, and that is the one that got merged.

280 of the 406 `!important` had to stay. `layout.css` declares `.primary {
background: ... !important }` at specificity 100, which forces every rule
wanting a different primary-button colour to use `!important` as well and then
settle it by specificity - the origin of selectors like `.pod-drawer
.drawer-content button.primary:not(.danger):not(.danger-button):hover`. Inside
the polish files, `!important` also holds their own ordering together, since
they were written `!important`-first. Removing everything not contested by
another file flipped 1044 cascade outcomes on the first attempt; untangling it
properly means reworking the button cascade application-wide, and is now
section H of the plan with its own release.

That nothing changed was established by comparing, for every pair of
declarations that set the same property and share a class in their selectors,
which one wins - 18211 pairs, zero flipped, zero gone, zero new. That reasons
about selectors rather than the DOM, which is why the regression checklist
walks the drawer, the Related tab and Resource Summary on all eight themes.

Second of the sections in `docs/file-structure-refactor-plan.md`.

## 2.20.1 - Internal cleanup: the resource normalizers become a directory

No user-visible change. No route changes. Node-only ownership stays at Node 58
/ Python 0.

`main/backend/resources/normalizers.ts` had grown to 926 lines around 25
exports - about twenty independent `xxxSummary(item)` functions, one per family
of Kubernetes resource, sharing a file only because that is where they were
first written. Two of those names were ever used from outside the file:
`normalizeResourceItems` and the `ResourceRow` type.

It is a directory now, one file per family - `pod`, `node`, `workload`,
`network`, `rbac`, `misc` - over a shared `primitives.ts` for reading a
manifest safely, with `index.ts` holding the resource-to-normalizer table. The
largest file is 216 lines instead of 926. The barrel re-exports exactly what
the single file exported, so not one import in `src/` changed.

Function bodies were copied, not edited: a normalizer that rounded a value one
way before rounds it the same way now. Two helpers moved next to their only
caller rather than into the shared primitives - `effectivePodResource` into
`pod.ts` and `formatBytesQuantity` into `node.ts`.

`tests/resource-lists.contract.test.cjs` required the compiled
`normalizers.js` directly and now points at `normalizers/index.js`, with the
same set of imported names. Note that `tsc` does not clean `dist/`, so a tree
built before this release keeps a stale `normalizers.js` beside the new
directory and CJS resolution prefers the file; delete it or build clean.

First of seven sections in `docs/file-structure-refactor-plan.md`.

## 2.20.0 - a Service says how to reach it

Working that out used to mean reading the type, the ClusterIP and the port list
and assembling the address in your head. A Service's Summary now carries a How
to reach it section: the cluster DNS name per port, the ClusterIP, the node
ports, every load balancer address and external IP, the name an ExternalName
answers with, and the kubectl port-forward line that reaches the Service from
the machine KubeDeck runs on. Every line is a button that copies it.

A scheme is written only where the port says what it speaks - by its name, by
appProtocol, or by being one of the numbers everybody uses for HTTP. A port
named http becomes http://web.shop.svc.cluster.local:80; a port named pg stays
postgres.data.svc.cluster.local:5432, because http:// in front of a database
port is an address that cannot work.

Nothing in the section is a link. A ClusterIP is not routable from your machine
and svc.cluster.local does not resolve on it, so a clickable link would be a
promise the application cannot keep - and KubeDeck only opens localhost URLs
anyway. The one genuinely openable address, a running port-forward's
http://127.0.0.1:..., is a link where it already was, in the Port forwards
panel.

An address two ports share - 53/UDP and 53/TCP are the usual pair - is printed
once, with both ports named beside it. A headless Service says its name
resolves to the pod addresses rather than to one address, and an ExternalName
shows the name and nothing else, since nothing else applies.

The gateway sent a Service's ports only as the string a table cell prints,
`http · 80 → 8080/TCP`, which no address can be built from; the pieces travel
now too.

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.19.0 - nodes sort by one chosen annotation

Sorting a table by "annotations" would compare every annotation joined into
one string, alphabetically by key, and on nodes the first key is the same on
every row - the order would not change. The Labels column already demonstrates
this: it sorts on a string that starts with beta.kubernetes.io/arch=amd64
everywhere. What sorts is one chosen annotation.

The Annotations column's header opens the menu the Usage column has had for
years, a list of what to sort by. A usage column's metrics are three known
numbers; annotation keys belong to the cluster, so the list is built from the
keys the loaded nodes carry, the ones on the most nodes first. Values compare
the way the rest of the table compares text, counting rather than spelling, so
a ttl of 5 sorts before 30, and a node without the annotation sits at the low
end - where a node without a usage reading already sits - so descending puts
those last.

The cell reads `8 annotations` and opens the popover the labels +N opens: every
key with its value beneath it, monospace, scrollable, in the page body so
nothing clips it. No chips - an annotation's value is a JSON document or a
command line and none of that reads at the width of a column. Clicking an entry
filters the list by key=value, and the table's filter box searches annotations
now; it could not before, because the filter only ever searched the columns on
screen and annotations had no column.

The column starts hidden, the first in KubeDeck to do so: most annotations are
written by the CNI and the cloud controller for themselves, and the column is
for the clusters where somebody put something in them worth sorting by. Reset
columns restores that default rather than showing everything.

The three popovers - the columns menu, the labels +N and this one - share one
hook that places them, dismisses them and keeps them attached to their button;
each carried its own copy of that effect before. The renderer's contract tests
also load relative imports for real now: a module that imported another
renderer module used to be handed an empty object for it, so anything it called
there was undefined at run time.

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.18.0 - node labels tell nodes apart, and annotations arrive

The Labels cell read `Role: true · Type: k3s · OS: lin… +1`, with everything it
hid stuffed into a native tooltip, and annotations reached the interface only
as raw YAML.

Roles are not labels. `node-role.kubernetes.io/control-plane` carries no value
or the value `true`, and the meaning is in the suffix of the key, so a chip
reading `Role: true` said nothing. Roles now have a column of their own, where
kubectl puts them, listing control-plane, worker and etcd as words; the
pre-1.16 `kubernetes.io/role` spelling is read too.

The labels that are shown are the ones that tell nodes apart. A label nobody
aliased is one somebody in this cluster chose, and it distinguishes a node in a
way `OS: linux` on every row never will, so those come first, then topology,
then the generic ones. Two chips instead of three: two read in full beat three
cut in half at the width of the column.

`+N` opens a popover rather than filling a tooltip - every label as key=value,
monospace, scrollable, rendered into the body so nothing clips it. Clicking a
label, in the cell or in the popover, filters the list by it, which turns
labels into a way to slice a node list; the row still opens from anywhere else
in it.

A node's Summary gained a Labels and annotations section that shows both in
full: complete keys, monospace values, nothing truncated, a long key wrapping
rather than ending in an ellipsis. Entries are grouped by the domain in front
of the slash - the one split that needs no curated list of interesting keys,
because it says who wrote the entry - with what somebody here set open and the
dozens Kubernetes and the CNI write for themselves collapsed. There is a filter
over both, copy per group, More for an annotation holding a whole JSON
document, and no last-applied-configuration, which is the object again and
already in the YAML tab.

Both popovers, this one and the columns menu, now place themselves through one
shared helper instead of two copies of the same arithmetic.

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.17.0 - a CronJob can be run by hand

Run now sits beside Delete in the CronJob drawer and starts one run
immediately. It does what kubectl create job --from=cronjob/<name> does: the
job template is copied out of the CronJob and one Job is created from it. The
schedule is not modified, the CronJob is not suspended, and the next scheduled
run happens as it would have anyway.

A Job needs a name of its own. The controller names its scheduled runs
<cronjob>-<unix-minute>; a manual run says so, and carries the second rather
than the minute, so two runs a few seconds apart cannot collide. A long
CronJob name is truncated to leave room for the suffix, because Kubernetes
takes a DNS-1123 label of at most 63 characters.

The name is fixed the moment the button is pressed rather than while the
confirmation is open, so the command in the preview is the command that runs -
the confirmation would not be worth reading otherwise. Running a CronJob is
treated as a mutating action and carries a typed confirmation, the way Restart,
Redeploy and Scale do.

Authorization is checked first with kubectl auth can-i create jobs in the
CronJob's namespace, so a missing permission is reported as a permission
problem rather than a raw kubectl failure, and the run is recorded in the audit
trail as resource.trigger carrying the name of the Job it created.

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.16.1 - the pagination bar sits at the bottom of the window

A resource table is a column: the header and the toolbar keep their height,
the rows take what is left and scroll, and the pagination bar keeps its height
at the bottom. That only works if the panel holding them fills the window, and
it did not - the rules meant to stretch it named .table-surface, an element an
earlier layout left behind and no component renders any more, so they matched
nothing.

With a namespace full of pods this was invisible, because the contents already
filled the window. On three CronJobs or five nodes the pagination bar ended up
a couple of centimetres below the title with the rest of the window empty
under it.

The rules now name the panel the layout actually has. The empty state moved
with it: there is nothing to scroll without rows, and a lone header row
holding the free space would have pushed "Nothing here yet" down beside the
pagination bar, so the message takes that space and sits centred in it.

This was also why the columns popover was cut off before 2.15.2 - the panel it
opened from ended just below the toolbar. That was fixed from the other side
by moving the popover out of the panel, and both fixes stand.

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.16.0 - a found match is highlighted, not selected

Typing a query in Find in YAML and pressing Enter jumped to the first match -
and moved the focus into the editor with that match selected. The second
Enter, the one meant to step to the next match, went to the editor rather than
the search box, and since 2.15.0 Enter in the editor inserts a newline. A
newline over a selection replaces it: the text just found was deleted and the
manifest was left dirty.

The match is no longer selected. The editor paints it as a decoration - visual
only, nothing a keystroke can replace. The caret does not move and the focus
stays in the search box, so Enter and Shift+Enter keep stepping through the
matches.

Every occurrence is tinted now, with the one being stepped to picked out by a
stronger fill and an outline. The highlight is recomputed from the draft on
every change, so it can never sit on text that has moved, and repainting never
scrolls - only an explicit jump does, and a jump still opens the fold hiding
its match. Stepping backwards from a fresh query lands on the last match
instead of skipping it.

The log viewer searches the same way. Its query still filters the lines and
Current view still downloads what the filter left, but the search gains the
counter, the arrows, Enter and Shift+Enter, and scrolls the current occurrence
into the middle of the pane. Every occurrence in a line is marked rather than
only the first. Both searches are one piece of code underneath, so the
counters count the same things in both tabs.

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.15.2 - the columns popover is no longer cut off

On Nodes it was cut off almost every time, because the list of columns is
longer than the list of nodes. The popover was positioned inside the resource
table panel, and that panel is only as tall as its own content: a namespace
full of pods fills the window and left room for the popover, three nodes did
not, and the panel clips what overflows it. Which columns were reachable
depended on how many rows the table happened to have.

position: fixed would not have escaped the clip either - the panel declares
container-type for its container queries, which makes it the containing block
for fixed children too - so the popover now renders into the document body and
is positioned from the rectangle of the button that opens it.

Outside the panel, the window bounds it instead: it opens upwards when there
is more room above, its height is capped to the space actually available with
the list scrolling inside it, it stays inside the window horizontally, and it
follows the button when the window is resized or the content behind it
scrolls. Escape closes it now, which it did not before.

The columns themselves are unchanged: same list, same order, reordering and
resizing in the header as before, the last visible column still cannot be
unchecked, and Reset columns still restores the default set.

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.15.1 - collapsing groups in the manifest diff expands again

Compare manifests computed its fold regions twice, once from each side, and
each copy carried its own key built from that side's line numbers. A block
present in both manifests therefore had two keys for one visible fold.

Collapse top-level groups added both. A chevron toggled one of them, the other
kept the rows hidden, and the chevron - reading only the key it toggled - had
already redrawn itself as open. The group looked expanded and stayed folded,
and only Expand all could recover it.

A fold is now the span of diff rows it covers rather than a side and a line
number, and the left and the right region of the same block merge into one
fold, the wider of the two. One key, one collapsed state, both panes reading
it.

Two smaller things fell out of the same rewrite. A fold no longer swallows the
rows after it: rows the other side added carry no line number here, and the
region scan kept absorbing them past the end of the block, so collapsing
metadata could hide an added line belonging to spec. And the chevron is drawn
only on the pane that has a line on that row, not beside a blank one.

Collapsed groups are forgotten when the compared resource changes, and a key
that no longer names a fold is dropped - Expand all used to stay enabled with
nothing left to expand.

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.15.0 - the YAML editor is CodeMirror now

Alt+drag selects a rectangle across lines, typing reaches every caret in it at
once, and undo takes the whole multi-caret edit back as one step. The old editor
was a textarea with a highlight layer behind it, and a textarea has exactly one
caret, so this needed the editor replaced rather than extended.

Tab had no handler at all before: pressing it in the YAML editor moved focus out
of the editor. It now shifts the indent of the selected lines, and Shift+Tab
shifts it back. Alt+Shift+arrows move lines, Ctrl+D duplicates, Ctrl+/ comments,
F3 and Shift+F3 step the toolbar's search from inside the text.

Folding moved into the editor, so the manifest is one document again instead of
several textareas split around each collapsed region with the chevrons
positioned by hand. Which groups are foldable is still decided by KubeDeck's own
YAML analysis, so Collapse top-level groups collapses exactly what it did
before. Highlighting comes from the Lezer YAML grammar rather than a
line-by-line regular expression, and still reads every colour from the
application's CSS variables, so a theme change repaints it.

The editor is a lazily-loaded chunk, fetched when a drawer or the kubeconfig
editor opens: it grows from about 2 KB to about 334 KB (109 KB gzipped).
CodeMirror, Lezer and their bundled transitive packages are MIT and are listed
in the third-party notices.

One behaviour is deliberately gone: with text in the Find in YAML box, Enter
inside the editor used to jump to the next match instead of inserting a newline,
so a query left in the box quietly blocked typing new lines. Enter in the editor
is a newline again.

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.14.0 - performance pass

A release about what KubeDeck stopped doing. The resource table repainted every
row of every column once a second, because the age column's clock was read at
the table level; the clock now lives in the age cell, is shared by every reader,
and compares the rendered text rather than the time, so a pod up for twelve days
is skipped entirely. The pod drawer ticked on every tab though only Summary
shows an age, re-rendering the terminal and the YAML editor for nothing.

Rows were sorted with `localeCompare` and an options object, which rebuilds the
collator behind every comparison: 217ms per sort of five thousand rows became
11ms with a cached `Intl.Collator`, in the identical order. Two values handed
to the table were rebuilt on every shell render and defeated its filter and sort
memoisation. The main process kept expired resource snapshots for the whole
session, because only a read swept them and the tables deliberately read live.

The one behavioural change: watch events are coalesced with a floor and a
ceiling, not only a settle time. Resetting a 350ms timer on every event meant a
cluster emitting them faster than that never reloaded at all - and the polling
fallback stays off while the socket is healthy - while a cluster just below that
rate got a full `kubectl get -A -o json` per event. Reloads are now at least one
second and at most three seconds apart under a stream of events, and unchanged
on a quiet cluster.

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.13.4 - Help and About describe the application again

The quick start still told people to pick a cluster in the top bar, which the
left rail replaced several releases ago. Help now also covers cluster
connection and what the rail badges mean, the LLM and Secret drawer tabs, the
usage history on a pod's Summary, the Overview, Port-forwards and Audit
sections, and Ctrl+K.

About had no licence in it. KubeDeck is Apache-2.0 and redistributes
third-party components, but both facts lived only in repository files that
someone running the portable exe does not have. A licensing card now carries
the licence, the copyright line quoted verbatim from NOTICE, and a pointer to
the third-party notices.

Copy diagnostics now reports whether each cluster is connected and the public
LLM status, which are the two things people were asked for and could not find.
The status shape carries no API key.

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.13.3 - Hide prompt no longer waits for the model

Opening the LLM prompt preview and then starting an analysis left the prompt
filling the tab with its own button greyed out until the answer arrived. The
button was tied to a flag shared with the analysis, but closing the preview
sets a boolean and returns without touching the network - only opening it has
anything to wait for. The button now waits on its own work alone, so closing is
always available and opening during a run is allowed.

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.13.2 - Things that were visible but not reachable

Terminal numbers were invisible on the light theme: only eight of the sixteen
ANSI colours were given to xterm, so the bright half stayed at xterm's own
dark-background defaults. `top` prints its summary values in bold white, xterm
renders bold in the bright colour, and that landed at 1.08:1 against the light
background. All sixteen slots are defined per theme now, and a test measures
the contrast rather than trusting the eye.

A resource path in the Problems panel broke one character per line. The panel
is sized by the drawer beside it, not by the window, and its responsive rules
were viewport media queries. It uses container queries now.

Find in YAML counted matches without going to them: the textarea stopped being
the scroll container when the folding editor arrived, so writing scrollTop on
it did nothing. The container is scrolled now, positioned by measuring the
line's own row.

`scripts/set-version.ps1` also left the pinned workspace dependency behind,
which failed the lock refresh with a 404.

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.13.1 - Saving settings no longer greys out the cluster rail

Pressing Save in Settings made every cluster badge go to the disconnected
colour while nothing was actually disconnected. `GET /config` and
`PUT /settings` both return a whole AppConfig, and only the first carried the
connection state - so saving settings replaced the interface's config with one
that had none. Both now go through a single builder, and an absent connection
list is treated as "not reported" rather than "nothing connected".

No route changes. Node-only ownership stays at Node 58 / Python 0.
## 2.13.0 - Clusters connect on request, and usage is read at source

Clusters no longer stay connected forever. Every cluster that had been opened
left a usage sampler and one `kubectl get --watch` process per viewed resource
kind running against it, and none of it stopped when the user moved on. The
rail now carries the switch: left click connects and opens, right click offers
Connect and Disconnect, and a ring says which state the cluster is in - green
connected, dim grey not connected, red for a failed connection. Disconnecting
releases watches, the sampler, port forwards, pod terminals, node SSH and the
cached snapshots, and keeps them released. Sessions someone may be using are
named and counted before they are closed.

Usage sampling now reads `/apis/metrics.k8s.io/v1beta1/pods` instead of the
table `kubectl top` prints, keeping nanocore precision and the scrape
timestamp. Sampling moves to 15 seconds to match `--metric-resolution`, and a
scrape already recorded is discarded so polling at that rate cannot count one
measurement twice. The chart gained a 15-second view of the last hour; every
percentile still comes from the five-minute grid covering 24 hours.

Adds `POST /clusters/{cluster_id}/disconnect`. Node-only ownership moves to
Node 58 / Python 0.
## 2.12.1 - The pod Usage column shows usage again

- Fixed the Usage column showing `N/A` for a pod that had usage, and keeping it. Three causes. A reading of zero was discarded: the store decided whether a metric was present by testing its sum against zero, so an idle pod reporting `0m` CPU had no CPU history at all. CPU and memory now carry their own sample counts, which also corrects their averages - metrics-server reports memory from its first scrape but needs two before it can derive a CPU rate, so a bucket can hold more memory readings than CPU ones, and dividing both by the shared count deflated whichever arrived late. Files written by 2.12.0 are migrated on load.
- The reported window came from bucket starts, which round down to five minutes, so a pod observed for 90 seconds was described as "5 min recorded". It now comes from real sample timestamps.
- The column never refreshed. The table is driven by watch events and a settled pod produces none, so the list was not reloaded and the column kept the values from the load that first showed the pod - for a pod created seconds earlier, none at all, while the age column ticked live and made the row look fresh. Adds `GET /clusters/{cluster_id}/pod-usage`, which returns current usage for the pods in scope entirely from samples already recorded and runs no kubectl command, so the table refreshes its numbers every 30 seconds without paying for the `kubectl get pods` half of a list reload. A row whose usage is unchanged keeps its identity, so a refresh that changes nothing does not re-render the table. Node-only ownership moves to Node 57 / Python 0.
- A row the list call returned no metric for is now filled from the most recent recorded sample, and only if it is under two minutes old, so a pod that stopped reporting goes back to blank instead of keeping its last reading.
- Recorded usage is written to disk before the awaited SSH, terminal, port-forward and watch teardown rather than after it: any of those rejecting used to skip the write and cost every sample since the last periodic flush.
- The usage history panel in the drawer re-reads every 30 seconds instead of fetching once when the tab opens, so a pod whose first samples arrive later stops showing "no samples recorded yet". Sampling moves from 60 to 30 seconds, matching the panel; metrics-server scrapes kubelets every 15 seconds by default, so sampling faster would only record the same scrape twice.

## 2.12.0 - Usage history for pods, and Russian LLM answers

- KubeDeck now records what pods actually consume and shows it in the pod summary. Until now the only figure available was the current one, which cannot answer whether a request or a limit is set sensibly. There is no Prometheus behind this: samples are taken by KubeDeck itself, so the history covers the time the application was running, and every figure is shown together with how much of the 24-hour window it rests on. Collection has no per-view cost - the `kubectl top pods` call the pod table already makes is recorded as it passes, and a background `kubectl top pods -A` runs once a minute for clusters that have been opened, so history keeps accumulating while you work elsewhere. Samples are folded into five-minute buckets (average, peak, sample count), kept for 24 hours, and persisted under `%APPDATA%/KubeDeck/metrics` so a restart does not start from an empty window; the store is bounded at 2000 series per cluster and a removed cluster takes its history with it.
- Sustained load and peaks are kept apart, which is the whole point: p50/p95 are percentiles over five-minute averages - what a request has to cover - while max is the highest five-minute peak, what a limit has to survive. A pod idling at 120m that spikes to 900m reports `p50 120m, p95 588m, max 900m` instead of one instantaneous number.
- History survives a redeploy. A Deployment's pods are owned by a ReplicaSet whose name carries the pod-template-hash, so keying on the pod or the ReplicaSet would reset the history at every rollout - exactly when before/after comparison matters. The hash is removed using the pod's own `pod-template-hash` label to recover the Deployment underneath; StatefulSets and DaemonSets own their pods directly, and a CronJob's Jobs are unwrapped the same way. Replica values are pooled rather than summed, because a request is sized per pod, and window coverage counts distinct wall-clock slots so replicas do not inflate it.
- The pod Summary tab gains a Usage history section: a bar per five-minute bucket for CPU and memory (solid = average, lighter cap = peak) with dashed request and limit markers, p50/p95/max above them, and the covered share of the window. The scale includes the request and limit so a pod far below its request does not draw a full bar. A pod with several replicas also gets the same figures across the whole workload. Adds the `usage-history` operation to the resource details route (Node 56 / Python 0 unchanged).
- The LLM analysis receives the same numbers as a `USAGE HISTORY` context section - percentiles, peak, configured request and limit, workload rollup - with coverage stated first so a conclusion drawn from twenty minutes is not presented as if it covered a day, and an explicit note on how to read the percentiles. With nothing recorded the section says so and instructs the model not to infer request sizing from absent history, so missing data is not read as low usage.
- Fixed the LLM analysis answering in English. The renderer sent the stored UI language preference, which is `system` by default, and the prompt defined only `ru` and `en` - so `system` matched neither branch and the model fell back to English. The answer language is no longer a request field at all: the analysis is always written in Russian regardless of the interface language. Kubernetes terminology is now explicitly kept in its original form - resource kinds, phases, statuses and reasons, manifest fields, image and namespace names, CLI flags are not translated or transliterated. This also fixes the English direction, which was broken symmetrically: the rendered section titles, the healthy-pod wording and the default request were hardcoded Russian.

## 2.11.2 - Traefik and Gateway API in Related, Service endpoints, and an always-editable YAML tab

- The Related tab now understands Traefik and Gateway API routing, which it previously ignored entirely: it only knew the built-in `Ingress`, and only looked for it from a Service. `IngressRoute`, `IngressRouteTCP`, `IngressRouteUDP`, `Middleware`, `HTTPRoute`, `Gateway` and `GatewayClass` are now linked in both directions, including a route's Services (with the port), its middleware chain, its TLS Secret, a Gateway's class, listener certificates and attached routes. A Pod reaches all of it transitively through the Services that select it, shown as `routes to pod` with the Service it goes through. Both the `traefik.io` and the older `traefik.containo.us` API groups are recognised, a `kind: TraefikService` reference is linked as such, and an `Ingress` now also links the Secrets from its `spec.tls`. Because Traefik and Gateway API both allow a route to name a Service in another namespace, those routes are searched cluster-wide while a built-in `Ingress`, which cannot cross namespaces, is not.
- Route CRDs are only queried when the cluster actually serves them. The Related route reads the cached `kubectl api-resources` discovery that Global Search already uses, so a cluster without Traefik or Gateway API issues no extra kubectl call and shows no failed source in the diagnostics strip. Discovery also supplies the namespaced flag, so a cluster-scoped custom resource is no longer queried with a namespace, and it is fetched concurrently with the target object rather than ahead of it.
- A Service's Summary tab now shows its endpoints: ready out of total, the not-ready count, and the list itself with address, ports, backing Pod and ready state, with node and zone in the tooltip. A Service that nothing backs says so. The `Ready endpoints` tile that existed before never rendered, because it read a field the backend has never produced. Endpoints are read from `EndpointSlice` with a label selector so the API server returns only that Service's slices; counts are exact and the list is capped at 100 entries. Adds the `endpoints` operation to the resource details route (Node 56 / Python 0 unchanged). A Pod's summary also gained the node IP next to the node name.
- The resource drawer remembers the last tab per resource kind. Walking from pod to pod with YAML open no longer reopens Summary every time, while switching to another kind still starts on Summary. A remembered tab the next resource does not offer falls back to Summary.
- The YAML tab is editable immediately, with no Edit button to press first, and sections stay collapsible while editing instead of the two being separate modes. Collapsing a section replaces it with a summary row and splits the rest into editable blocks around it, so typing in one part never disturbs a fold elsewhere; searching forces the folds open so a match inside a collapsed section is still reachable. The collapse button now greys out once everything it would collapse already is, matching the expand button.
- Fixed a second scrollbar inside every section of the grouped YAML editor, caused by sizing a section from a line count times a line height: a fractional line box rounds up per line and the accumulated overflow re-armed the inner scroll container. Fixed the YAML caret sitting right of the character it edits, caused by the invisible input layer carrying both `inset: 0` and a content-box `width: 100%`. Fixed the gap in line spacing at a fold boundary, and CRD group headers in Related now read `IngressRoutes` and `HTTPRoutes` rather than the flattened `Ingressroutes`.

## 2.11.1 - Faster node usage charts, namespace selection and CPU usage without limits

- Fixed node usage charts taking a long time to appear. The resource list route awaited `kubectl get` before starting `kubectl top`, so Nodes, Pods and Namespaces paid for two kubectl round trips in sequence; the metrics command and the resource quota lookup now run alongside the list, in the cluster overview as well. Per-node disk usage costs one `kubectl get --raw .../stats/summary` process per node against the slow kubelet summary endpoint: the fan-out went from two to twelve concurrent requests, serving the nodes list now starts those fetches in the background instead of waiting for the table to ask, overlapping lookups of the same node share one in-flight request, the cache window moved from 30 seconds to 5 minutes on both sides, and row updates are coalesced into one table update.
- Fixed the namespace selector losing the selected namespace while clicking through resources. The periodic namespace refresh rewrote the remembered per-cluster selection unconditionally, including while a cluster-scoped resource was open and for clusters the user had already left; restoring a selection fell back to All namespaces whenever none was stored, discarding the scope on screen; and opening a resource from Global Search, Events or Related always narrowed the selector to that object's namespace and remembered it, collapsing an All namespaces or multi-namespace selection for good.
- Unchecking a namespace in the selector no longer drops it back into the alphabetical list under the cursor. Every namespace touched while the menu is open stays in a block at the top, checked or not, separated from the rest. That block also survives closing the menu: up to five namespaces stay in it for 15 minutes after they were last selected, most recently used first, then age out and return to alphabetical order; the current selection is always held there too and does not count against the five. The order is recomputed only when the menu opens, so nothing moves while it is on screen. Recency is per cluster and is not persisted across restarts.
- Fixed sorting by the Usage column, which did nothing. The cell holds several bars, so there was no single value to sort by: the header sorted pods on a field that does not exist and nodes on a formatted multi-line string. Clicking it now asks which value to sort by — CPU %, RAM % or Disk % for nodes, CPU or RAM for pods, CPU, RAM or Storage for namespaces — and picking the value that is already active flips the direction. Sort direction is now an arrow on the header instead of an ASC/DESC badge, with the direction carried on the header cell for screen readers. Rows with no reading sort to the low end instead of scattering through the order.
- Pods without a CPU limit now show their CPU usage. The usage bars were computed only against a limit, and CPU limits are omitted far more often than memory limits, so most pods showed `No limit` with the reading hidden in the tooltip. The Usage column now falls back from limit to request to the raw reading; a ratio against a request is shown unclamped and marked as a softer baseline, because a request is a scheduling floor rather than a ceiling.

## 2.11.0 - Namespace scope fix, cluster rail and Windows icon

- Fixed the resource table keeping the rows of the previously selected namespace after switching to All namespaces. Rows now belong to the scope (cluster, resource, namespace selection) they were loaded for and are cleared before the request is awaited when that scope changes, and silent watch-driven refreshes coalesce into one trailing refresh instead of aborting a running load of the same scope.
- Fixed the running Windows application showing the default Electron icon in the window, taskbar and Alt+Tab while the artifact itself carried the KubeDeck icon: the window now loads the bundled icon, the icons ship with the payload, rcedit stays enabled for the packaged executable, and Windows gets the dev.kubedeck.app AppUserModelID.
- Added cluster kubeconfig editing in Settings: the file opens in a YAML editor, is validated before it is written, keeps a .bak copy of the previous version and requires typing the cluster name to save. Saving closes the cluster's watch, port-forward, terminal and SSH sessions and clears its caches, because the API server or context may have changed. The content never reaches logs, the audit trail, persisted UI state or the LLM. Adds GET and PUT /clusters/{cluster_id}/kubeconfig (Node 56 / Python 0).
- Clusters are now switched from a vertical icon rail left of the resource navigation instead of the topbar dropdown; the rail shows active, opening and unavailable clusters, supports arrow-key navigation and carries the kubeconfig import button.

## 2.10.3 - Performance and memory-leak fixes

- Fixed a memory leak: `WatchManager` never removed stopped or crashed resource-watch sessions from its internal session map, so `this.sessions` grew without bound over a long-running session as users switched between resource tabs, namespaces and clusters (each switch starts a new kubectl watch without the renderer ever calling `stop()` on the old one). Explicitly stopped sessions are now removed immediately; sessions that end because the underlying process exited on its own are kept visible in `GET /watches/status` for 5 minutes (so a crash reason can still be inspected) and then swept.
- Fixed an O(n²) allocation pattern in the resource table's row-selection bookkeeping that ran on every data refresh and, separately, every second while a row-age column was visible; the UI stays responsive with a large selection active on a busy, auto-refreshing table.
- Several other performance and stability fixes across resource caching, node metrics polling and search: see the implementation plan (`docs/perf-audit-2.10.3-plan.md`) for details on each.

## 2.10.2 - Internal cleanup: shared HTTP error handling and terminal helpers

- Fixed a rounding/unit-support mismatch between two independent CPU/memory quantity parsers: pod resource requests/limits (`resources/normalizers.ts`) now support `Pi`/`Ei` suffixes and truncate the same way node/pod metrics already did, so the same value no longer rounds differently depending on which code path produced it.
- No other user-visible change. Consolidated 14 duplicate `decodePathPart` helpers, 12 duplicate HTTP error dispatchers, and 4 duplicate error classes across backend routes and WebSocket modules into shared `validation.ts`/`routes/routeErrors.ts` code.
- Extracted `PodDrawer.tsx`'s logs and YAML-action state/handlers into `hooks/usePodDrawerLogs.ts` and `hooks/usePodDrawerYamlActions.ts`, and the duplicated xterm session helpers from `NodeSshTab.tsx`/`TerminalTab.tsx` into `utils/xtermSession.ts`.
- Removed the unused `EventsTab.tsx` component (superseded by `ResourceSummary`'s events view).

## 2.10.1 - Encrypted LLM API key storage

- Stopped storing the LLM API key as plaintext in `config.json`: it is now encrypted at rest via Electron `safeStorage` in `secrets/llm-api-key.bin` (`0700`/`0600` permissions) and decrypted only in-process for the duration of an outbound LLM request.
- `config.json`, `GET /config` and `PUT /settings` now carry `llm.apiKeyConfigured: boolean` instead of the key value; the raw key is never echoed back to the renderer.
- Added a one-shot migration that moves any existing plaintext key (including `config.backup.json`/`config.broken.json` copies) into encrypted storage on first launch after upgrade, tightening file permissions even when encrypted storage isn't available.
- `PUT /settings` and `POST /llm/test` accept a dedicated `apiKeyUpdate` (`keep`/`replace`/`clear`), preserving the "test an unsaved key" flow without ever persisting it unless explicitly saved.
- Exposed `secretStorageAvailable` via `GET /llm/status` so Settings can warn when encrypted storage isn't available on the host (relevant for headless Linux without a keyring).
- Hardened `config.json`/`config.backup.json` to `0600` permissions on save (POSIX).

## 2.10.0 - Apache-2.0 license, SSH host key verification and Linux builds

- Published KubeDeck under the Apache License 2.0 with a NOTICE that reserves the KubeDeck name and icons, and added a third-party notices document covering every redistributed component.
- Verified SSH host keys for Node SSH: an unknown host now shows its algorithm and SHA256 fingerprint and requires explicit confirmation before any password, passphrase or agent signature is offered to the server.
- Refused connections to a host whose remembered key changed, without offering to trust the new one; the remembered key can only be removed explicitly in Settings.
- Verified the jump host independently of the target host, so trusting one grants nothing to the other.
- Added a Settings section listing remembered SSH host keys with their algorithm, fingerprint and confirmation date, plus per-entry removal.
- Stored confirmed fingerprints in `hostkeys.json` inside the application data directory, written atomically with `0600` permissions.
- Added Linux x64 AppImage packaging with `npm run package:linux`, a Linux release payload gate and Linux application data paths.
- Restricted the packaging `afterPack` hook to macOS so Windows and Linux builds no longer run a macOS-only path repair.
- Added Gateway routes `GET` and `DELETE /ssh/known-hosts`; Node route ownership moved from 52 to 54.

## 2.9.3 - Steel Graphite and packaged UI fixes

- Added the Steel Graphite theme with neutral charcoal surfaces, cool blue interaction states, accessible status colors and a matching terminal ANSI palette.
- Repaired the Capacity group selector and responsive cards so labels and CPU, memory and storage values remain readable.
- Restricted packaged renderer navigation to its HTML entrypoint so lazy JavaScript chunks cannot replace the application window.
- Added a committed multi-size Windows icon so portable packaging no longer converts the large source PNG through the failing WebAssembly icon tool.
- Kept Pod Terminal and Node SSH theme updates inside the shared persistent Terminal Workspace without changing Gateway protocols.
- Synchronized English, Russian, release metadata and cross-platform artifact names for 2.9.3; the planned 2.9.2 fixes are included in this release.

## 2.9.1 - Unified Terminal Workspace

- Moved Node SSH from the resource drawer into the same persistent bottom workspace as Pod Terminal.
- Kept up to five Pod or SSH sessions mounted across resource navigation and tab switching.
- Added pointer and keyboard vertical resizing with a safe viewport clamp and locally persisted panel height.
- Made the Pod xterm viewport consume the resized workspace height instead of leaving an empty grid row.
- Kept SSH passwords and passphrases in live renderer state only and preserved the existing authenticated Gateway protocols.
- Made Help read the packaged application version dynamically and synchronized English, Russian, architecture, security, and release documentation.

## 2.6.0 - Pinned Pod Terminal

- Moved the active Pod Terminal outside resource drawer identity so navigation no longer closes its WebSocket session.
- Added a persistent terminal panel with cluster, namespace, pod and container identity plus collapse, expand and close controls.
- Added a visible panel resize handle with locally persisted width and height.
- Kept one terminal session at a time and require confirmation before replacing it with a different target.
- Preserved the existing xterm, kubectl exec, PTY and paste paths without new dependencies or backend routes.

## 2.5.2 - Large resource pages and namespace search

- Added a 2,000-row page size while retaining the 200-row default and all existing choices.
- Kept selected namespaces visible while searching so the active selection can be replaced without clearing the query.
- Preserved backend loading, watch behavior, multi-select and per-cluster namespace state.

## 2.5.1 - Pod watch load and sticky table headers

- Disabled interval polling while the live resource watch is healthy and retained the configured polling fallback after watch failure.
- Started kubectl watches with `--watch-only=true` to avoid replaying existing resources as an initial event burst.
- Kept resource table column names visible during vertical scrolling with the existing table and scroll container.
- Added focused renderer and Gateway contracts without new dependencies or architecture layers.

## 2.5.0 - Verified code cleanup

- Removed an unreachable Pod Terminal pipes fallback while preserving the required PTY behavior.
- Removed unused desktop IPC channels and the obsolete external Pod Shell script generator.
- Removed unused shared migration types, stale restart diagnostics CSS and seven obsolete PowerShell maintenance scripts.
- Completed two independent cleanup passes and retained ambiguous runtime, CSS, dependency and historical documentation owners.
- Reduced maintained code and scripts by 1,120 lines without adding dependencies or changing active product behavior.

## 2.4.5 - Runtime correctness and bounded persistence

- Bound bulk actions to the cluster where they were requested and discard stale confirmations after a cluster switch.
- Prevent one resource view from stopping shared watches used by another view.
- Require real port-forward readiness, scope search cancellation to its own kubectl commands and serialize application shutdown.
- Preserve unreadable cluster configuration, await cluster-owned runtime cleanup and report managed kubeconfig removal failures.
- Rotate the audit log at 20 MiB while retaining the immediately previous segment.

## 2.4.4 - Windows terminal paste correctness

- Removed the competing manual clipboard and host paste paths from Pod Terminal.
- Delegated clipboard input to xterm so one paste produces exactly one WebSocket input message on Windows and macOS.
- Added a renderer contract that prevents duplicate paste handlers from returning.

## 2.4.3 - Cluster namespace and drawer selection correctness

- Stored single and multi-namespace selections independently for every cluster instead of carrying one global selection across contexts.
- Replaced the native operating-system cluster select popup with a themed in-app menu matching the Namespace Selector.
- Restored each cluster's remembered namespaced scope after cluster-scoped navigation while safely falling back to all namespaces for new or invalid selections.
- Added request sequencing so late cluster and namespace responses cannot overwrite the currently active cluster.
- Replaced separate selected row/resource state with one atomic cluster/resource/row target for the resource drawer.
- Hid stale drawer snapshots immediately on identity changes while retaining stable state during auto-refresh of the same object.

## 2.4.2 - Bulk delete feedback cleanup

- Removed the redundant Bulk delete requested/completed status panel and Close button from successful deletion flows.
- Kept optimistic Terminating rows while making table reload the sole success confirmation.
- Kept partial and full failures in the existing copyable ErrorPanel without a duplicate green status panel.
- Reloaded resources after every bulk-delete attempt so fully failed rows do not remain stuck in Terminating.
- Isolated Drain, Cordon and Uncordon status feedback as node-action-only state and removed obsolete result CSS and locale keys.

## 2.4.1 - Drawer stability and YAML cleanup

- Stabilized resource drawer lifecycle around cluster, resource, namespace, name and uid instead of transient row object references.
- Prevented table auto-refresh from restarting active YAML, Describe, Events or Related requests for the same resource identity.
- Preserved active tab, editor draft, search, scroll, focus and drawer geometry while refreshed row data continues to update Summary.
- Removed redundant YAML operation-output cards and Copy output; Reload now uses button feedback while Dry-run and Apply use compact localized status text.
- Preserved actionable Reload, Dry-run and Apply failures in the existing copyable ErrorPanel.

## 2.4.0 - Async action feedback

- Added a shared idle, pending, success and error feedback model for every manual Refresh and Reload action.
- Added minimum pending visibility, duplicate-run protection, deterministic cleanup and a controlled mode for parent-owned loading such as Logs.
- Added localized Updated, Reloaded and failure states with stable button width, semantic colors, accessible names and reduced-motion support.
- Kept timer, Watch and follow-mode refreshes silent while preserving existing API calls, errors, YAML dirty-state and Secret boundaries.
- Added renderer contracts for feedback timing, rejected operations, cleanup, accessibility, reduced motion and all ten required UI surfaces.

## 2.3.2 - Complete color theme system

- Added Midnight Blue, Nord Frost, Forest Teal, Plum Graphite and Warm Mocha themes alongside Light and System.
- Preserved legacy `dark` settings as Midnight Blue and added safe fallback and pre-render restoration for saved themes.
- Centralized application, terminal, interaction, status, scrollbar and resize colors as semantic tokens.
- Added accessible theme preview cards in Settings and synchronized pagination, drawers, terminals, panels and controls with the selected palette.
- Added renderer and release contracts for theme normalization, persistence, System behavior, shared types, token coverage and pagination states.

## 2.3.1 - Namespace selector and dark theme polish

- Made the namespace menu at least as wide as its selector and let it grow to the exact rendered width of the longest namespace without truncation or wrapping.
- Rebalanced the dark theme from near-black to a lighter blue-graphite palette while retaining readable contrast.
- Synchronized Windows and macOS release metadata and artifact names at version 2.3.1.

## 2.3.0 - LLM log privacy and cluster ordering

- Removed Kubernetes current/previous log collection from LLM preview and analysis.
- Added a fail-closed Gateway boundary that rejects legacy LLM payloads containing `logs` or `previousLogs` before provider invocation.
- Documented the security policy: YAML, Describe, Events and Related Resources remain available to LLM analysis, while Kubernetes log streams never enter its context.
- Added persistent manual cluster ordering with drag-and-drop and accessible move up/down controls.
- Added `PUT /clusters/order` with exact-permutation validation, atomic config persistence and audit metadata without kubeconfig paths.
- Added renderer and Gateway contracts for log non-disclosure, order persistence, validation, rollback and accessibility.

## 2.2.0 - Runtime and maintainability hardening

- Upgraded the desktop runtime from Electron 31.7.7 to Electron 43.1.0 (Chromium 150, Node 24.18).
- Upgraded electron-builder to 26.15.3 and Vite to 8.1.4; the final npm audit reports zero known vulnerabilities.
- Added validated local Electron cache reuse to make repeat macOS packaging resilient to download timeouts.
- Updated the Windows versioning script for `vite.config.mts` and removed stale Python/UI workspace paths; added a release contract against regression.
- Split related-resource, WebSocket, App coordination and legacy CSS responsibilities into focused modules without changing public contracts.
- Deferred React 19, TypeScript 7 and other nonessential major dependency upgrades to isolated future work.
- Raised build and CI prerequisites to Node.js 22.12 and retained sandbox/context-isolation/navigation security invariants.
- Kept node-pty 1.1.0 after successful Electron 43 ABI/runtime and macOS packaged PTY validation.
- Updated the Electron recovery helper for the new `@electron-internal/extract-zip` package layout.
- Extracted cluster/config/namespace lifecycle into `useClusterController`.
- Extracted resource navigation and selected-row synchronization into `useResourceNavigation`.
- Extracted bulk delete and Node actions into `useBulkResourceActions` and focused modal components.
- Reduced `PodDrawer` chrome responsibilities and moved table state/persistence into dedicated modules.
- Split the monolithic renderer stylesheet into ordered functional stylesheets with byte-identical cascade output.
- Added a fast `test:renderer` contract suite for controller and state normalization logic.

## 2.1.0 - Architecture and security hardening

- Updated active documentation for the Node-only runtime.
- Extracted resource loading, watch lifecycle and application preferences from `App.tsx`.
- Split ResourceTable column and pagination UI into focused components.
- Introduced ordered token/base stylesheets without changing the visual baseline.
- Made `@kubedeck/shared-types` the shared renderer/main config contract and removed the unused UI workspace.
- Reduced the main renderer bundle from about 716 KB to about 267 KB with lazy chunks.
- Enabled the Electron Chromium sandbox and hardened navigation and Pod Shell IPC validation.

## 2.0.6 - Pod containers and log viewer polish

- Bumped KubeDeck release metadata and package versions to `2.0.6`.
- Added per-container status cubes to the Pods table for multi-container pods.
- Updated Pod readiness normalization to use `spec.containers` when `containerStatuses` are not available yet.
- Changed the Logs viewer to keep each log entry on one line with horizontal scrolling instead of automatic wrapping.
- Updated README, release notes, regression checklist, release verifier and build artifact paths.

## 1.1.2 - Windows portable builder cleanup

- Added a canonical Windows portable builder.
- Updated package:win to use scripts/build-portable-windows.ps1.
- Converted package-windows.ps1 and build.bat into wrappers for the canonical builder.
## 1.1.1 - Related and namespace selector hotfix
- Fixed Related tab diagnostics and relation chips layout so scanned sources and badges render as compact UI elements instead of loose text.
- Preserved the last selected namespaced namespace when navigating to cluster-scoped resources and returning back to namespaced resource sections.
- Bumped application, desktop and backend metadata to 1.1.1.
## 1.1.0 - Local LLM diagnostics

- Added local OpenAI-compatible LLM integration with Settings -> LLM configuration.
- Added a resource drawer LLM tab with manual `Analyze resource`, rerun, copy answer and response metadata.
- Added backend `/llm/status`, `/llm/test` and `/llm/analyze-resource` endpoints.
- Added sanitization and truncation before resource context is sent to the configured local LLM endpoint.
- Bumped application, desktop and backend metadata to 1.1.0.

## Patch 11 - 1.0.5 stabilization gate

- Added `scripts/validate-1.0.5.ps1` as the explicit stabilization gate for the current 1.0.5 line.
- The validation script checks that portable packaging no longer bundles/injects `kubectl.exe`.
- The script can run backend compile/tests, desktop build and optional portable packaging with release-output kubectl verification.
- Updated roadmap/release docs to freeze the current 1.0.5 stabilization stage before starting 1.0.5 refactor work.

## Patch 10 - Related resources topology polish

- Related resources now include richer Pod configuration links: imagePullSecrets, envFrom refs and env key refs for ConfigMaps/Secrets.
- Pod related resources can now show the parent Deployment/CronJob behind ReplicaSet/Job owner chains.
- Service related resources now include EndpointSlices in addition to legacy Endpoints.
- Endpoint and EndpointSlice drawers now link back to their Service and target Pods when Kubernetes provides targetRef metadata.
- ServiceAccount related resources now show token/secret and imagePullSecret links.
- Related tab now has relation summary chips and Copy map for sharing a compact resource topology map.

## Patch 09 - Problems dashboard diagnostics polish

- Added backend problem categories for CrashLoop, image pull, scheduling, node health, storage/volume, probe, restart and deployment availability issues.
- Problems summary now includes category and kind counts for faster triage.
- Problems UI now has a Category filter, category column and top priority problem cards.
- Priority problem cards can open the affected resource and copy a compact diagnostics block.
- Warning Events now carry target resource locators when Kubernetes provides involved object metadata, so opening a problem jumps to the affected resource instead of the Event row where possible.

## Patch 08 - Bulk delete result panel polish

- Added a dedicated bulk-delete result panel outside the confirmation modal.
- The result panel shows total, deleted and failed resource counts after the background delete finishes.
- Failed resource details are displayed inline without turning partial success into a global error banner.
- Added Copy result for sharing the full success/failure summary.

## Patch 07 - Cleanup and roadmap alignment

- Aligned roadmap/release docs with the already completed watch/cache/WebSocket, Deployment logs, Describe scroll and kubectl unbundling work.
- Updated resource cache comments/status text so they no longer describe resource polling as cache-disabled.
- Removed stale in-modal bulk-delete result state and CSS now that bulk delete closes immediately and reports status outside the modal.
- Verified the resource action audit path in the current source; it records one success event per successful action.

## Patch 06 - Watch WebSocket live refresh

- Added a backend WebSocket event stream for parsed `kubectl watch` events.
- The active resource table now auto-starts/reuses a watch and schedules a silent refresh when matching watch events arrive.
- HTTP polling remains the fallback if WebSocket or watch startup fails.

## 1.0.5 - controlled resource list cache step

## Patch 05 - Watch-to-cache invalidation

- Connected backend `kubectl watch` output to `ResourceSnapshotCache` invalidation.
- Watch commands now request Kubernetes watch event envelopes with `--output-watch-events=true`.
- Parsed watch events invalidate affected resource-list cache entries for the concrete namespace and `all` namespace snapshot.
- Watch diagnostics now expose cache event and cache invalidation counters per watch session.
- WebSocket live updates are still a future step; current UI polling remains the safe fallback.

## Patch 03 - Watch diagnostics UI

- Added Settings diagnostics UI for backend kubectl watch sessions.
- Added frontend API methods and TypeScript types for watch status/start/stop/stop-all.
- Watch diagnostics can start a watch for the active cluster, show pid/status/stdout/stderr counters, display output/error tails and stop one or all watch sessions.
- Watch diagnostics remain visible in Settings; watch output is now connected to cache invalidation, while WebSocket live updates are still a future step.
- Updated stale cache and portable-kubectl help text in RU/EN locales.

## Patch 02 - Portable kubectl unbundling

- Removed bundled `kubectl.exe` from Electron portable `extraResources`.
- Stopped forcing the backend to use packaged `resources/bin/kubectl.exe`.
- Removed build-time SHA256 enforcement for root-level `kubectl.exe` because the portable artifact no longer includes kubectl.
- Updated docs and missing-kubectl guidance to require Settings path or PATH-based kubectl resolution.


### Watch manager foundation

- Added backend `watch_manager.py` foundation for future Kubernetes watch integration.
- Added diagnostic endpoints to start, stop and inspect kubectl watch processes without connecting them to UI live updates yet.
- Added graceful backend shutdown cleanup for running watch processes.
- Watch output is not connected to resource cache or WebSocket updates yet.
- Existing polling/resource tables remain unchanged.


- Added controlled read-through cache support for `/clusters/{cluster_id}/resources/{resource}` responses.
- Resource list cache is short-lived: 15 seconds.
- Manual/live resource loads bypass cached reads and refresh the cached snapshot.
- Silent auto-refresh may reuse a fresh cached snapshot to reduce repeated `kubectl get` calls.
- Existing action/YAML/cluster invalidation helpers now clear these resource list snapshots.
- Resource cache diagnostics now report `foundation+discovery+resource-list` mode and resource-list TTL.
- Watch/WebSocket remain disabled; package manifests, lockfile and dependencies remain unchanged.


## 1.0.5 - discovery cache step

- Added read-through backend cache for `kubectl api-resources --verbs=list -o wide`.
- Resource definitions, global search CRD discovery and CRD instance discovery now share the visible resource cache foundation.
- CRD mutations and YAML apply of CRD definitions invalidate discovery cache.
- Main resource tables still bypass cache; watch/WebSocket remain disabled.

## 1.0.5 - YAML dynamic drawer layout hotfix

- Fixed the drawer grid layout so the tab content occupies the remaining drawer height instead of an auto-sized row.
- Restored dynamic YAML editor sizing: the YAML editor now grows/shrinks with the drawer/window height and keeps scrolling inside the editor.
- Kept the main resource table scrollbar fix and did not change backend, package manifests, or dependencies.

### 1.0.5 YAML drawer layout hotfix

- YAML tab now uses the drawer fill layout, like Logs and Terminal, so the drawer itself does not create an extra vertical scrollbar.
- YAML editor now flexes into the remaining drawer height and keeps scrolling inside the editor area.
- Main resource table layout, Settings, Problems, Secrets, Logs, backend APIs, dependencies and version remain unchanged.


### 1.0.5 main resource layout hotfix

- Removed the extra outer scrollbar from resource-table pages by making the main resource panel a non-scrolling flex container.
- Kept internal table scrolling inside the virtual table area and preserved scrolling for Settings, Problems, Audit, Help, and other non-table pages.

### 1.0.5 cache invalidation helpers

- Added backend resource cache invalidation helpers for future cached resource lists.
- Resource actions now invalidate affected resource snapshots after successful delete/restart/redeploy/scale operations.
- YAML apply now invalidates affected snapshots; unknown custom-resource kinds clear the cluster cache safely.
- Cluster removal clears cached snapshots for that cluster.
- Added backend tests for targeted invalidation, workload-related pod/replicaset invalidation and broad YAML apply fallback.
- Current resource polling is still not switched to cache; watch/WebSocket remains disabled.
- No frontend, dependency, package-lock, or version changes.

### 1.0.5 non-blocking delete status hotfix

- Backend delete actions now call `kubectl delete ... --wait=false` so the API returns after Kubernetes accepts deletion instead of waiting for graceful termination to finish.
- Pod rows with `metadata.deletionTimestamp` are displayed as `Terminating` instead of `Running`.
- Bulk delete marks selected rows as `Terminating` immediately while the background delete requests are running.
- Updated delete/restart command previews to show `--wait=false`.
- Added a backend normalizer test for terminating pods.
- No dependency, package-lock, or version changes.

### 1.0.5 bulk delete confirmation UX

- Bulk delete confirmation now closes immediately after Confirm is clicked.
- Deletions continue in the background so the modal no longer looks stuck while Kubernetes waits for graceful termination.
- Added a main-panel status message for requested/completed bulk delete operations.
- Partial failures are surfaced through the existing ErrorPanel with the failed resource list.
- No backend API, dependency, package-lock, or version changes.


### 1.0.5 delete/restart confirmation UX

- Resource action confirmation modals now close immediately after Confirm is clicked.
- Long-running Kubernetes delete/restart operations continue in the background and update the drawer status when they finish or fail.
- This avoids making pod delete/restart confirmations look frozen while Kubernetes waits for graceful termination or controller reconciliation.

# KubeDeck 1.0.5 documentation snapshot patch

- Aligned README, security notes, release checklist and 1.0.5 plan with the current post-refactor behavior.
- Documented that Terminal, Restart, Redeploy, Scale and YAML Apply no longer require manual typed-name confirmation in the UI.
- Documented current packaging behavior: packaging does not repair npm dependencies automatically.
- Added roadmap item to remove bundled/root-level `kubectl.exe` from the portable build and rely on PATH/configured kubectl.
- Added architecture notes for the backend module split, Secrets viewer, Deployment logs and resource cache foundation.
- No application code, dependency, package-lock, backend API, or version changes.

# KubeDeck 1.0.5 resource cache foundation patch

- Added a thread-safe backend resource snapshot cache foundation for the future watch/cache/WebSocket architecture step.
- Added `/resource-cache/status` and `/resource-cache/clear` diagnostic endpoints.
- The cache is intentionally not used by current resource polling yet, so UI behavior remains unchanged.
- Added backend tests for cache set/get/expiry/clear behavior.
- No frontend, dependency, package-lock, or version changes.

# KubeDeck 1.0.5 deployment logs patch

- Added Deployment-level Logs tab support that aggregates logs from every pod selected by the Deployment selector.
- Added Deployment log pod/container filters, bounded follow refresh, previous logs, timestamps, copy, and download support.
- Added backend Deployment log target discovery with matchLabels and matchExpressions selector support.

# Changelog

### 1.0.5 bulk actions hardening
- Bulk delete now shows the full target list in a scrollable preview instead of truncating after a few rows.
- Added resource and namespace scope metadata plus a Copy list action to the bulk delete confirmation.
- Bulk delete now collects per-resource failures and keeps the modal open with a partial result report instead of hiding failed items behind a single error.
- No backend API, dependency, package-lock, or version changes.

### 1.0.5 CRD instances UX
- Marked CustomResourceDefinition objects as view-only in the drawer.
- Hid direct delete/edit actions for CRD definitions while keeping YAML/Describe readable.
- Enabled delete action for CRD instances opened from the CRD sidebar, subject to Kubernetes RBAC.
- Added a CRD instance notice and better table columns for custom resources.
- Added API Version to generic resource summaries.

### YAML toolbar labels
- Shortened YAML toolbar actions: `Reset draft` -> `Reset`, `Reload from cluster` -> `Reload`.
- Kept the full explanations in button tooltips.
- No behavior, backend, dependency, package-lock, or version changes.

### Layout repair
- Restored the refactored PodDrawer layout after YAML drawer experiments.
- Kept drawer/resource tabs scrollable without forcing the drawer off-screen.
- Rebalanced YAML editor height so it stays usable without turning into a tiny block.

## 2026-06-02 вЂ” 1.0.5 Secret tab resource-text hotfix

- Fixed TypeScript build error in `PodDrawer.tsx` after adding the Secret tab.
- Secret tab is now excluded from the generic YAML/Describe `resourceText()` loader.
- No backend API, dependency, package-lock, or version changes.


### 1.0.5 Secrets viewer

- Added a Secret drawer tab for Kubernetes Secrets.
- Secret keys are listed without decoded values by default.
- Individual keys can be revealed, hidden, copied, and auto-hidden using the configured reveal timeout.
- Secret reveal/copy actions write audit metadata without storing secret values.

### 1.0.5 command preview UX

- Added reusable command preview blocks with a Copy command action.
- Resource action confirmations now show a dedicated kubectl command preview panel.
- YAML apply confirmation now shows the apply command preview.
- Error panels now redact kubeconfig and token/password-like arguments before displaying or copying command previews.

### Build hotfix note

- Rolled desktop dependency graph back to the stable 1.0.2 toolchain while keeping application version 1.0.5.
- Packaging no longer attempts to repair npm dependencies automatically; run npm install/ci explicitly before packaging.


## 1.0.5

- package script now validates required npm build executables and reinstalls dependencies if node_modules is incomplete.

### Dependency cleanup

- Updated Electron, electron-builder, Vite, @vitejs/plugin-react, and TypeScript dependency lines.
- Regenerated `package-lock.json` after controlled dependency updates.
- Removed the npm audit findings present in the 1.0.2 dependency graph.
- Kept runtime behavior, Kubernetes polling, UI timer behavior, confirmation flows, and backend APIs unchanged.

### Validation

- `npm audit` reports zero vulnerabilities.
- `npm run typecheck` passes.
- `npm run build` passes.
- Backend compile and tests pass.

## 1.0.2

### UI timers

- Added a frontend-only UI clock that ticks every second without increasing Kubernetes polling frequency.
- Resource table `Age` columns now update locally every second between backend refreshes.
- Drawer summary `Age` now renders as a live elapsed duration.
- Drawer event timestamps now render as live `ago` durations with the original timestamp preserved in the tooltip.

### Versioning

- Updated root, desktop, shared packages, backend metadata, About/Help fallback, and README release path to `1.0.2`.

## 1.0.1

### Security / safety

- Added backend-enforced typed confirmation for YAML apply.
- Limited YAML apply to one Kubernetes object per request.
- Added YAML target parsing before `kubectl apply`.
- Added typed confirmation UI for restart/redeploy/scale resource actions; delete keeps the standard confirmation dialog without typed resource-name entry.
- Added typed confirmation before opening pod terminal sessions.
- Added WebSocket-side pod-name confirmation for terminal sessions.

### Packaging

- Added `kubectl.exe.sha256`.
- Windows packaging now verifies bundled `kubectl.exe` against `KUBEDECK_KUBECTL_SHA256` or `kubectl.exe.sha256`.
- Pinned Python runtime dependencies.
- Added `requirements.lock.txt`.

### Versioning

- Updated root, desktop, shared packages, backend metadata, About/Help fallback, and README release path to `1.0.1`.

### Tests

- Added backend tests for confirmation validation, YAML apply parsing, multi-document blocking, and `NO_PROXY` merge logic.

### Known notes

- Full Windows portable packaging must still be smoke-tested on Windows.
- `npm audit` reports dependency vulnerabilities in the current Electron/build dependency graph; this requires separate dependency review because automatic fixes may introduce breaking changes.

### 1.0.5 packaging hotfix

- Avoid running `npm ci` a second time from `scripts/package-windows.ps1` when `node_modules` already exists.
- Keep packaging deterministic while reducing exposure to transient npm CLI failures during the portable build step.
## 1.0.5 - YAML drawer visible editor hotfix

- Restored visible YAML editor content after the drawer fill-layout change.
- Kept the drawer outer scrollbar suppressed while allowing YAML to scroll inside the editor.
- Did not change backend, dependencies, package manifests, or application version.
