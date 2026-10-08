# KubeDeck 2.29.1 regression checklist

2.29.1 keeps large custom resource lists from freezing KubeDeck. Node-only
ownership is unchanged at Node 59 / Python 0, and no route changed.

The 2.29.0 checklist and the earlier ones still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (320 tests, unchanged)
- [x] `npm --workspace apps/desktop run test:gateway` (229 tests, up from 226)
- [x] Both suites on Node 22.12
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.29.1`
- [x] `npm run smoke:cluster` against a live cluster
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Large custom resource lists

- [ ] Argo CD → Application, scope All namespaces, on a cluster with many
  Applications: the list opens, with no "output is too large" error, and the
  window stays responsive afterwards.
- [ ] Leave it open for a few minutes while Argo CD syncs: rows update, and
  KubeDeck's memory (Task Manager) stays steady instead of growing.
- [ ] Switch to the `argocd` namespace and back to all: both answer at once.
- [ ] Open an Application's drawer: YAML and Describe show the whole object,
  status and resource tree included.
- [ ] Settings → Diagnostics → Resource watch: one watch per scope, no pid.
- [ ] Another CRD (cert-manager Certificates, Longhorn volumes): columns and
  status as in 2.29.0.

## Updates

- [ ] An installed 2.29.0: Check for updates shows 2.29.1 with these notes and
  without their Verification section.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.29.0 installer build offers 2.29.1 and installs it without the wizard.
- [ ] Help and About report **2.29.1**.
