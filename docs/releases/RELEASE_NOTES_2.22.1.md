# KubeDeck 2.22.1 release notes

Overview and Problems stop reading the whole event stream. No route changes.
Node-only ownership stays at Node 58 / Python 0.

Section B of the 2.22.x performance pass -
[perf-audit-2.22.0-plan.md](../perf-audit-2.22.0-plan.md).

## What was happening

Both panels answer by walking the cluster, on the auto-refresh timer (10 s by
default):

| panel | per refresh |
|---|---|
| Overview | 9 cluster-wide `kubectl get`, all started at once, plus `kubectl top nodes` and a kubelet request per node |
| Problems | 5 cluster-wide `kubectl get` |

Among them, on both, was `get events -A -o json` - typically the largest list a
cluster has. The problem engine keeps only the entries with `type=Warning` and
drops everything else, which in a normal cluster is the overwhelming majority.
All of it was read from the API server, transferred, parsed and normalized to be
thrown away a moment later.

The five kinds Problems reads are all among the nine Overview reads, and only one
of the two panels is on screen at a time. Switching between them repeated the
same lists from scratch.

And a refresh tick aborted the walk that was still running. On a cluster slower
than the interval that meant every tick restarted the whole walk, so the panel
could keep working forever without ever showing a result.

## What it does now

- **`--field-selector type=Warning`** on the event list, in both routes. The
  filtering happens where the events are.
- **Three lists at a time** in Overview instead of nine, which the answer is no
  slower for: it is bounded by the API server either way, and the burst of
  kubectl processes every ten seconds is gone.
- **A short shared cache** for the source lists - five seconds, well under the
  ten-second minimum refresh interval. Switching panels or pressing Refresh
  twice reuses what was just fetched; a panel's own interval always reads the
  cluster afresh. In-flight requests are deliberately *not* shared: each one
  carries the abort signal of the client that asked for it (2.22.0), and a
  joined reader would inherit a cancellation that has nothing to do with it.
  The cache is cleared with the others on mutation, manual cache clear and
  cluster disconnect.
- **A silent refresh steps aside** for the walk already running, rather than
  aborting it - the same rule the resource table has had since 2.13.

One thing deliberately not done: gating these panels on `watchHealthy`, the way
the resource table is. A watch is opened for the one resource the table shows,
and while Overview or Problems is the active section there is no watch open at
all - there is nothing for that check to consult. It is written down in both
components rather than added as dead logic.

## Files

| File | |
|---|---|
| `apps/desktop/src/main/backend/cache/aggregateSourceCache.ts` | new: the five-second shared window |
| `apps/desktop/src/main/backend/routes/problems.ts` | warning-only events, cached sources |
| `apps/desktop/src/main/backend/routes/overview.ts` | warning-only events, cached sources, three at a time |
| `apps/desktop/src/main/backend/gateway.ts` | the new cache is cleared with the other cluster read caches |
| `apps/desktop/src/renderer/utils/refresh.ts` | `shouldSkipSilentRefresh` |
| `apps/desktop/src/renderer/components/OverviewPanel.tsx`, `ProblemsPanel.tsx` | a tick no longer aborts the running walk |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **125 tests** (was 124)
- `npm --workspace apps/desktop run test:gateway` - **159 tests** (was 157)
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- New tests assert the exact event arguments, that nothing else grew a filter,
  that Overview keeps at most three lists in flight, and that Problems issues no
  kubectl at all when Overview has just read the same kinds.
- `/migration/status` remains `node-only`, Node 58 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.22.1.md](./REGRESSION_CHECKLIST_2.22.1.md).
