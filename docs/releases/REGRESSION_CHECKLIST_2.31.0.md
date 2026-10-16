# KubeDeck 2.31.0 regression checklist

2.31.0 adds label changes on many nodes at once. Node-only ownership is
unchanged at Node 59 / Python 0, and no route was added: the resource action
route takes one more action, `label`.

The 2.30.1 checklist and the earlier ones still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (334 tests, up from 327)
- [x] `npm --workspace apps/desktop run test:gateway` (230 tests, up from 229)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.31.0`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Node labels

Use a test cluster: these steps change nodes.

- [ ] Nodes: with nothing selected there is no Labels button; select two nodes
  and **Labels (2)** appears before Cordon.
- [ ] The dialog lists the nodes' own labels with "N of M" and their values;
  `kubernetes.io/hostname`, `os`, `arch` and `instance-type` are not listed.
- [ ] Roles and topology labels are in the folded "System labels" group.
- [ ] Set a label one node has and the other does not: "What will change"
  shows an add on one node and nothing or a change on the other.
- [ ] Remove a label only one node has: only that node gets a command.
- [ ] Add a new label: it goes on both nodes; `kubernetes.io/hostname` as a key
  shows an error and cannot be added; a value with a space cannot be applied.
- [ ] Apply: the Labels column updates for both nodes; Local activity shows a
  `resource.label` entry per node.
- [ ] Cancel, Escape and the backdrop close the dialog and change nothing.
- [ ] As a user who may not patch nodes: Apply shows a permission error naming
  the nodes, and nothing is changed.
- [ ] Russian interface: the button and the dialog are in Russian.

## Updates

- [ ] An installed 2.30.1: Check for updates shows 2.31.0 with these notes and
  without their Verification section.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Cordon, Uncordon and Drain still open their own confirmation and work.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.30.1 installer build offers 2.31.0 and installs it without the wizard.
- [ ] Help and About report **2.31.0**.
