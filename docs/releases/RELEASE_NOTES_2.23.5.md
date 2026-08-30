# KubeDeck 2.23.5 release notes

Tests that click on the application instead of reading it. **No product code
changed.** Node-only ownership stays at Node 59 / Python 0, and no route changed.

## Why

Three defects were found in released code this week, each visible to anyone using
KubeDeck and to no test:

| defect | how long it shipped |
|---|---|
| `Р’В·` instead of `·` in the command palette | three releases |
| the editor selection took the text with it | eight releases |
| a Related card hid its own subtitle on hover | undated |

They share a cause. A large part of the suite does not run the application: it
reads the source as text and matches regular expressions against it. The
repository has marked those `grep contract` since 2.20.3 and said in every one of
them what it costs - they break on a rename and pass through a real regression.
There were 51.

2.22.8 brought in jsdom and `tests/helpers/dom.cjs`, which mounts a real
component in a real document. This release spends it.

## What changed

Eight grep contracts become 46 behavioural tests across five new files.

**The LLM tab** (`llm-tab-dom`, 6). Its privacy promise - no log line reaches a
third-party model - was `assert.doesNotMatch(source, /logs\s*:/)` over one file,
which passes if the call is renamed or a second file does the fetching. Now no
method whose name mentions logs may be called at all, and the payload's key set
is pinned exactly.

**The Secret tab** (`secret-tab-dom`, 11). That the confirmation never shows a
decoded value was a search for one sentence and for two spellings of a JSX
expression. Now a real value is revealed, the dialog opened, and everything it
renders is read - the old value and the new one. Around it: nothing is decoded
until asked, binary and immutable values are never opened for editing, a value
hides itself on a timer, and an open confirmation goes down with it.

**The themed select** (`themed-select-dom`, 9). It exists because a native
`<select>` cannot be themed, so what has to hold is that the replacement behaves
like the control it replaced.

**The anchored popover** (`anchored-popover-dom`, 7), driven through a real
consumer. Its sharpest case is the one the hook has a comment about: a press on
the trigger must not close the popover, or the click that follows reopens it and
the button appears dead.

**The cluster rail** (`cluster-rail-dom`, 10). Exactly one button marked current,
arrows that walk and wrap, and a context menu that cannot be left stranded.

**The pod usage bars** (`usage-cells-dom`, 6). Which baseline a bar measures
against was proved by comparing where two strings appear in the file. Source
order is not precedence.

## How they were checked

Every one of the 46 was shown failing on the defect it exists for - 38 mutations
of the product source, each caught by the right test and by no other, with the
source restored afterwards. The rule is written into
`docs/unseen-defects-plan.md`: a test nobody has seen fail does not count as
written.

## What stays, and why

What could not be converted honestly now carries its reason where it sits:

- **Layout and colour.** jsdom has no cascade and lays nothing out, so it cannot
  tell a popover that escaped its panel from one cut in half.
- **Work that is avoided.** A table that recomputes its rows quadratically
  renders the same rows; `React.memo` changes how often a render function runs,
  never what it produces. Catching that would need a render counter threaded
  through the component - a change to the product for the benefit of a test.
- **An absence.** That no component grew a second copy of the popover effect is a
  property of the source: two working copies behave exactly like one.
- **What cannot be mounted.** TerminalTab starts xterm, which needs measurement
  jsdom has not.

One marker was wrong and is gone: a test of selection pruning was labelled a grep
contract while loading the hook and calling it. A sweep found no others, so the
debt was 51 rather than the 52 counted.

## Two harness faults, fixed where the harness is defined

- `assert.equal(view.first(".x"), null)` hands a live DOM node to the reporter,
  which serialises the whole node. A failing test hung for thirty-five seconds
  and was killed, naming the file rather than the assertion.
- A view unmounted at the end of a test is not unmounted when an assertion
  throws, which leaves a `requestAnimationFrame` alive and the run hanging.

Both are now written at the top of `helpers/dom.cjs`.

## Files

| File | |
|---|---|
| `apps/desktop/tests/llm-tab-dom.contract.test.cjs` | new |
| `apps/desktop/tests/secret-tab-dom.contract.test.cjs` | new |
| `apps/desktop/tests/themed-select-dom.contract.test.cjs` | new |
| `apps/desktop/tests/anchored-popover-dom.contract.test.cjs` | new |
| `apps/desktop/tests/cluster-rail-dom.contract.test.cjs` | new |
| `apps/desktop/tests/usage-cells-dom.contract.test.cjs` | new |
| `apps/desktop/tests/helpers/dom.cjs` | the two traps, written down |
| `docs/unseen-defects-plan.md` | the programme this is section A of |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **193 tests**, up from 146
- `npm --workspace apps/desktop run test:gateway` - **170 tests**, unchanged
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- 38 mutations of the product source, each caught by the right test
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.23.5.md](./REGRESSION_CHECKLIST_2.23.5.md).
