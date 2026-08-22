# KubeDeck 2.16.0 release notes

A found match is now something you can see rather than something you are about
to overwrite, and the log viewer searches the way the manifest editor does.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## Enter after a search no longer eats the match

Typing a query in **Find in YAML** and pressing Enter jumped to the first
occurrence - and moved the focus into the editor with that occurrence
*selected*. The second Enter, the one that should have stepped to the next
match, went to the editor instead of the search box, and since 2.15.0 Enter in
the editor inserts a newline. A newline over a selection replaces it: the text
that had just been found was deleted, and the manifest was left dirty.

The match is no longer selected. The editor paints it as a decoration - visual
only, and nothing a keystroke can replace. The caret does not move and the
focus stays in the search box, so Enter and Shift+Enter keep stepping through
the matches for as long as you keep pressing them.

## Every match is visible, not only the one you are on

All occurrences in the manifest are tinted, and the one being stepped to is
picked out with a stronger fill and an outline, so the distribution through the
document is readable at a glance. The highlight follows the text when the
manifest is edited, and is recomputed from the draft on every change, so it can
never end up painted over text that has moved. Repainting never scrolls -
only an explicit jump does, and a jump still opens any fold hiding its match.

Stepping backwards from a fresh query now lands on the **last** match. It used
to land on the second to last one and quietly skip the end of the document.

## The log viewer searches like the manifest editor

Searching logs used to be a filter and nothing else: matching lines were kept,
the first occurrence in each was marked, and there was no way to walk through
them.

The filter stays exactly as it was - **Current view** still downloads the lines
the filter left - and the search gains what the YAML search has: a `3/17`
counter, up and down arrows, `Enter` and `Shift+Enter` to step, and the log
pane scrolling the current occurrence into the middle. Every occurrence in a
line is marked now, not just the first, and the current one is accented in the
same colours the manifest editor uses.

Both searches are the same code underneath, so the counters count the same
things and stepping behaves identically in both tabs.

## Note for followed logs

With **Follow** on, new lines keep arriving and the pane keeps scrolling to the
bottom, which will fight a search in progress. Turn Follow off while stepping
through matches.
