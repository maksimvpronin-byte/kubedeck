# KubeDeck 2.15.2 release notes

The **Columns** popover is no longer cut off. On Nodes it was cut off almost
every time - the list of columns is longer than the list of nodes.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## Why Nodes and not Pods

The popover was positioned inside the resource table panel, and that panel is
only as tall as its own content. A namespace full of pods fills the window, so
the popover had room below the button and opened whole. A cluster has three or
five nodes, so the panel ended a little below the toolbar - and the panel clips
what overflows it, so the popover was cut mid-row. Which columns were reachable
depended on how many rows the table happened to have.

`position: fixed` would not have escaped it either: the panel declares
`container-type: inline-size` for its container queries, and that makes the
panel the containing block for fixed children as well, so the clip still
applied. The popover had to leave the panel's subtree.

## What changed

The popover is rendered into the document body and positioned from the
rectangle of the button that opens it. Being outside the table panel, nothing
clips it - it is bounded by the window instead:

- it opens above the button when there is more room there,
- its height is capped to the space actually available, and the list scrolls
  inside that,
- it stays inside the window horizontally, however far right the button sits,
- it follows the button when the window is resized or the content behind it
  scrolls.

`Escape` now closes it, which it did not before, and a click anywhere outside
still does.

## Nothing about the columns themselves changed

The same columns are listed in the same order, dragging and resizing columns in
the header works as before, the last visible column still cannot be unchecked,
and **Reset columns** still restores the default set. The button keeps its
appearance in both themes.
