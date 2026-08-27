# KubeDeck 2.22.5 regression checklist

2.22.5 changes how the label text of a row is ordered - and is meant to produce
exactly the same text as before. That is what to check.

Earlier 2.13.x through 2.22.4 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (125 tests, unchanged)
- [ ] `npm --workspace apps/desktop run test:gateway` (166 tests, was 165)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, Node 58 / Python 0

## Labels read the same

Best on a cluster whose workloads carry several labels, ideally including one
with a capital letter (`Environment`, `Team`):

- [ ] Enable the **Labels** column on the pods table: the labels of a row read
  in the same order as before the upgrade, `key=value` separated by commas.
- [ ] The same for deployments, services and any other kind with the column.
- [ ] The **node labels** cell on the nodes table is unchanged (it has its own
  ordering and was deliberately not touched).
- [ ] Filter the table by a label value: the same rows match.
- [ ] Global Search by a label value still finds the object and reports that it
  matched `labels`.

## The list itself

- [ ] Open a large namespace and refresh a few times: the table paints as
  before, with no visible change in speed for the worse.
- [ ] Sort by the labels column, if present: the order is stable across
  refreshes.
- [ ] Open a resource drawer: Summary shows the same labels.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.22.5**.
