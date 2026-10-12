# KubeDeck 2.30.1 regression checklist

2.30.1 makes a saved kubeconfig take effect on screen and keeps a kubeconfig's
line endings. Node-only ownership is unchanged at Node 59 / Python 0, and no
route changed.

The 2.30.0 checklist and the earlier ones still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (327 tests, up from 323)
- [x] `npm --workspace apps/desktop run test:gateway` (229 tests, unchanged)
- [x] Both suites on Node 22.12
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.30.1`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Kubeconfig editor

- [ ] Break a cluster's kubeconfig (for example a wrong port), open the
  cluster: the "cluster unavailable" panel shows the error.
- [ ] Cluster menu → Edit kubeconfig, fix it, type the name, Save: the cluster
  connects straight away, without waiting for the background retry.
- [ ] Break it differently and save: the error on screen changes to the new
  one at once.
- [ ] Edit the kubeconfig of the active, working cluster: it reconnects and its
  tables load as before.
- [ ] Edit the kubeconfig of a connected cluster that is not the active one:
  the rail shows it disconnected; opening it connects with the new kubeconfig.
- [ ] The same edit from Settings → Clusters behaves the same way.
- [ ] A kubeconfig with CRLF line endings (written by Notepad): the editor
  opens with Save disabled; after an edit and Save the file still has CRLF on
  every line (`.bak` beside it holds the previous version).
- [ ] An LF kubeconfig is saved in LF.

## Updates

- [ ] An installed 2.30.0: Check for updates shows 2.30.1 with these notes and
  without their Verification section.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.30.0 installer build offers 2.30.1 and installs it without the wizard.
- [ ] Help and About report **2.30.1**.
