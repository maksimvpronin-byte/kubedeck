# KubeDeck 2.20.3 release notes

Internal cleanup, entirely in the test suite. No application code changed at
all. No route changes. Node-only ownership stays at Node 58 / Python 0.

## What moved

`tests/renderer-controllers.contract.test.cjs` was the largest file in the
repository: 2581 lines, 93 tests, 189 `readFileSync` calls. Themes,
namespace selection, manifest compare, SSH, the cluster rail, pagination, watch
coalescing, bulk actions, workspace tabs, drawer lifecycle and async action
feedback all shared one file.

It is now twelve files, plus a shared harness:

```
426  21  renderer-controllers  the remainder: cluster rail and controller, the LLM
                               renderer, manifest compare, Secret reveal, Pod
                               Terminal, async feedback, navigation, popovers
314   7  theme                 themes, tokens, data attributes, ANSI contrast
309   9  watch-and-loading     reconnect, event coalescing, the resource loader
260   5  resource-detail       node metadata, Service addresses, running a CronJob
256  10  resource-table        columns, sorting, pagination, memoization
234   6  yaml-editor           folding, editing, search, the kubeconfig reuse
229   7  release-surface       "the surface of version X has not drifted" contracts
180   7  namespace-selection   the selector, recents, per-cluster isolation
149   8  workspace-tabs        tabs, dedup, limit, closing, the bottom workspace
132   5  resource-usage        the usage column, the row patch, the history chart
117   4  drawer-lifecycle      generations, auto-refresh, the remembered tab
 93   4  bulk-actions          bulk delete and actions, binding to their cluster
 79      helpers/renderer.cjs  loadTypeScript, resolveRendererModule, the scheduler
```

Same 93 tests, all passing, none rewritten. `test:renderer` names all twelve
files explicitly, the way `test:gateway` already named its own.

## What the split made visible

Splitting it was also an audit. Classifying all 93 by whether they execute
renderer code or only read a source file:

```
behaviour   31
mixed       12   (run code, and also grep the source)
grep        50   ← source text only
```

**More than half the suite is a grep.** A test like that breaks when a CSS
class is renamed and passes straight through a real regression. All 50 now
carry a marker in the code:

```js
// grep contract: asserts on source text, not behaviour.
```

and every file holding one explains what the marker means. They were not
rewritten here - this release is a move, and turning a grep into a behavioural
test is a change of what is being asserted. The markers are the worklist.

## One thing left outside

Two **gateway** test files are still over 700 lines:
`resource-lists.contract.test.cjs` (798) and `llm.contract.test.cjs` (792).
They were never part of this section, and they are not in anyone's way, so they
are left alone rather than folded in.
