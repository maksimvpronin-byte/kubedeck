# KubeDeck 2.22.6 release notes

The resource table stops rebuilding every row for changes that touched none of
them. No route changes, no API change. Node-only ownership stays at
Node 58 / Python 0.

Section G of the 2.22.x performance pass, and the last of it -
[perf-audit-2.22.0-plan.md](../perf-audit-2.22.0-plan.md).

## What was happening

Two things, both in the renderer.

**A second render on every refresh.** The effect that prunes the selection when
rows are replaced returned a new `Set` unconditionally - including the usual
case of nothing being selected, where there is nothing to prune. React cannot
skip a state update whose value is a new object, so every refresh, every watch
event, rendered the table twice.

**Every row rebuilt for anything.** A page is 200 rows of a dozen cells by
default, and none of it was memoized: dragging a column edge (which updates
state on every mouse move), ticking one checkbox, or a usage refresh that
touched three pods rebuilt all 2400 cells.

## What it does now

`pruneSelection` returns the selection it was given when nothing was removed, so
React drops the update instead of rendering again.

Rows are a memoized component. The obstacle to that was the handlers: the table
is handed fresh arrow functions on every render of the application, and a row
that read them directly could never be skipped. They go through a ref now, so
what a row sees never changes identity while the callbacks behind it stay
current.

What this is worth depends on what changed:

| the change | rows rebuilt before | now |
|---|---|---|
| dragging a column edge | all of them, per mouse move | none |
| ticking one checkbox | all of them | one |
| pod usage refresh (15 s) | all of them | only pods whose usage moved |
| a list reload with new data | all of them | all of them |

The last row is unchanged and cannot be otherwise: a reload builds new row
objects. The usage refresh is different because `applyPodUsage` already returns
the same row object when a pod's usage did not change - that has been true since
2.14, and the memo is what finally makes it visible.

No timings here: this is React render work, which the contract suites cannot
measure and this machine has no cluster to profile against. The manual checklist
covers it by feel - a column drag on a full page is the clearest one.

## Files

| File | |
|---|---|
| `apps/desktop/src/renderer/components/resourceTable/ResourceTableRow.tsx` | new: the memoized row |
| `apps/desktop/src/renderer/components/ResourceTable.tsx` | stable handlers through a ref, tbody down to one line |
| `apps/desktop/src/renderer/hooks/useResourceTableState.ts` | `pruneSelection` keeps the identity when it changes nothing |
| `apps/desktop/tests/resource-table.contract.test.cjs` | the pruning is now tested by calling it, not by grepping for it |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **127 tests** (was 125)
- `npm --workspace apps/desktop run test:gateway` - **166 tests**, unchanged
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- Three grep contracts that pointed at the old markup - the double-click that
  pins a tab, the cell rendering, the selection effect - were moved to where
  that code lives now; the pruning one became a behavioural test.
- `/migration/status` remains `node-only`, Node 58 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.22.6.md](./REGRESSION_CHECKLIST_2.22.6.md).

## The 2.22.x pass, end to end

| | |
|---|---|
| 2.22.0 | an abandoned request stops its kubectl processes |
| 2.22.1 | Overview and Problems stop reading the whole event stream |
| 2.22.2 | the usage sampler stops rebuilding every bucket array (33.7 ms → 1.4 ms per tick) |
| 2.22.3 | preparing a kubectl command stops reading two files (0.342 ms → 0.014 ms) |
| 2.22.4 | Global Search stops normalizing what it throws away (2.94 ms → 0.97 ms per 400 pods) |
| 2.22.5 | list normalization stops paying for a collator per label (15.75 ms → 12.66 ms per 3000 pods) |
| 2.22.6 | the table stops rebuilding rows nothing changed |
