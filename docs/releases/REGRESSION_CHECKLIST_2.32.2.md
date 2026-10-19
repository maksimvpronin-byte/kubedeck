# KubeDeck 2.32.2 regression checklist

2.32.2 restyles the placeholder of a saved resource tab whose object cannot be
shown. Node-only ownership is unchanged at Node 60 / Python 0, and no route
changed.

The 2.32.1 checklist and the earlier ones still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (336 tests)
- [x] `npm --workspace apps/desktop run test:gateway` (238 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.32.2`
- [x] `/migration/status` remains `node-only`, Node 60 / Python 0

## Resource tab placeholder

- [ ] Open a Deployment's pod as a saved resource tab, then restart the
  Deployment (`kubectl rollout restart`) and activate the tab: the card says
  *No longer in the cluster* with the hint about new pod names, and the tab
  label says *gone*.
- [ ] **Retry** looks again and keeps the card while the pod is still gone;
  **Close tab** closes the tab.
- [ ] Switch the interface to Russian: the card, both buttons and the tab label
  are in Russian.
- [ ] A tab of a cluster that does not answer: *Could not open* with Retry and
  Close tab.
- [ ] The card looks right in the light theme and in a dark one.

## Updates

- [ ] An installed 2.32.1: Check for updates shows 2.32.2 with these notes and
  without their Verification section.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.32.1 installer build offers 2.32.2 and installs it without the wizard.
- [ ] Help and About report **2.32.2**.
