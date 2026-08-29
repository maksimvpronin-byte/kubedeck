# KubeDeck 2.23.4 regression checklist

2.23.4 changes three background colours in the manifest editor and nothing else.
No route changed and no logic changed, so what has to be checked is what the
editor looks like - in more than one theme, because the defect was theme-wide.

Earlier 2.13.x through 2.23.3 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (146 tests, up from 145)
- [x] `npm --workspace apps/desktop run test:gateway` (170 tests, unchanged)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Selecting text in the YAML tab

Open a Pod's YAML tab on a manifest with labels, numbers and strings.

- [x] Drag a selection across a block of keys and values: every character stays
  readable, keys included.
- [x] Select a line with a comment on it: the comment is still legible.
- [x] Select the whole document (Ctrl/Cmd+A): nothing disappears.
- [x] The selection is still obviously a selection - it reads as a tinted band,
  not as an invisible one.
- [x] Alt+drag a column selection: same colour, same legibility.
- [x] Repeat in **light**, **plum** and **mocha** - the three that measured worst.

## Searching in the YAML tab

- [x] Type a query in Find in YAML: every match is tinted and its text readable.
- [x] Step through with the arrows: the match being stood on is clearly picked
  out from the others by its outline.
- [x] Search for a term that appears inside a comment and inside a number: both
  stay legible while highlighted.
- [x] Enter after a search still steps to the next match and does not edit the
  document (the 2.16.0 behaviour is untouched).

## The log viewer is unchanged

- [x] Search a pod's logs: matches look exactly as they did in 2.23.3, the
  current one included.

## Standard smoke test

- [x] Connect a cluster; browse pods, deployments, services and nodes.
- [x] Open a resource drawer and walk its tabs, including Logs with follow on.
- [x] Edit and apply a manifest: dry-run and apply both behave as before.
- [x] Start and stop a Port Forward.
- [x] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [x] Help and About report **2.23.4**.
