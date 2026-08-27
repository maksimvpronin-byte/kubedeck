# KubeDeck 2.22.2 regression checklist

2.22.2 changes only how expired usage-history buckets are removed. Nothing about
what is recorded, retained or shown should differ, so this checklist is about
proving the history still behaves.

Earlier 2.13.x through 2.22.1 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (125 tests, unchanged)
- [ ] `npm --workspace apps/desktop run test:gateway` (160 tests, was 159)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, Node 58 / Python 0

## The history still works

Needs a cluster with metrics-server, and the application left running - the
window only fills while KubeDeck is open.

- [ ] Open a pod drawer, Summary tab: the usage chart draws, and keeps moving
  every ~15 s (the fine grid).
- [ ] Leave the application open for at least 15-20 minutes, then reopen the same
  pod: the chart shows the whole period, not only the last few minutes.
- [ ] The percentiles (p50/p95/max/avg) and the coverage figure are present and
  plausible for how long the app has been running.
- [ ] A pod with several replicas shows the workload rollup as well as its own
  series.
- [ ] The pods table usage columns still fill in for pods metrics-server only
  started reporting after the list load.

## Nothing grows without bound

- [ ] After a long session (an hour or more) on a busy cluster, memory use of
  the KubeDeck process is comparable to previous versions - the point of the
  change is that it should be no worse, and the tick cheaper.
- [ ] Browse many namespaces on a large cluster so more than 2000 pods are
  sampled over the session: the drawer still opens quickly, and the least
  recently sampled series are the ones that disappear.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.22.2**.
