# KubeDeck 2.16.1 release notes

The pagination bar sits at the bottom of the window now, instead of riding up
under the last row with the rest of the window left empty below it.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## What was wrong

A resource table is laid out as a column: the header and the toolbar keep their
height, the rows take whatever is left and scroll, and the pagination bar keeps
its height at the bottom. That only works if the panel holding them fills the
window - and it did not.

The rules meant to stretch it named `.table-surface`, an element left behind by
an earlier layout that no component renders any more, so they matched nothing.
The panel was therefore only as tall as its own contents. With a namespace full
of pods that was invisible, because the contents already filled the window. On
a list of three CronJobs or five nodes, the pagination bar ended up a couple of
centimetres below the title with the rest of the window empty underneath it.

## What changed

Those rules now name the panel the layout actually has. The panel fills the
window, the rows take the space that is left, and the pagination bar rests
against the bottom edge whatever the row count.

The empty state moved with it. With no rows there is nothing to scroll, and a
lone header row holding the free space would have pushed "Nothing here yet"
down beside the pagination bar; the message takes that space instead and sits
centred in it, which is where a reader looks for it.

This was also the reason the columns popover was cut off before 2.15.2 - the
panel it opened from ended just below the toolbar. That was fixed from the
other side by moving the popover out of the panel, and both fixes stand.

## Nothing else moved

Sorting, filtering, column reordering and resizing, row selection, the sticky
header and the page-size control all behave exactly as they did. Tables that
live inside another panel - the Problems view - are untouched.
