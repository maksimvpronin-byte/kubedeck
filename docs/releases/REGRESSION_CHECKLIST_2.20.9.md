# KubeDeck 2.20.9 regression checklist

One number changed how it is obtained: the disk percentage in a node's Summary
now comes from the main process instead of being recalculated in the renderer by
parsing a formatted size back into a number.

Everything is on the **node** drawer's Summary tab, and the thing to confirm is
that the Summary and the table now say the same thing.

Earlier 2.13.x through 2.20.8 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (115 tests)
- [x] `npm --workspace apps/desktop run test:gateway` (153 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## The disk bar

- [x] Connect a **cluster** and open **Nodes**. Node disk metrics are read per
  node when its rows come into view, so give the column a moment to fill in.
- [x] Note the percentage the Disk column shows on a node.
- [x] Open that node's drawer → **Summary**. The Disk bar shows **the same
  percentage** as the table. This is the point of the change: before, the two
  were calculated separately and could differ by a point.
- [x] The bar's label still reads used and capacity in the same units as before.
- [x] The CPU and RAM bars beside it are unchanged.

## Nodes where the probe is incomplete

These are the cases the fallback covers; if you have no such node, say so rather
than ticking.

- [x] A node whose disk metrics have not arrived yet: the bar shows `…` while
  loading, then `N/A` if nothing came - not a `0%` or a broken bar.
- [x] A node with no disk metrics at all: `N/A`, no percentage.
- [x] A node reporting usage above its capacity, if you have one: still clamped
  to 100%, not 137%.

## Nothing else moved

- [x] Namespace usage bars and pod usage bars, in the table and the drawer.
- [x] ResourceQuota usage bars in a quota's Summary.
- [x] The usage history chart on a pod.
- [x] Overview capacity tiles, which read the same node capacities.
- [x] Run an **LLM** analysis on a node: the context carries its capacity and
  usage, and still no Secret value or log line reaches the prompt.
- [x] Disconnect and reconnect the cluster: the Disk column refills and the two
  views still agree.
- [x] Help and About report **2.20.9**.
