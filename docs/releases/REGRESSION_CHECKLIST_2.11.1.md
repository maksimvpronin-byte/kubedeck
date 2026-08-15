# KubeDeck 2.11.1 regression checklist

Automated gates below ran and passed during development, including new tests
pinning the fixed behaviors (concurrent list metrics, node disk fan-out,
namespace memory ownership, pod usage fallback). Manual items stay open until
someone runs them on a real cluster.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 56 / Python 0**

## Node usage charts

- [ ] Open Nodes on a cluster with many nodes: CPU and RAM bars appear with
  the table, and disk bars fill noticeably faster than in 2.11.0.
- [ ] Leave Nodes open across several auto-refresh cycles: no repeated burst
  of per-node requests, and the bars do not flicker.
- [ ] Switch away from Nodes while disk metrics are still loading: no stale
  rows and no update of another cluster's table.
- [ ] Open the cluster overview: node cards show CPU, RAM and disk.
- [ ] A cluster without metrics-server still shows the table, with usage
  columns empty instead of an error.

## Namespace selection

- [ ] Pick a namespace on Pods, go to Nodes and back: the selection returns.
- [ ] Repeat with a multi-namespace selection and with `All namespaces`.
- [ ] Stay on Nodes for longer than the auto-refresh interval, then return to
  Pods: the selection still returns.
- [ ] With `All namespaces` selected, open a pod and jump to a Related or
  Search result in another namespace: the selector stays on `All namespaces`
  and the table shows every namespace.
- [ ] With a single namespace selected, open a Search result from a different
  namespace: the selector switches to that namespace.
- [ ] Switch clusters back and forth: each cluster keeps its own selection.
- [ ] Delete a namespace that is currently selected: the selection falls back
  to `All namespaces` on the next refresh.

## Pod usage column

- [ ] A pod with CPU and memory limits shows both bars as a percentage of the
  limit, as before.
- [ ] A pod with requests but no limits shows striped bars against the
  request, and the tooltip says `no limit set`.
- [ ] A pod above its request shows a value over 100% with a warning colour
  and a full-width bar.
- [ ] A pod with neither limits nor requests shows the raw reading (`10m`,
  `32Mi`) instead of `No limit`.
- [ ] The column stays readable at a narrow window width and in light,
  midnight and steel-graphite themes.

## Product regression

- [ ] Cluster import, switching, rename, removal and refresh work.
- [ ] Pod Terminal and Node SSH connect, resize and disconnect correctly.
- [ ] Pod Drawer logs and YAML (dry-run, apply, reset, reload) work.
- [ ] Global Search, Problems and Port Forward work.
- [ ] LLM status, preview and analysis work without receiving Kubernetes logs.
