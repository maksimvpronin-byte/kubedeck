# KubeDeck 2.11.0 regression checklist

Automated gates below ran and passed during development, including new tests
written specifically to pin the fixed behaviors (namespace scope ownership,
watch-refresh coalescing, cluster rail, packaged icon contract). Manual items
stay open until someone runs them on a real cluster and a packaged Windows
build.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 56 / Python 0**

## Namespace scope of the resource table

- [ ] Open Pods in a single namespace, switch to `All namespaces`: the table
  goes through an empty/loading state and then shows pods of every namespace.
- [ ] Repeat the switch 5–10 times, including while pods are being created
  and deleted, on a cluster with many namespaces.
- [ ] Switching resource, namespace or cluster while a load is running never
  leaves rows of the previous scope on screen.
- [ ] A failing or timing-out load shows the error on an empty table, not on
  stale rows.
- [ ] Live updates still arrive within a few seconds while the table is idle.

## Cluster rail

- [ ] Switching clusters from the rail works, marks the active cluster and
  shows the opening state.
- [ ] Switching with unsaved YAML in the resource drawer asks for
  confirmation.
- [ ] An unavailable cluster is visibly marked and its retry screen works.
- [ ] The rail scrolls with 15+ clusters and keeps the import button
  reachable.
- [ ] Arrow-key navigation moves focus inside the rail; every button has a
  readable tooltip.
- [ ] Light, midnight and steel-graphite themes and a window narrower than
  1100px all keep the rail, navigation and topbar readable.

## Windows icon

- [ ] Packaged portable build: window, taskbar, Alt+Tab and pinned icons are
  KubeDeck, not Electron.
- [ ] Properties of the extracted `KubeDeck.exe` show the KubeDeck product
  name and version.
- [ ] `npm run dev` also shows the KubeDeck window icon.

## Cluster kubeconfig editing

- [ ] Editing the kubeconfig of a non-active cluster saves, keeps a .bak copy
  and leaves the cluster openable.
- [ ] Editing the kubeconfig of the active cluster reopens it and its watch,
  port-forward, terminal and SSH sessions are closed.
- [ ] Saving a broken kubeconfig is rejected without touching the file.
- [ ] Saving requires typing the cluster name, and closing with unsaved
  changes asks for confirmation.
- [ ] The audit trail records the update without any file content.

## Product regression

- [ ] Cluster import, switching, rename, removal, namespace selection and
  refresh work.
- [ ] Pod Terminal and Node SSH connect, resize, copy-on-select and
  disconnect correctly.
- [ ] Pod Drawer logs and YAML (dry-run, apply, reset, reload) work.
- [ ] LLM status, preview and analysis work without receiving Kubernetes
  logs.
