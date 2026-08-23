# KubeDeck 2.19.0 release notes

Nodes can be sorted and filtered by an annotation. The annotations that 2.18.0
brought into the drawer reach the table too, in the only form that makes sense
for them.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## Why not simply "sort by annotations"

The Labels column already sorts, and it shows what a whole-set sort is worth:
it compares every label joined into one string, alphabetically by key, and on
nodes the first key is nearly always `beta.kubernetes.io/arch=amd64` - the same
on every row. The order does not change. Sorting by annotations as a set would
have compared strings all starting with `alpha.kubernetes.io/provided-node-ip`.

What sorts is **one chosen annotation**.

## Sorting by a chosen key

The **Annotations** column's header opens the same menu the Usage column has
had since 2.12: a list of what to sort by. The difference is that a usage
column's metrics are three known numbers, while annotation keys belong to the
cluster, so the list is built from the keys the loaded nodes actually carry -
the ones on the most nodes first, so the list stays a list somebody can read.

Values compare the way the rest of the table compares text, counting rather
than spelling, so a `ttl` of `5` sorts before `30`. A node without that
annotation has nothing to compare with and sits at the low end, which is where
a node without a usage reading already sits, so a descending sort puts them
last.

## The column

`8 annotations` in the cell, opening the same popover the labels `+N` opens:
every key with its value beneath it, monospace, scrollable, rendered into the
page body so nothing clips it. There are no chips - an annotation's value is a
JSON document or a command line, and none of that reads at the width of a
column.

Clicking an entry filters the node list by `key=value`, exactly as a label chip
does, and typing in the table's filter box now searches annotations too - it
could not before, because the filter only ever searched the columns on screen
and annotations had no column.

**The column starts hidden.** Most annotations are written by the CNI and the
cloud controller for themselves; the column is there for the clusters where
somebody put something in them worth sorting by. Tick **Annotations** in the
columns menu to bring it in. This is the first column in KubeDeck that ships
hidden, and **Reset columns** now restores that default rather than showing
everything.

## Under the hood

The three popovers - the columns menu, the labels `+N` and this one - now share
one hook that places them, dismisses them on `Escape` or a click outside, and
keeps them attached to their button while the window resizes or the content
scrolls. Each carried its own copy of that effect before.

The renderer's contract tests also load relative imports for real now. A module
that imported another renderer module used to be handed an empty object for it,
so anything it called there was `undefined` at run time - which is exactly the
kind of thing these tests exist to catch.
