# KubeDeck 2.23.4 release notes

A highlight stops taking the words underneath it. Node-only ownership stays at
Node 59 / Python 0, and no route changed.

## What this fixes

The manifest editor paints three backgrounds behind text - the selection, a
search match, and the match the arrows are standing on. All three were laid on
too thick to read through, and the selection was the worst of them.

**Selected text.** The selection has been the theme accent at 70% since 2.15.0.
Property names are painted in `--focus-ring`, which every theme derives from the
same accent as `--primary-border`, so a selected key was very nearly the colour
of its own highlight. Measured across all seven themes:

| theme | key, unselected | key, selected at 70% | at 30% |
|---|---:|---:|---:|
| midnight | 7.90 | 2.42 | 5.03 |
| graphite | 7.38 | 2.04 | 4.41 |
| nord | 9.48 | 2.08 | 4.91 |
| forest | 9.03 | 2.19 | 5.11 |
| plum | 8.35 | 2.14 | 4.84 |
| mocha | 9.28 | 2.12 | 5.01 |
| light | 3.93 | 1.57 | 2.73 |

Comments fell as far as 1.2:1. The selection is now 30%: no token keeps less than
half its bare contrast, and the selection still reads at 1.44:1 or better against
the editor background.

**The found match.** The current match was the warning accent at 85%, which left
a matched number and a matched comment at 1.65:1 - the occurrence being stepped
to was the hardest thing on the page to read. Matches are now 25% and the current
one 45%.

## Why it was not seen

Until 2.16.0 a search match *was* a selection, and that was the only selection
most readers ever made - at which point the 70% wash looked like a deliberate
highlight rather than a mistake. 2.16.0 moved matches onto their own decoration
to stop Enter deleting the found text, and the selection colour was left behind
with nobody looking at it.

The match colours have their own version of this. They were taken from the log
viewer, where they are safe for a reason that does not carry over: a log line is
one colour and `.log-line mark` repaints the text it covers, so no amount of wash
can cost it anything. In the editor the text keeps its syntax colours and nothing
repaints them. **The log viewer is unchanged** - it was never affected.

## The rule, not the numbers

One contract test replaces three hand-checked colours. It reads the token and the
alpha of every background the editor paints behind text out of the source, walks
all seven themes in `tokens.css`, composites each background over `--code-bg`,
and asserts that each of the six painted inks keeps at least 45% of its bare
contrast and never falls below 2.3:1 - and that the current match stays thicker
than the rest, or stepping through matches would show nothing moving.

It was checked against the three regressions it exists for: the old selection at
70%, the old current match at 85%, and an ordinary match laid on thicker than the
current one. All three are rejected.

## Files

| File | |
|---|---|
| `apps/desktop/src/renderer/components/YamlSourceEditor.tsx` | the three alphas |
| `apps/desktop/tests/yaml-editor.contract.test.cjs` | the contrast rule |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **146 tests**, up from 145
- `npm --workspace apps/desktop run test:gateway` - **170 tests**, unchanged
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- The rule checked by reintroducing each of the three defects it covers
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.23.4.md](./REGRESSION_CHECKLIST_2.23.4.md).
