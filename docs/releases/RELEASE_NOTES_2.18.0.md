# KubeDeck 2.18.0 release notes

Node labels stop being decoration, and node annotations reach the interface at
all. The Labels cell used to read `Role: true · Type: k3s · OS: lin… +1`, with
everything it hid stuffed into a native tooltip.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## Roles are not labels

`node-role.kubernetes.io/control-plane` carries no value, or the value `true`.
The meaning is in the suffix of the key, which is why a chip reading
`Role: true` said nothing at all.

Roles now have a column of their own, where kubectl puts them, listing
`control-plane`, `worker`, `etcd` as words. The pre-1.16 `kubernetes.io/role`
spelling that some distributions still write is read too. The column sorts and
filters like any other, and roles no longer take up room among the labels.

## The labels shown are the ones that tell nodes apart

A label nobody aliased is a label somebody in this cluster chose - `team`,
`gpu`, a vendor's own - and it distinguishes one node from another in a way
`OS: linux` on every row never will. Those now come first, then topology
(region, zone, instance type), then the generic OS, architecture and hostname.

Two chips are shown instead of three, because two read in full beat three cut
in half at the width of the column.

## The rest of them are readable now

`+N` opens a popover rather than filling a native tooltip: every label as
`key=value`, monospace, scrollable, rendered into the page body so nothing
clips it.

**Clicking a label filters the list by it.** A chip in the cell or a row in the
popover puts `key=value` into the filter box, which turns labels into a way to
slice a node list instead of something to squint at. Clicking a chip does not
open the node - the row still opens from anywhere else in it.

## Labels and annotations, whole, in the node drawer

A new section on a node's Summary shows both, in full: complete keys, values in
a monospace column, nothing truncated - a key too long for the column wraps
rather than ending in an ellipsis.

Entries are grouped by the domain in front of the slash, which is the one split
that needs no curated list of interesting keys: it says who wrote the entry.
What somebody here set - a bare key, or one under their own domain - leads and
is open; the dozens that Kubernetes, the CNI and the cloud controller write for
themselves follow, collapsed, under their own domains.

A filter box searches keys and values across both. Each group can be copied.
An annotation holding a whole JSON document is held back behind **More**
instead of pushing everything else off the screen, and
`kubectl.kubernetes.io/last-applied-configuration` is left out entirely - it is
the object again, and the YAML tab already has it.

## Under the hood

Both popovers - this one and the columns menu from 2.15.2 - now place
themselves through one shared helper instead of two copies of the same
arithmetic.
