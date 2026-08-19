# KubeDeck 2.13.0 regression checklist

Automated gates below ran and passed during development, including new tests
pinning the connect/disconnect contract, the Metrics API parser, scrape
deduplication, the two storage grids and the aligned refresh timers. Manual items
stay open until someone runs them on a real cluster.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## Cluster connect and disconnect

- [ ] Import a kubeconfig and leave it alone: the new cluster shows a dim ring
  and no kubectl process appears for it.
- [ ] Left click connects and opens it; the ring turns green.
- [ ] Right click offers Connect and Disconnect, with the one matching the
  current state greyed out.
- [ ] Disconnect a cluster with nothing open: it goes dim immediately and no
  confirmation appears.
- [ ] Start a port forward, then disconnect: the dialog names the port forward,
  cancelling leaves it running, confirming closes it.
- [ ] Open a pod terminal and a node SSH session, then disconnect: both are named
  and both close on confirm.
- [ ] After disconnecting, browse the same cluster's resource lists without
  clicking its rail button: no usage sampling restarts and no watch reopens.
- [ ] Disconnect while a resource table is open: the table stops updating and
  no `kubectl get --watch` process for that cluster remains.
- [ ] Reconnect afterwards: the usage panel starts from an empty window rather
  than showing the history collected before the disconnect.
- [ ] Disconnect the cluster currently being viewed, then click it again: it
  reconnects and reopens.
- [ ] Restart KubeDeck with several clusters configured: only the reopened one is
  green.
- [ ] With eight clusters configured and one connected, confirm the process list
  holds kubectl processes for that cluster only.

## Usage sampling

- [ ] A pod using single-digit millicores shows a fractional reading rather than
  a value rounded to a whole millicore.
- [ ] Leave a pod drawer open: the chart gains a bar roughly every 15 seconds.
- [ ] The panel's window toggle switches between the live hour and 24 h, and the
  percentiles beside each chart do not change when it does.
- [ ] A bar in the live view reports one value; a bar in the 24 h view reports an
  average, a maximum and a sample count.
- [ ] The Usage column in the table and the drawer chart agree for a pod whose
  memory is climbing.
- [ ] Memory around 400 MiB shows as `394.4Mi` rather than `403840Ki`; a pod at
  exactly 1 GiB shows `1Gi`.
- [ ] On a cluster without metrics-server the panel stays empty and no error
  banner appears.

## LLM

- [ ] The request/limit section gives a verdict for cpu and memory, not just the
  measured comparison.
- [ ] A pod with a handful of restarts over weeks is not described as restarting
  frequently.
- [ ] A short observation window carries the coverage caveat exactly once.
