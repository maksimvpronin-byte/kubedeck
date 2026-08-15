# KubeDeck 2.11.1 release notes

KubeDeck 2.11.1 is a patch release for three user-reported problems: node
usage charts took a long time to appear, the namespace selector lost its
selection while clicking through resources, and pods without a CPU limit
showed no CPU reading at all.

No new routes. Node-only ownership stays at Node 56 / Python 0.

## Node usage charts appeared slowly

Two independent causes.

The resource list route awaited `kubectl get` and only then started
`kubectl top`, so every load of Nodes, Pods and Namespaces paid for two
kubectl round trips in sequence. `kubectl top` and the resource quota lookup
do not depend on the list, so they now run alongside it; the same applies to
`kubectl top nodes` in the cluster overview.

Per-node disk usage is a separate `kubectl get --raw
/api/v1/nodes/<node>/proxy/stats/summary` process for every node, and the
renderer ran two of them at a time — on a cluster with many nodes that is a
long sequence of rounds. The renderer now fans out to six, matching the
backend's bulk path, and coalesces the resulting row updates into one table
update instead of re-rendering the table once per node.

## The namespace selector lost the selected namespace

Three places could silently replace a namespaced selection with
`All namespaces`.

The periodic namespace refresh rewrote the remembered per-cluster selection
unconditionally — including while a cluster-scoped resource such as Nodes was
open, which is exactly the selection that mode exists to protect, and
including for a cluster the user had already left. The refresh now leaves both
the namespace list and every remembered selection alone in those cases.

Restoring the namespaced selection fell back to `all` whenever no selection
was stored for the cluster, so a momentarily unknown cluster id discarded the
scope that was on screen. It now keeps the visible scope and only falls back
to `all` when there is no namespaced value to keep.

Opening a resource from Global Search, Events or Related always switched the
selector to that object's namespace and remembered it, collapsing an
`All namespaces` or multi-namespace selection to a single namespace for good.
It now narrows only when the current scope cannot show the target.

## Pods without a CPU limit showed no CPU usage

CPU limits are omitted far more often than memory limits, and the pod usage
bars were computed only against a limit, so most pods showed `No limit` with
the actual reading hidden in the tooltip.

The Usage column now falls back in three tiers: against the limit when one is
set, otherwise against the request, otherwise the raw reading (`10m`, `32Mi`)
in place of the percentage. A ratio against a request is shown unclamped and
marked as a softer baseline — a request is a scheduling floor, not a ceiling,
and a pod running at 250% of its request is exactly what is worth seeing.
