# KubeDeck 2.10.3 regression checklist

Automated gates below ran and passed during development, including new
tests written specifically to pin the fixed behaviors (session-map
cleanup/TTL sweep, cache reuse/invalidation, selector-matching
correctness, memoization). After release, the app owner did a manual
build/run of the packaged app locally and reported it working; that was a
general smoke test, not a step-by-step run through every item below, so
only the general watch start/stop item is checked from it — the rest
remain open for a future targeted pass.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (53 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway` (103 tests)
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 54 / Python 0**

## WatchManager session leak

- [x] Starting and stopping several watches in a row does not leave stale
  entries in `GET /watches/status` — confirmed by the app owner via a
  manual build/run (2026-08-03), in addition to the automated tests
  (`watch.contract.test.cjs`).
- [ ] A watch whose kubectl process crashes (not explicitly stopped) still
  shows its final status/error briefly, then disappears after the 5-minute
  retention window.

## Performance fixes

- [ ] Resource list responses (`GET /clusters/:id/resources/:resource`) are
  unchanged before/after the cache-clone removal — spot-check a few
  resource kinds.
- [ ] Global search still finds newly-created CRDs within 60 seconds of
  their creation (cache TTL unchanged).
- [ ] Node disk usage in the Capacity view still updates within a few polls
  of a real change (cache TTL is 30s, not indefinite).
- [ ] Deployment logs still show the correct pod set for deployments using
  `matchExpressions` (`In`/`NotIn`/`Exists`/`DoesNotExist`) in their
  selector, not just `matchLabels`.
- [ ] Resource table row selection (checkbox select, "select all on page")
  still behaves correctly when rows refresh or disappear from the table.
- [ ] Global search typing, YAML tab search, Manifest Compare fold/collapse,
  and the Logs tab search filter all still show correct, up-to-date results.

## Product regression

- [ ] Cluster import, switching, removal, namespace selection and refresh work.
- [ ] Pod Terminal and Node SSH connect, resize, copy-on-select and disconnect
  correctly.
- [ ] Pod Drawer logs (follow, tail, download, deployment vs. pod) and YAML
  (dry-run, apply, reset, reload) work.
- [ ] LLM status, preview and analysis work without receiving Kubernetes logs.
