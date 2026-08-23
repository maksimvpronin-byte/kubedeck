# KubeDeck 2.20.2 release notes

Internal cleanup, and nothing about the application changed: not a colour, not
a spacing, not a state. No route changes. Node-only ownership stays at Node 58
/ Python 0.

## What moved

Three stylesheets carried a header calling them a hotfix for 1.0.5 or 1.1.1:

```
drawer-controls-polish.css     677 lines   139 !important
related-panel-polish.css       654 lines   228 !important
resource-summary-polish.css    516 lines     0 !important
```

Nine minor versions later they were still there, still named that way, and
changing anything about the drawer, the Related tab or a resource Summary meant
guessing which of two files would win. They are now named for what they are:

- `resource-summary.css`
- `drawer-controls.css`
- `related-panel.css` - the old 27-line `related-panel.css` merged into it, so
  the Related tab has one stylesheet instead of two.

Seventeen stylesheets instead of eighteen, each of the three starting with a
line about what it covers and why it loads where it loads.

126 `!important` declarations were removed, out of 406 in the folder.

## What the numbers turned out to be

The plan for this patch assumed the three files were an override layer to be
folded back into the base stylesheets. Reading all eighteen with a parser, in
the import order the renderer actually uses, said otherwise:

- **`resource-summary-polish.css` was never an override layer.** Not one of its
  75 selectors appears in any other stylesheet. It is simply the Resource
  Summary stylesheet, misnamed. There was nothing to fold it into.
- **`drawer-controls-polish.css` is barely one either** - 213 selectors, 8 of
  which appear elsewhere. Folding it into `drawer.css` would have been a bug:
  it loads *after* `terminal.css` on purpose, because some of its rules settle
  the primary-button colours `terminal.css` also sets with `!important`. Moving
  it earlier would have handed those buttons to `terminal.css` and changed
  their colour in the drawer.
- Only `related-panel-polish.css` was a real layer, over `related-panel.css`
  and `panels.css`. That is the one that got merged.

## Why most of the `!important` had to stay

280 of the 406 are load-bearing. Two reasons, and neither is fixable by moving
files around:

`layout.css` declares `.primary { background: … !important }` at specificity
100. Anything that needs a different primary-button colour - in the drawer, in
a terminal toolbar, in a modal - is forced to use `!important` too, after which
those rules can only settle it between themselves by specificity. That is where
selectors like `.pod-drawer .drawer-content
button.primary:not(.danger):not(.danger-button):hover` come from.

And inside the polish files themselves, `!important` holds their own ordering
together: they were written `!important`-first, so a low-specificity rule there
routinely beats a high-specificity one in the same file.

A first attempt that removed everything not contested by *another* file flipped
1044 cascade outcomes. Untangling this properly means reworking the button
cascade across the whole application, which is now section H of the plan with
its own release and its own regression pass.

## How "nothing changed" was established

A checker takes every pair of declarations that set the same property and share
a class in their selectors - the pairs that can fight over one element - and
compares which one wins, before and after. 18211 such pairs. Zero flipped, zero
disappeared, zero appeared.

That is a strong check, not a proof: it reasons about selectors, not about the
DOM they end up matching. The manual pass over the drawer, the Related tab and
Resource Summary on all eight themes is in the regression checklist for exactly
that reason.
