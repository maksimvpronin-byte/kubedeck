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
- [ ] Leave Nodes, go elsewhere and come back within five minutes: the disk
  bars are there immediately, with no `…` placeholder.
- [ ] Open the cluster overview and the Nodes table at the same time: the
  disk values appear once, without doubling the per-node kubectl calls.
- [ ] Edit the kubeconfig of the active cluster while disk metrics are
  loading: the new endpoint's values are shown, not the old ones.
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
- [ ] Uncheck a namespace with the menu open: it stays at the top, above the
  divider, and can be re-checked without scrolling.
- [ ] Close and reopen the menu: namespaces used in the last 15 minutes are
  still on top, most recently used first, checked or not.
- [ ] Touch more than five namespaces, then reopen: only the five most recent
  are held above the divider.
- [ ] Select more than five namespaces: every one of them stays visible at the
  top, alongside the recent ones.
- [ ] Wait out the window (or use a namespace not touched for 15 minutes):
  it returns to its alphabetical position on the next open.
- [ ] Switch clusters: the top block is that cluster's own recent list.
- [ ] Restart the app: the block holds only the current selection.
- [ ] Typing in the search box still keeps the top block reachable, and
  selecting `All namespaces` does not clear it.

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

## Usage column sorting

- [ ] Nodes: the Usage header opens a menu with CPU %, RAM % and Disk %, and
  each one orders the table correctly in both directions.
- [ ] Clicking the value that is already active flips the direction; the
  header shows the chosen value and the direction.
- [ ] Pods: the menu offers CPU and RAM, and ordering matches the readings in
  the cells, including pods with no limit.
- [ ] Namespaces: the menu offers CPU, RAM and Storage.
- [ ] Nodes whose disk metrics have not arrived yet sort to the bottom when
  sorting by Disk % descending, and the order settles once they load.
- [ ] Hiding or reordering other columns does not reset the chosen value.
- [ ] The menu closes on Escape, on an outside click, and is not covered by
  the columns to its right.
- [ ] Other headers still sort on a single click, with no menu.

## Product regression

- [ ] Cluster import, switching, rename, removal and refresh work.
- [ ] Pod Terminal and Node SSH connect, resize and disconnect correctly.
- [ ] Pod Drawer logs and YAML (dry-run, apply, reset, reload) work.
- [ ] Global Search, Problems and Port Forward work.
- [ ] LLM status, preview and analysis work without receiving Kubernetes logs.
