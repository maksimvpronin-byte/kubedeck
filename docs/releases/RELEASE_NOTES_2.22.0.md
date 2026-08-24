# KubeDeck 2.22.0 release notes

A request the client walked away from now stops. No route changes. Node-only
ownership stays at Node 58 / Python 0.

## What was happening

The renderer cancels requests constantly, and always has:

- switching a resource tab, a namespace or a cluster aborts the list load that
  was still running (`useResourceLoader`);
- every keystroke in the command palette aborts the previous global search
  (`useGlobalSearch`, 250 ms debounce);
- closing a drawer abandons the related-resources fan-out behind it.

The backend never knew. Not one route listened for the connection closing, so
the `fetch` went away and the work did not: `kubectl get … -A -o json` was read
to the end, parsed, normalized and serialized into a response nobody could read.

The scale of it depends on the route:

| route | work per request |
|---|---|
| resource list | 1 list + 1 `kubectl top` |
| global search | up to 10 base resources + 12 CRD kinds, 3 at a time |
| problems | 5 cluster-wide lists |
| overview | 9 cluster-wide lists |
| related resources | a dozen lists for one drawer tab |

Clicking through five entries in the resource tree left five full list loads
running against the API server. Typing a twelve-character query left several
search fan-outs running at once, each one to be discarded.

## What it does now

`requestAbortSignal(request, response)` turns "the connection closed before the
answer was written" into an `AbortSignal`, and that signal is threaded down to
`KubectlRunner.run`, which has been able to kill its process on a signal since
2.13. The five fan-out routes take it: resource lists (including the readiness
probe and the `kubectl top` companion), search, problems, overview and related
resources.

Three details this needed:

- **A cancelled command is not a failure.** `isRequestCancelled` keeps it out of
  the log, out of the error surface, and - importantly - stops it from clearing
  the resource cache. Dropping cached snapshots because of a probe nobody was
  waiting for would have made every abandoned request cost the *next* reader a
  full reload.
- **Search folds the client into its own controller**, the one the 12-second
  total timeout already used, so the fan-out stops on whichever comes first and
  the sources still queued never start.
- **Shared caches deliberately keep no signal.** `api-resources` discovery and
  the per-node disk readings are shared through TTL caches and in-flight
  deduplication: one abandoned drawer must not throw away the answer other
  callers are waiting on. The same reasoning already applied to the usage
  sampler and the node-disk warm-up, which outlive the request that started
  them on purpose.

`writeJson` and `writeError` now return early on a response that is already
ended or destroyed - the answer has no reader, and `end()` on a destroyed socket
throws rather than reaching anyone.

## Files

| File | |
|---|---|
| `apps/desktop/src/main/backend/requestCancellation.ts` | new: the signal and what counts as a cancellation |
| `apps/desktop/src/main/backend/routes/resourceLists.ts` | signal on the list, the readiness probe and the metrics; cache kept on cancel |
| `apps/desktop/src/main/backend/routes/search.ts` | client abort folded into the timeout controller |
| `apps/desktop/src/main/backend/routes/problems.ts` | signal on all five sources |
| `apps/desktop/src/main/backend/routes/overview.ts` | signal on all nine sources |
| `apps/desktop/src/main/backend/routes/relatedResources.ts` | signal on the target and every source list |
| `apps/desktop/src/main/backend/resources/metrics.ts` | `fetchPodMetrics`/`fetchNodeMetrics`/`fetchNamespaceMetrics` accept a signal |
| `apps/desktop/src/main/backend/http.ts`, `errors.ts` | no writing into a response nobody holds |
| `apps/desktop/tests/request-cancellation.contract.test.cjs` | new: 3 tests |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **124 tests**, unchanged
- `npm --workspace apps/desktop run test:gateway` - **157 tests** (was 154)
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- The new tests drive real `KubectlRunner` instances over a fake kubectl that
  never exits on its own: an aborted list kills every process behind it and
  leaves the cache intact, and an aborted search starts no further source.
- `/migration/status` remains `node-only`, Node 58 / Python 0

Part of the 2.22.x performance pass - section A of
[perf-audit-2.22.0-plan.md](../perf-audit-2.22.0-plan.md).

Manual pass: [REGRESSION_CHECKLIST_2.22.0.md](./REGRESSION_CHECKLIST_2.22.0.md).
