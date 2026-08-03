# KubeDeck 2.10.2 regression checklist

Automated gates below ran and passed during development. This is an internal
cleanup patch with one small behavior change (CPU/memory quantity rounding);
manual verification was not performed for this release — decided to skip
rather than leave silently unchecked.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, **Node 54 / Python 0**

## Quantity parsing fix

- [ ] A pod with `Pi`/`Ei`-suffixed memory requests/limits shows the same
  value in the resource table and in the resource summary/metrics view.
- [ ] Fractional CPU/memory requests round the same way in resource lists as
  they do in node/pod metrics.

## Product regression

- [ ] Cluster import, switching, removal, namespace selection and refresh work.
- [ ] Pod Terminal and Node SSH connect, resize, copy-on-select and disconnect
  correctly after the shared `utils/xtermSession.ts` extraction.
- [ ] Pod Drawer logs (follow, tail, download, deployment vs. pod) and YAML
  (dry-run, apply, reset, reload) work after the hook extraction.
- [ ] LLM status, preview and analysis work without receiving Kubernetes logs.
- [ ] All routes that changed error-handling internals (deployment logs,
  related resources, resource lists, problems, search, resource discovery/
  events, YAML, resource details, secrets, pod exec, resource actions,
  port-forward) still return the same error codes for invalid input as
  before.
