# KubeDeck 2.13.1 regression checklist

Automated gates below ran and passed during development, including a new test
that connects a cluster, saves settings and asserts the response still carries
the connection state. Manual items stay open until someone runs them on a real
cluster.

The 2.13.0 checklist still applies in full: this release changes nothing else,
and its manual items were not superseded.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## Settings and the cluster rail

- [ ] Connect a cluster, open Settings, change anything and press Save: the
  badge stays green and the resource table keeps updating.
- [ ] Do the same with several clusters connected: all of them keep their state.
- [ ] Save settings while one cluster is connected and another is not: the
  disconnected one stays grey rather than turning green.
- [ ] Change the language and save: the rail keeps its connection state through
  the re-render.
- [ ] Save settings, then disconnect a cluster: the disconnect still works and
  still asks about open sessions.

## LLM

This release touches how settings are saved, and the LLM configuration lives in
those same settings, so the connection to the model is worth a smoke check.

- [ ] Open Settings, change an LLM field and save: the value survives a reopen.
- [ ] Run an analysis on a pod afterwards: it still answers, in Russian, with
  the request/limit section intact.
