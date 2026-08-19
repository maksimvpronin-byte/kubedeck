# KubeDeck 2.12.1 regression checklist

Automated gates below ran and passed during development, including new tests
pinning the fixed behaviours (a reading of zero, a metric that arrives late,
the pod-usage route, the table patch and the self-refreshing panel). Manual
items stay open until someone runs them on a real cluster.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 57 / Python 0**

## The Usage column

- [ ] Create a pod and watch its row: `N/A` turns into a reading within a
  minute or two, without touching refresh and without switching tabs.
- [ ] An idle pod shows `0m` rather than `N/A`.
- [ ] Leave the Pods table open for ten minutes: the numbers move on their own
  and the table does not flicker or lose its selection.
- [ ] Sort by the Usage column and leave it: a refresh that changes nothing
  does not reorder or re-render the rows.
- [ ] Delete a pod: its row disappears with the next watch event rather than
  keeping a stale reading.
- [ ] Stop metrics-server: readings stop updating and go blank within two
  minutes instead of freezing at the last value.
- [ ] A cluster without metrics-server shows the table with an empty Usage
  column and no repeating error.
- [ ] Switch namespaces and clusters while the table is open: usage always
  belongs to the rows on screen.
- [ ] Watch the kubectl process count while the Pods table sits open: the
  30-second usage refresh must add none.

## Usage history panel

- [ ] Open a freshly created pod: the panel goes from "no samples recorded
  yet" to a chart on its own, without reopening the drawer.
- [ ] An idle pod shows a CPU line at zero rather than empty percentiles.
- [ ] The recorded window matches how long the pod has actually been watched,
  not a multiple of five minutes.
- [ ] A pod whose memory arrived before its CPU shows a CPU average that
  matches the readings, not a fraction of them.

## History persistence

- [ ] Record some history, quit KubeDeck normally, start it again: the history
  is still there.
- [ ] Repeat with an SSH session and a port-forward open, so the shutdown has
  real work to do first.
- [ ] Open an existing history file written by 2.12.0: it loads and its
  percentiles are sane rather than empty.

## Product regression

- [ ] Cluster import, switching, rename, removal and refresh work.
- [ ] Nodes and Namespaces tables still show their usage columns.
- [ ] Pod Terminal and Node SSH connect, resize and disconnect correctly.
- [ ] Pod Drawer logs and YAML (dry-run, apply, reset, reload) work.
- [ ] Related resources, Global Search, Problems and Port Forward work.
- [ ] LLM analysis still receives the usage history section and answers in
  Russian.
