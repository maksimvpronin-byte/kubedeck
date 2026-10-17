# KubeDeck 2.32.1 release notes

Changing labels on many nodes now runs one command for all the nodes that get
the same changes.

## The same labels in one command

In 2.32.0 a label change on many nodes still ran one `kubectl label` per node,
five at a time. Now:

- Nodes that get the same changes share one command:
  `kubectl label nodes worker-01 worker-02 worker-03 maintenance=planned --overwrite`.
  Setting one label on every selected node is a single command.
- Nodes that need different changes - one already has the value, another
  still carries a label being removed - get one command per distinct set of
  changes.
- The command preview in the Labels dialog groups the nodes the same way, so
  it still shows exactly what runs.
- A node that no longer exists is reported on its own; the other nodes keep
  their change.
- Every node still has its own entry in Local activity.

## Verification

No route changes. Node-only ownership stays at Node 60 / Python 0.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **336 tests**: nodes with the same changes share
  one line in the command preview, in the order they first appear, and nodes
  with different changes get a line each
- `npm --workspace apps/desktop run test:gateway` - **238 tests**: nodes with
  the same changes share one `kubectl label nodes` command and different
  changes get one each, every node keeps its own audit entry with its own
  changes, and a missing node fails alone without the command running twice
- How `kubectl label` treats several nodes and a missing one was checked with
  `--dry-run=server` against a k3s 1.35 cluster
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.32.1`
- `/migration/status` remains `node-only`, Node 60 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.32.1.md](./REGRESSION_CHECKLIST_2.32.1.md).
