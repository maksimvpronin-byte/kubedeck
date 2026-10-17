# KubeDeck 2.32.0 regression checklist

2.32.0 runs bulk actions as one request and cordons every selected node
before a drain. Node-only ownership moves to Node 60 / Python 0: one route
was added, `POST /clusters/{cluster_id}/resources/{resource}/bulk-action`.

The 2.31.0 checklist and the earlier ones still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (336 tests, up from 334)
- [x] `npm --workspace apps/desktop run test:gateway` (238 tests, up from 230)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.32.0`
- [x] `/migration/status` remains `node-only`, Node 60 / Python 0

## Bulk delete

Use a test cluster: these steps delete and change objects.

- [ ] Select pods in two namespaces and Delete: all of them go Terminating and
  disappear; Local activity shows a `resource.delete` entry per pod.
- [ ] Select a pod, delete it from a terminal, then Delete the selection in
  KubeDeck: the error names only that pod; the others are deleted.
- [ ] As a user who may delete pods in one namespace only: the error names the
  pods of the other namespace, and the allowed ones are deleted.

## Cordon, uncordon and drain

- [ ] Select three nodes and Cordon: the preview is one `kubectl cordon` line
  with all three; after confirming all three are SchedulingDisabled.
- [ ] Uncordon the same three: one `kubectl uncordon` line; all three are
  schedulable again.
- [ ] Select three nodes and Drain: the preview shows one cordon line for all
  three, then a drain line per node. After confirming, all three are
  cordoned at once before any pod is evicted, and no evicted pod is scheduled
  onto another of the three.
- [ ] Drain six or more nodes: no more than five drain at the same time.
- [ ] Local activity shows `resource.cordon` and `resource.drain` per node.
- [ ] As a user who may not patch nodes: the error names the nodes, and
  nothing is changed.

## Labels

- [ ] Change labels on several nodes: each node gets what it needs; Local
  activity shows `resource.label` per node.

## Updates

- [ ] An installed 2.31.0: Check for updates shows 2.32.0 with these notes and
  without their Verification section.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] A single delete, restart, scale and drain from a resource drawer still
  work as before.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.31.0 installer build offers 2.32.0 and installs it without the wizard.
- [ ] Help and About report **2.32.0**.
