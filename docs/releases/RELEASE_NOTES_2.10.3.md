# KubeDeck 2.10.3 release notes

KubeDeck 2.10.3 is a performance and stability patch, following a rigorous
audit of the backend and renderer for real, verified issues (not
speculative optimization). There is no new feature, no route/contract
change, and no user-visible JSX/behavior change beyond faster, more
resource-efficient operation. Full findings and verification are recorded
in `docs/perf-audit-2.10.3-plan.md`.

## Memory leak fix: WatchManager session leak

`WatchManager` never removed a resource-watch session from its internal
map once started — `stop()`/`stopAll()`/`stopCluster()` and the
process-exit handler all updated a session's status but never deleted it.
Combined with the renderer starting a new backend watch on every resource
tab/namespace/cluster switch without ever calling `stop()` on the previous
one, this meant the session map — and each entry's kubectl child process
reference and output tail buffers — grew without bound over a long-running
app session.

Explicitly stopped sessions are now removed from the map immediately.
Sessions that end because their kubectl process exited on its own (a
crash, not a user-initiated stop) are kept visible in `GET
/watches/status` for 5 minutes, so a recently-crashed watch's status can
still be inspected, and are then swept.

## Performance fixes

- **Resource cache**: removed an unnecessary `structuredClone()` deep-copy
  on every 15-second-TTL cache hit/write in the resource list cache; the
  only consumer serializes the result and never mutates it in place.
- **Global search**: `routes/search.ts` ran its own `kubectl api-resources`
  call on every debounced search keystroke instead of reusing the 60-second
  cache `routes/resourceDiscoveryEvents.ts` already maintains for the same
  command. Both routes now share one cache, keyed on raw kubectl output
  (each route's `apiGroup` parsing logic differs and was intentionally left
  unchanged).
- **Cluster overview**: node disk-usage stats (`kubectl get --raw=.../stats/
  summary`) were fetched fresh, once per node, on every overview poll
  (default every 10 seconds) with no caching — an N+1 kubectl-process
  pattern that scales with cluster node count. Added a 30-second TTL cache,
  shared with the on-demand per-node lookup used when expanding a node's
  disk usage in the UI.
- **Deployment logs**: `matchingDeploymentPods()` rebuilt an identical
  `Set` from each label-selector's `matchExpressions` values on every pod
  it evaluated — O(pods × matchExpressions) redundant allocations on every
  "Logs" open for a deployment. The selector is now compiled once before
  the per-pod loop.
- **Resource table selection**: an O(selected × rows) `Set`-inside-`.filter()`
  pattern re-pruned the current row selection on every data refresh.
  Separately, the table's derived `selectedRows`/`selectedPageRows`/
  `renderedRows` lists were recomputed on every render, including the
  once-a-second clock tick used to keep row ages fresh — now all three are
  properly memoized.
- Four unmemoized renderer computations now only recompute when their
  actual inputs change, instead of on every render: the resource table's
  column definitions (previously rebuilt on every keystroke in global
  search), the YAML tab's search match count, the manifest-compare diff
  (previously re-parsed and re-diffed on unrelated state changes like
  fold/collapse), and the logs tab's query filtering.

## Release contract

No route/contract-count change. Node-only ownership stays at Node 54 /
Python 0.
