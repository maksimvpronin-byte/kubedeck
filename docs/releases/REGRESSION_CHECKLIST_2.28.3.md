# KubeDeck 2.28.3 regression checklist

2.28.3 opens a large cluster much faster, shows log colours, offers port
forwarding on each port of a Service and keeps the cluster name at the top of
the sidebar. Node-only ownership is unchanged at Node 59 / Python 0, and no
route changed.

Earlier 2.13.x through 2.28.2 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (320 tests, up from 307)
- [x] `npm --workspace apps/desktop run test:gateway` (191 tests, up from 187)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.28.3`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Opening a large cluster

- [ ] Open a cluster with over 1000 pods that was not open before: pod rows
  appear in well under a second after the click; note the time against 2.28.2
  on the same cluster.
- [ ] CPU and memory columns fill in within a few seconds, without a reload.
- [ ] Walk every built-in tab once (Workloads, Network, Storage, Config, RBAC,
  Nodes, Namespaces, Events): every table loads, with the same columns as in
  2.28.2. Secrets and ConfigMaps keep their own columns (type, keys).
- [ ] A CRD tab and its instances still load; the CRD tree appears a moment
  after the cluster opens.
- [ ] Switch namespace scope (one, several, all) on Pods and Deployments: rows
  match the scope.
- [ ] A cluster that cannot be reached still shows the unavailable screen with
  its error, and reconnects when it comes back.
- [ ] A cluster that signs in through an exec plugin (EKS/GKE/OIDC) opens and
  lists as before.
- [ ] Settings → open the logs folder, `desktop.log`: an open is one
  `get namespaces`, then `get --raw /api/v1/...` for the list; no
  `cluster-info`.
- [ ] Minimise the window for a minute with Overview open: `desktop.log` shows
  no `get namespaces` or Overview reads meanwhile; restoring it refreshes.

## Log colours

- [ ] Open the logs of a pod that colours its output (an ingress controller,
  a Node or Go service with coloured levels): levels show in colour, with no
  box and no `[32m` anywhere.
- [ ] Same log in each theme, light included: every colour is readable on the
  log background.
- [ ] Search for a word that is coloured: it is highlighted as one match, the
  arrows step through it, and the counter agrees.
- [ ] Copy, and Download → Current view: the text has no escape sequences.
  Download → Full log: the file is as the cluster sends it.
- [ ] Follow a coloured log for a minute: new lines arrive coloured and the pane
  stays at the bottom.

## Port forwarding a Service

- [ ] Open a ClusterIP Service with two TCP ports: "How to reach it" has a
  button for each, labelled with the port's name and number.
- [ ] Press the second one: the window opens on that port, and the port pills
  are only the Service's own ports - no targetPort, no nodePort.
- [ ] Start it: the session appears in Port Forwards and answers on localhost.
- [ ] A NodePort Service: its nodePort is not offered.
- [ ] An ExternalName Service: no button in the summary and no icon in the
  header.
- [ ] The header icon of a pod, a deployment and a Service is the two arrows,
  not the Related tab's icon.

## Sidebar

- [ ] Expand enough of the tree to scroll it: the cluster name and its menu stay
  at the top, and the tree passes under them with nothing showing above.
- [ ] The cluster menu opens from the pinned name over the workspace, not under
  it.
- [ ] Narrow window (icons only): the avatar stays at the top too.

## Updates

- [ ] An installed 2.28.2: Check for updates shows 2.28.3 in the panel, with
  these notes and without their Verification section.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.28.2 installer build offers 2.28.3 and installs it without the wizard.
- [ ] Help and About report **2.28.3**.
