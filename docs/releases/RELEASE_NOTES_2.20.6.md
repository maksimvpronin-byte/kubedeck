# KubeDeck 2.20.6 release notes

Internal cleanup, and the first one that improves the tests rather than only
surviving them. No behaviour change, no route changes. Node-only ownership
stays at Node 58 / Python 0.

## What moved

Two files that were a component plus everything it draws:

```
327  ResourceTable.tsx                     the table itself
139  resourceTable/UsageCells.tsx          node, namespace and pod usage bars
 95  resourceTable/rowStatus.ts            containerTone, rowHealthReason, formatters
 51  resourceTable/StatusCells.tsx         AgeCell, workload conditions, container cubes
 33  resourceTable/formatCell.tsx          the column-key → cell dispatcher

232  ProblemsPanel.tsx                     loading, filters, composition
215  ProblemsPanelParts.tsx                the five sub-components
141  problemsModel.ts                      classification, advice, locator, clipboard text
```

`ResourceTable.tsx` was 629 lines, exactly half of it cells that nothing
outside the table ever used - the table body reached all of them through one
function. `ProblemsPanel.tsx` was 578.

`formatCell` was meant to stay in `ResourceTable.tsx` as the dispatcher, but it
was dragging five imports along that only it needed. In its own file the cell
folder is self-contained and the table imports exactly one name.

## The tests got better, not just repointed

Splitting these broke six tests. Five were repointed at the files their subject
moved to - the running total of source-text assertions edited purely because
code moved is now thirteen.

The sixth was **replaced**. `assert.match(table, /not\s*ready[\s\S]*return
"waiting"/)` - a regex over the table's source, asserting that a container
which is merely not ready yet reads as pending rather than as a failure - is
now six calls to `containerTone(...)` with the answers written out.

That is possible because the pure functions are importable now, and the same
opening was used to add **16 new behavioural tests**:

- **`problemsModel.ts`**, 10 tests: classification from an explicit category and
  from the row's own text, severity ordering, guidance grouping capped at four,
  the locator that opens the object a problem is *about* rather than the event
  that reported it, the clipboard diagnostic, row keys, filter deduplication.
- **`rowStatus.ts`**, 6 tests: which problem a row's health reason names first,
  trimming to the first clause and to 72 characters, container cubes built from
  states and from bare names, CPU and byte formatting, and the request
  percentage that rounds but does not clamp - because using more than the
  request is the interesting case.

The renderer suite goes from **93 to 109 tests**, and the share of them that
only grep source text drops from 54% to 46%.

One of the new tests failed on its first run. The bug was in the expectation,
not the code: `problemOpenLocator` builds a stable `uid` even for a row with no
separate target, because a problem row carries no Kubernetes uid of its own.
The test now asserts what actually happens, and a second one covers a row that
names no resource at all.

The Problems panel's layout test moved out of the `renderer-controllers`
remainder into a new `tests/problems-panel.contract.test.cjs` alongside the
model - thirteen renderer test files instead of twelve.
