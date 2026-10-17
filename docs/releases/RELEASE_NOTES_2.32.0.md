# KubeDeck 2.32.0 release notes

Bulk actions on nodes and pods now go out as one request, and a bulk drain
cordons every selected node before it drains any of them.

## Bulk actions in one request

Delete on many selected objects, and Cordon, Uncordon, Drain and Labels on
many selected nodes, used to run one object at a time, each with its own
permission check. They now run as one request:

- Each permission is checked once for the whole selection, not once per
  object. An object fails only if its own permission was refused.
- **Delete** removes every selected object of a namespace with one
  `kubectl delete`. Objects in several namespaces are deleted side by side.
- **Cordon** and **Uncordon** change every selected node with one command.
  If one of the nodes no longer exists, kubectl stops the whole command; the
  other nodes are then changed without it, and only the missing one is
  reported.
- **Labels** are changed on five nodes at a time.
- If some objects fail, the error names them and the rest keep their change.
  Every object still has its own entry in Local activity.

## A drain cordons every node first

Draining nodes one after another let pods evicted from the first node be
scheduled onto the next node in the selection, which then had to evict them
again. A drain now:

1. cordons every selected node with one command, so none of them can take new
   pods;
2. then drains five nodes at a time.

A node that could not be cordoned is not drained. The confirmation shows the
cordon command first, then a drain command per node.

## Safer action requests

A name or namespace beginning with "-" - `--all`, for example - is refused
before it reaches kubectl, where it would have been read as a flag.
Kubernetes names never begin with "-", so nothing that worked before is
affected.

## Verification

Node-only ownership moves to Node 60 / Python 0: one route was added,
`POST /clusters/{cluster_id}/resources/{resource}/bulk-action`.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **336 tests**, up from 334: the drain preview
  shows one cordon for all nodes before the drains; one bulk answer is read
  back as a result per row, a row the answer leaves out is a failure, and a
  refused request fails every row
- `npm --workspace apps/desktop run test:gateway` - **238 tests**, up from
  230: a delete asks once per namespace and names every object of a namespace
  in one command; a partial delete reports each object by what kubectl
  printed; a refused permission fails only the objects that needed it; a
  drain cordons every node in one command, retries without a missing node,
  and drains at most five at once; a cordon that got through some nodes is
  not repeated; labels ask once; the confirmation must list the same objects
  in the same order; a name beginning with "-" is refused by both action
  routes
- A bulk delete with one missing pod was run against a k3s 1.35 cluster in a
  throwaway namespace: the two pods were deleted with one command and the
  missing one reported NotFound. The multi-node cordon behaviour was checked
  there with `--dry-run=server`
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.32.0`
- `/migration/status` remains `node-only`, Node 60 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.32.0.md](./REGRESSION_CHECKLIST_2.32.0.md).
