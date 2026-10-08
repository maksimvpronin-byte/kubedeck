# KubeDeck 2.29.1 release notes

A large list of custom resources no longer freezes KubeDeck, and it opens
instead of failing on its size.

## Argo CD Applications in all namespaces

With 2.29.0, opening Applications across all namespaces on a cluster with many
of them could freeze the application, and the table reported that the answer
was too large.

- An Argo CD Application carries its whole resource tree and sync history.
  Over all namespaces that was more than 64 MB, and the watch that keeps the
  table current held every Application whole in memory - twice, when a
  namespace was watched as well.
- A watched custom resource is now kept as the table shows it: name,
  namespace, labels, age and status - a few hundred bytes instead of the whole
  object. The rows are the same as before. The drawer, YAML and Describe still
  read the full object from the cluster when it is opened.
- A table and its watch read the list once instead of side by side, and that
  read is no longer cut off at 64 MB.
- The first open of a very large list still takes a moment to read; after it,
  changes are applied as they come.

If a cluster still behaves differently than with kubectl, Settings → General →
"Read through the Kubernetes API directly" turns the direct reads off.

## Verification

Node-only ownership stays at Node 59 / Python 0, and no route changed.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **320 tests**, unchanged
- `npm --workspace apps/desktop run test:gateway` - **229 tests**, up from 226:
  a custom resource is kept in memory cut down to the fields its row reads,
  and gives the same row as the whole object; a table's load and its watch
  read the list once, and the load is answered from the watch; a load never
  starts a kubectl watch, and a scope that cannot be watched over the API is
  not retried from a load at once
- Both suites also on Node 22.12, the version CI runs
- Run against a live k3s 1.35 cluster: `npm run smoke:cluster`; a custom
  resource list over all namespaces answered from its watch, cut down
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.29.1`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.29.1.md](./REGRESSION_CHECKLIST_2.29.1.md).
