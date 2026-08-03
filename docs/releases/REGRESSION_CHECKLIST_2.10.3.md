# KubeDeck 2.10.3 regression checklist

Automated gates below ran and passed during development, including new
tests written specifically to pin the fixed behaviors (session-map
cleanup/TTL sweep, cache reuse/invalidation, selector-matching
correctness, memoization). Manual verification was not performed for this
release — decided to skip rather than leave silently unchecked; the
memory-leak fix in particular only manifests over a long-running session
and was not exercised against a live app.

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

- [ ] Starting and stopping several watches in a row does not leave stale
  entries in `GET /watches/status` — verified only by automated tests
  (`watch.contract.test.cjs`), not against a live, long-running app.
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
