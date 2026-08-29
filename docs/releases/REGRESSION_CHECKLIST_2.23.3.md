# KubeDeck 2.23.3 regression checklist

2.23.3 changes two pieces of renderer text and scrolling behaviour, adds two
tests and excludes a directory from Biome. No route changed, so the surface at
risk is what the reader sees: the command palette and the log pane.

Earlier 2.13.x through 2.23.2 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check` - passes with and without a directory under
  `.claude/worktrees`
- [x] `npm run test:renderer` (145 tests, up from 142)
- [x] `npm --workspace apps/desktop run test:gateway` (170 tests, unchanged)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## The command palette

- [x] Open the palette: every subtitle reads `CRD · apps`, not `CRD Р’В· apps`.
- [x] A namespaced row reads `Pods · kube-system`.
- [x] A cluster-scoped row shows no separator and no stray dot.
- [x] A global search result shows `Deployments · default · match: labels`.
- [x] Switch the interface to Russian and back: the separator is a dot in both.
- [x] The Cyrillic in the Russian interface is still correct - the fix repaired
  mangled punctuation, not any real Russian text.

## Searching a log

- [x] Open a pod's Logs tab on a pod with long lines and search for a term that
  appears far to the right of the viewport: the pane scrolls sideways and the
  match is visible with text around it.
- [x] Step through matches that all sit in the same column: the pane does not
  shuffle sideways at every step.
- [x] Step to a match to the left of the current view: it is pulled in from the
  left edge.
- [x] Narrow the drawer until it is thinner than a single match: the match is
  centred rather than pushed off both ends.
- [x] Down the pane the match is still centred, as before.
- [x] With follow on, a search jump does not fight the follow-to-bottom scroll.
- [x] The same search in the YAML tab is unchanged.

## Still nothing else moved

- [x] Manifest compare, Problems and Overview scroll as before.
- [x] Help and About report **2.23.3**.

## Standard smoke test

- [x] Connect a cluster; browse pods, deployments, services and nodes.
- [x] Open a resource drawer and walk its tabs, including Logs with follow on.
- [x] Open a Service drawer: its addresses and port-forward command are present
  and correct - the new test covers the wiring, not the rendering.
- [x] Start and stop a Port Forward.
- [x] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [x] `npm run smoke:cluster` against a live cluster: all checks pass.
