# KubeDeck 2.22.2 release notes

The usage-history sampler stops rebuilding every bucket array on every tick. No
route changes, no API change. Node-only ownership stays at Node 58 / Python 0.

Section D of the 2.22.x performance pass -
[perf-audit-2.22.0-plan.md](../perf-audit-2.22.0-plan.md).

## What was happening

`UsageHistoryStore.record()` ends with `prune()`, and the sampler calls it every
fifteen seconds for every connected cluster. `prune()` walked all series - up to
`MAX_SERIES_PER_CLUSTER`, 2000 - and rebuilt **both** bucket arrays of each one
with `.filter()`: 4000 new arrays per tick, to usually drop nothing at all. The
coarse grid only expires something once every five minutes.

Both grids are already sorted: `addSample` only ever touches the last bucket, so
everything expired sits at the front. Looking at the first element answers
"is there anything to drop" without touching the rest.

Measured against the built store, 2000 series with both grids full (24 h coarse,
1 h fine), on one sampler tick reporting all 2000 pods:

| | before | after |
|---|---|---|
| `record()` mean | 33.7 ms | **1.4 ms** |
| `record()` median | 34.7 ms | **1.0 ms** |
| `prune()` alone | ~33 ms | **0.85 ms** |

What remains in `record()` is the ingest of the 2000 samples themselves, which is
work the tick actually exists to do. The saving is per cluster: two connected
clusters paid it twice.

## What it does now

`dropExpired(buckets, cutoff)` returns immediately when the first bucket is
still inside the window, and otherwise splices off the expired prefix in one
call. Nothing else about retention changed: the same buckets expire at the same
times, and a series whose coarse grid empties is still removed.

A clock that jumps backwards can leave one out-of-order bucket in place a little
longer than before; it cannot make an expired bucket count, because `aggregate`
and `pointsFrom` filter by the window explicitly.

## Files

| File | |
|---|---|
| `apps/desktop/src/main/backend/resources/usageHistoryStore.ts` | `dropExpired` replaces the two `filter` rebuilds |
| `apps/desktop/tests/usage-history.contract.test.cjs` | 26 simulated hours of sampling: both grids stay bounded, the newest reading survives, a silent series still leaves |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **125 tests**, unchanged
- `npm --workspace apps/desktop run test:gateway` - **160 tests** (was 159)
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- `/migration/status` remains `node-only`, Node 58 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.22.2.md](./REGRESSION_CHECKLIST_2.22.2.md).
