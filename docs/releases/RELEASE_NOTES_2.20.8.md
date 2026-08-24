# KubeDeck 2.20.8 release notes

One dead rule comes back to life, and the thing that killed it is gone. No route
changes. Node-only ownership stays at Node 58 / Python 0.

## The keystone

`layout.css` declared the generic primary button like this:

```css
.primary {
  background: var(--primary) !important;
}
```

`!important` on a selector with a specificity of 100. That is the weakest kind
of rule there is, and it was beating every stronger one. Anything that wanted a
different primary-button colour - the drawer, the terminal toolbar, the Watch
form - could only win it back by carrying `!important` too, and then those
rules could only settle it between themselves by growing more specific. That is
where selectors like

```
.pod-drawer .drawer-content button.primary:not(.danger):not(.danger-button):hover
```

came from. The `!important` is gone.

## What was broken by it

```css
/* diagnostics-panels.css */
.watch-start-form button.primary { background: var(--surface-active); }
```

Specificity 201, and it lost to a rule with a specificity of 100. **This rule
was dead.** The Start watch button in Watch diagnostics has been showing the
generic primary colour instead of the muted one it asks for. It now shows the
right one.

That is the single visible change in this release.

## What else moved

```
!important in renderer/styles:  280 -> 227
```

Taking the keystone out made 52 more declarations dead, and those are gone too -
removed by iterating to a fixed point, three passes.

Verified by a cascade change report: **27 outcomes flipped, 26 of them on pairs
of selectors that cannot land on the same element** - a button against the `svg`
inside it, `.yaml-toolbar` against its own child `.yaml-search-row`, each checked
against the markup - and **one real**, the `.watch-start-form` fix above.

## Why it stops at 227 and not under 60

The remaining 227 live in `drawer-controls.css` (119) and `related-panel.css`
(92). Both were written `!important`-first: inside them a weak rule routinely
beats a strong one, so **no single removal is safe** and the greedy pass stops
immediately.

Untangling them means rewriting both so that specificity carries the intent, and
that cannot be done by analysis: it is not statically provable that two selectors
never land on the same element. The first version of the rival test - "they share
a class" - paired almost everything in a stylesheet where all of it sits under
one container class. Tightening it to compare the selector's *subject* (the
compound after the last combinator) removed many false pairs but not the limit
itself. Only the DOM knows.

So those two files need rewriting against the running application, theme by
theme. That is a piece of UI work, not a refactoring patch, and it is not
scheduled.

## What holds the line instead

`scripts/css-cascade.cjs` is the one tool from this whole refactor that is
committed rather than thrown away:

- `report` - how many `!important` there are, which are load-bearing, and what
  each one is beating.
- `report --check` - a ratchet, wired into `npm run verify` as `npm run
  lint:css`. An `!important` on a selector weaker than specificity 200 has to
  carry a comment saying what it overrides. There are 114 without one; that
  number is the budget. New ones are refused, and every removal should be
  followed by lowering it.
- `snapshot` / `diff` - who wins, over 18211 competing declaration pairs, before
  and against after. Here the cascade changes on purpose, so this is a report to
  read rather than a gate.

## One gate change

`scripts/verify-release.cjs` pins the exact text of the root `verify` script so
the gate cannot be quietly weakened. Adding `lint:css` to it tripped that
assertion, which is the check working as intended: the expected string is
updated in the same commit, deliberately and visibly.

## This is the last of eight

`docs/file-structure-refactor-plan.md` is complete. Two of section H's targets
were not met and are marked as such rather than quietly dropped.
