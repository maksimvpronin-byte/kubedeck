# KubeDeck 2.29.0 regression checklist

2.29.0 reads and watches through its own Kubernetes API client instead of a
kubectl process per request, and opens custom resources that used to time out.
Node-only ownership is unchanged at Node 59 / Python 0, and no route changed.

Earlier 2.13.x through 2.28.3 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (320 tests, unchanged)
- [x] `npm --workspace apps/desktop run test:gateway` (225 tests, up from 191)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.29.0`
- [x] `npm run smoke:cluster` against a live cluster, with and without
  `KUBEDECK_SMOKE_DIRECT_API=0`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Reads through the API

- [ ] Settings → open the logs folder, `desktop.log`, after browsing a few
  tables: reads appear as `node api GET https://...`, not as
  `node kubectl preview=... get`.
- [ ] Walk every built-in tab (Workloads, Network, Storage, Config, RBAC, Nodes,
  Namespaces, Events): each loads with the same columns and rows as in 2.28.3.
- [ ] Pods and Nodes: CPU and memory columns fill in; node percentages match
  `kubectl top nodes`.
- [ ] Namespaces: usage and quota columns as in 2.28.3.
- [ ] Search, Overview, Problems, a drawer's Related and Events tabs: same
  results as in 2.28.3.
- [ ] Secrets: reveal and edit a Secret as before.
- [ ] A cluster that signs in through kubelogin / EKS / GKE: opens and lists;
  `desktop.log` shows one `node api exec credential` line, not one per read.
- [ ] Behind a corporate proxy (HTTPS_PROXY set, the cluster in NO_PROXY or
  not): lists load as they did through kubectl.
- [ ] A kubeconfig with `insecure-skip-tls-verify`, and one without a CA for a
  publicly signed endpoint: both list.
- [ ] A cluster that cannot be reached (VPN off): the unavailable screen with
  its error, as before, and it reconnects when the VPN is back.
- [ ] A namespace you may not list: the permission error, as before.
- [ ] Settings → General → turn off "Read through the Kubernetes API directly",
  save, refresh a table: `desktop.log` shows kubectl again. Turn it back on.

## Custom resources

- [ ] Argo CD → Application in the `argocd` namespace: the list opens, well
  inside the 30-second limit.
- [ ] Other CRD instances (cert-manager, Longhorn, Cilium...): lists as before;
  a cluster-scoped CRD lists with the scope locked to cluster.

## Watched tables

- [ ] Open Pods in a busy namespace and leave it: rows change as pods change,
  and `desktop.log` shows no new `node api GET .../pods` list per change.
- [ ] Delete a pod from KubeDeck: its row goes and does not come back; the
  replacement pod appears.
- [ ] Scale a deployment from KubeDeck: the replica count updates.
- [ ] Settings → watch diagnostics: the table's watch is listed, running, with a
  `GET ...?watch=1` preview and no pid.
- [ ] Leave a table for another and come back within a minute: rows are there
  at once.
- [ ] Turn the VPN off for a minute with a watched table open, then on: the
  table catches up without a manual refresh.

## Updates

- [ ] An installed 2.28.3: Check for updates shows 2.29.0 in the panel, with
  these notes and without their Verification section.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.28.3 installer build offers 2.29.0 and installs it without the wizard.
- [ ] Help and About report **2.29.0**.
