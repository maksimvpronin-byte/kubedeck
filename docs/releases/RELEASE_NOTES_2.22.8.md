# KubeDeck 2.22.8 release notes

The renderer can be tested by clicking on it. No product code changed.
Node-only ownership stays at Node 58 / Python 0.

## Why

A large part of what the renderer promises was checked by reading its own source
and matching a regular expression. The repository says so in the tests
themselves - `// grep contract: asserts on source text, not behaviour` - and
those tests do the two things you would expect: they break when something is
renamed, and they pass while a real regression walks through. Whether a click
opens a row, whether a selection survives a refresh, whether a refresh tick
steps aside for the walk already running: none of it was actually exercised.

## What this adds

`jsdom` as a dev dependency, and a small harness on top of it -
`tests/helpers/dom.cjs` - that mounts a real renderer component with the
project's own React and lets a test click, type, toggle and re-render it. It
reuses the existing TypeScript loader, handing it the real React instead of the
do-nothing stub, and stubs only the icon set.

Eleven behavioural tests come with it:

**The resource table** (8) - a row per resource with the cells its columns name;
a click opens a row, a double click pins it, and the namespace pill does
neither; selection drives the bulk action and the header checkbox takes the
page; a refresh keeps the selection and drops only the rows that are gone; the
filter narrows the rows, searches every column, and its empty state offers to
clear it; a header sorts and reverses; an empty list says so.

**The Problems panel** (3) - it loads once and shows what it loaded; a tick that
arrives while the previous walk is still running steps aside rather than
restarting it, and refreshes again once that walk is done (2.22.1, previously a
grep contract); leaving the panel aborts the walk it left behind (2.22.0).

Two things were worth learning the hard way and are now written into the
harness. `react-dom` decides at import time whether it has a DOM, and one loaded
without a document never delivers a change event again - so the document is
installed before it is required. And `act` must not adopt a promise it was not
given deliberately: passing it a callback that returns one silently swallows the
state update that follows.

## Files

| File | |
|---|---|
| `apps/desktop/tests/helpers/dom.cjs` | new: the harness |
| `apps/desktop/tests/resource-table-dom.contract.test.cjs` | new: 8 tests |
| `apps/desktop/tests/problems-panel-dom.contract.test.cjs` | new: 3 tests |
| `apps/desktop/tests/helpers/renderer.cjs` | the module cache is keyed by the stubs as well as the path |
| `apps/desktop/package.json` | `jsdom` (dev), two suites added to `test:renderer` |

## On the dependency

`jsdom` is a dev dependency: it is not bundled, not packaged, and not shipped.
`npm audit --omit=dev` stays at zero vulnerabilities; the dev tree keeps the
advisories it already had from the Electron and Vite toolchains, and the release
checklist's rule against `npm audit fix` as a release side effect is unchanged.

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **138 tests** (was 127)
- `npm --workspace apps/desktop run test:gateway` - **166 tests**, unchanged
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- `/migration/status` remains `node-only`, Node 58 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.22.8.md](./REGRESSION_CHECKLIST_2.22.8.md).
