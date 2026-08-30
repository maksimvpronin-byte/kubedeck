# KubeDeck 2.23.7 release notes

The selection that was never the editor's, and 173 rules that were not needed.
Node-only ownership stays at Node 59 / Python 0, and no route changed.

## The selection

Reported from a screenshot, on 2.23.6: text selected in the YAML editor is still
washed out. It was. **2.23.4, which announced this as fixed, changed a value that
never applied.**

CodeMirror ships its own base theme, and it carries:

```
&light .cm-selectionBackground                                                 -> #d9d9d9
&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground  -> #d7d4f0
```

`&light` resolves to a single generated class, so the focused rule is five
classes. The editor's own rule was `&.cm-focused .cm-selectionBackground` -
three. The base theme won every time, and what a reader saw while selecting was
`#d7d4f0`, a pale lilac that swallows syntax colours. Since 2.15.0.

The theme here is declared without `{ dark: true }`, which is why the light half
of a bundled theme applies in all eight of the application's themes. Changing
that was the wrong lever: `&dark` only swaps the lilac for `#233`, also not the
accent. The selectors are raised instead - `.cm-editor` sits on the editor root
beside the generated class, so naming it wins outright rather than on source
order.

**The test that mattered does not measure a colour.** It reads CodeMirror's base
theme out of `node_modules`, computes the specificity of every selection rule on
both sides, and asserts the editor's outranks all of them. The contrast test
beside it measured the colour the file declares and passed throughout - a value
declared is not a value seen, and nothing in the suite knew the difference.

## The accent, and the surfaces around it

`--primary` was also a text colour, in five places: the `+N` node-label chip, the
control-plane role chip, the `is-info` workload condition, a code span in
Related, the tick in a themed select. On a panel it measured 2.12 to 2.60 in
every dark theme, against 4.5 for text.

One token was doing two jobs with opposite requirements. A filled button needs an
accent dark enough for white text on it; a chip needs one light enough to read on
a panel. `--primary-text` is the second token - each theme keeps its own hue and
saturation, only lightness is raised, so a chip still reads as its theme's
colour. All seven clear 4.6 on every surface a chip sits on.

Around it, six groups of surfaces are now measured and held by
`tests/theme-contrast.contract.test.cjs`:

| surface | measured | held to |
|---|---|---|
| status badges | 5.21 - 7.30 | text, 4.5 |
| focus rings | 3.93 - 8.00 | component, 3 |
| rows, primary text | 6.58 and up | text, 4.5 |
| terminal selection | 5.79 and up | text, 4.5 |
| disabled controls | 2.66 - 3.84 | a floor, not a standard |
| the text accent | 4.61 - 4.89 | text, 4.5 |

Which standard applies is a judgement, so it is written down per surface rather
than inferred. A disabled control is exempt from both by WCAG, deliberately -
looking unavailable is the whole point of it - so it is pinned at what it
measures instead.

## 173 fewer `!important`

227 in the stylesheets at the start, 54 now. The lint:css ratchet goes from 114
to zero.

`scripts/css-computed.cjs` is what made this safe. `css-cascade.cjs` answers
which rule beats which; this answers what an element ends up with, in every
theme, which is the thing that has to stay the same. jsdom resolves selector
matching, specificity and `!important` as a browser does; it does not substitute
`var()` or expand shorthands, so properties are read as authored and the custom
properties are substituted per theme.

| file | before | after |
|---|---:|---:|
| drawer-controls.css | 119 | 28 |
| related-panel.css | 92 | 17 |
| terminal.css | 14 | 7 |
| drawer.css, resource-table.css | 2 | 2 |

Every removal was checked against every value the stylesheets resolve to, across
eight themes, and the final state of each file was diffed against the previous
one: nothing moved.

**Removals are not independent, and one nearly got through.**
`.related-group { background: transparent !important }` is declared twice in
related-panel.css. Each copy tested safe on its own, because the other held the
line; removing both let a light-theme rule win and the group grew a panel
background. The per-declaration sweep said all 76 were safe and the batch check
found three changed values. Both steps are now the method, and the note in
`css-cascade.cjs` says so.

What stays is on `:hover`, `:focus` and `:active` rules, which no check here can
reach, or is genuinely load-bearing and commented where it sits.

## Three checks that could not fail

All three were found by trying to use them, and all three are fixed here.

- **The cascade ratchet** asked whether a comment sat above a low-specificity
  `!important`, and asked it of the copy where comments had already been replaced
  by spaces. No comment could ever satisfy it, and "114" was not a count of
  undocumented flags - it was every low-specificity flag in the folder.
- **The literal-colour guard** for the editor's theme read comments as
  declarations, so naming a colour in an explanation counted as shipping one.
- **The editor's contrast test** measured the value the file declares rather than
  the value that wins, which is exactly how the selection shipped broken through
  a release that fixed it.

Each was verified to fail after fixing - by removing a comment, by declaring a
literal colour, and by restoring the old selector.

## Verification

- `npm run lint`, `npm run lint:css` (ratchet at 0), `npm run format:check`
- `npm run test:renderer` - **232 tests**, up from 224
- `npm --workspace apps/desktop run test:gateway` - **170 tests**, unchanged
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- Resolved values diffed against the previous state at every `!important` step
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.23.7.md](./REGRESSION_CHECKLIST_2.23.7.md).
