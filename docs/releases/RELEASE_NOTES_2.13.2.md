# KubeDeck 2.13.2 release notes

KubeDeck 2.13.2 fixes three things that were visible but not reachable: numbers
in a light-theme terminal, a resource path broken one character per line, and a
YAML search that counted matches without going to them.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## Terminal numbers were invisible on the light theme

`top` printed its summary with the values missing entirely - labels visible,
numbers gone.

Only eight of the sixteen ANSI colours were being given to xterm. It fills the
rest from its own palette, which assumes a dark background, so the eight bright
colours stayed near-white. xterm renders bold text in the bright colour and
`top` prints its summary values in bold white, which landed on `#eeeeec`
against a `#f5f7fa` background: a contrast ratio of 1.08:1. The one value that
was readable had reverse video, not a colour.

Four of the eight were unreadable that way - bright white at 1.08:1, bright
yellow at 1.16, bright cyan at 1.49, bright green at 1.50.

All sixteen slots are now defined per theme and passed through. On the light
theme plain white also moves to readable ink, because on a light background a
program asking for white is asking for the background; bright white becomes the
darkest text, since bold is what a program uses when it wants a value to stand
out. Every slot in all seven themes now clears 2:1 against its own background,
and a test measures that rather than trusting the eye.

## A resource path broke one character per line

In the Problems panel a card could render `pods/tech-dev/batch-adapter` down the
left edge, one letter per row.

The panel is sized by the drawer beside it, not by the window, and its
responsive rules were viewport media queries - which cannot see that. On a wide
screen with the drawer open the card kept its two-column layout, the button
column took its full width, the text column collapsed, and `overflow-wrap:
anywhere` broke the path wherever it could.

The panel now sizes itself with container queries, so the layout follows the
width the panel actually has. The summary row above it uses `auto-fit` and needs
no query at all. Measured across 400-1600px, the narrowest the text column ever
gets is 188px, with the title still on one line.

## Find in YAML counted matches but never moved

The counter advanced and the arrows worked, but the view stayed where it was.

The textarea stopped being the scroll container when the folding editor arrived:
it is sized to its content with overflow hidden, and `.yaml-fold-view` scrolls
instead. The search kept writing `scrollTop` on the textarea, which was a silent
no-op.

The container is scrolled now, positioned by measuring the line's own row rather
than multiplying by a line height - fold rows and segment boundaries make the
document taller than its line count. The jump also moved from a
`requestAnimationFrame` into an effect: clearing the folds re-renders the editor,
and the jump has to run against the DOM that render produces.

Note that the Describe tab has no search of its own, so nothing there changed.

## Tooling

`scripts/set-version.ps1` left the pinned `@kubedeck/shared-types` dependency on
the previous version, which sent npm to the registry for a package that only
exists in this repository and failed the lock refresh with a 404. It updates the
pin now.
