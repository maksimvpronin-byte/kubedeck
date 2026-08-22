# KubeDeck 2.15.1 release notes

Collapsing and expanding groups works again in Compare manifests. Since folding
arrived in the diff, **Collapse top-level groups** left every group stuck: the
chevrons flipped open, the rows stayed hidden, and only **Expand all** could
recover.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## What was wrong

The two panes of the diff render the same rows, but the fold regions were
computed twice - once from the left manifest, once from the right - and each
copy carried its own key, built from that side's line numbers. For a block
present on both sides that meant two keys for one visible fold.

Clicking a chevron toggled one of them. The other stayed in the collapsed set
and kept the rows hidden, while the chevron - which read only the key it
toggled - had already redrawn itself as open. So the arrow said "expanded" and
the group stayed folded, and clicking it again just folded and unfolded the key
nothing was reading.

Collapsing a single group by its own chevron worked, because only that one key
was ever added. **Collapse top-level groups** added both keys at once, which is
why the button that collapses everything was also the one that made expanding
impossible.

## What changed

A fold is now identified by the span of diff rows it covers rather than by a
side and a line number, and the left and right region of the same block merge
into one fold - the wider of the two, since the panes are aligned row for row.
One fold, one key, one collapsed state that both panes read.

Two smaller things fell out of the same rewrite:

- A fold no longer swallows the rows that follow it. Rows the other side added
  carry no line number on this side, and the region scan used to keep absorbing
  them past the end of the block, so collapsing `metadata` could also hide an
  added line that belonged to `spec`.
- The chevron is drawn only on the pane that actually has a line on that row,
  instead of appearing beside a blank padding line.

Collapsed groups are also forgotten when the compared resource changes, and any
key that no longer names a fold is dropped - **Expand all** used to stay
enabled with nothing left to expand.

## Everything else

Unchanged. The diff itself, the Clean/Raw switch, the synchronized scrolling
and which groups are foldable all behave exactly as in 2.15.0.
