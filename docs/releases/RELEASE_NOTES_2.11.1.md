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
/api/v1/nodes/<node>/proxy/stats/summary` process for every node — the
kubelet summary endpoint is slow and the process is not cheap — and the
renderer ran two of them at a time, so a cluster with many nodes filled its
disk bars in a long sequence of rounds. Four changes:

- the fan-out went from two to twelve concurrent requests, on both the
  renderer and the backend bulk path;
- serving the nodes list now starts the disk fetches in the background
  instead of waiting for the table to ask for them, so the kubelet round
  trips begin while the table is still painting;
- overlapping lookups of the same node — nodes table, cluster overview and
  that background warm-up — share one in-flight request instead of starting a
  kubectl process each;
- the cache window moved from 30 seconds to 5 minutes on both sides. Node
  filesystems fill over hours, and the short window meant paying the full
  per-node cost again on practically every visit to the table.

Row updates are also coalesced into one table update instead of re-rendering
the table once per node.

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

## Unchecking a namespace moved it back into the list

Selected namespaces are held at the top of the selector menu. Unchecking one
returned it to its alphabetical position immediately, which on a cluster with
many namespaces means it disappears from under the cursor and has to be found
again to be re-checked.

Every namespace touched while the menu is open now stays in the block at the
top, checked or not, with a divider between that block and the alphabetical
rest.

The block also survives closing the menu: a namespace stays in it for 15
minutes after it was last part of the selection, most recently used first, so
coming back to re-pick something from a few minutes ago does not mean scrolling
through hundreds of names. After that it ages out and returns to alphabetical
order. The order is recomputed only when the menu opens — never while it is on
screen — so no row moves under the cursor. Recency is tracked per cluster and
is not persisted across restarts.

## Pods without a CPU limit showed no CPU usage

CPU limits are omitted far more often than memory limits, and the pod usage
bars were computed only against a limit, so most pods showed `No limit` with
the actual reading hidden in the tooltip.

The Usage column now falls back in three tiers: against the limit when one is
set, otherwise against the request, otherwise the raw reading (`10m`, `32Mi`)
in place of the percentage. A ratio against a request is shown unclamped and
marked as a softer baseline — a request is a scheduling floor, not a ceiling,
and a pod running at 250% of its request is exactly what is worth seeing.
