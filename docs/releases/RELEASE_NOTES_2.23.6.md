# KubeDeck 2.23.6 release notes

Section A of the plan, and a button that can be read. Node-only ownership stays
at Node 59 / Python 0, and no route changed. The only product change in this
release is nine hex values.

## Why there was a plan

Three defects were found in released code this week, each visible to anyone using
KubeDeck and to no test: a separator that had been mojibake since 2.20, an editor
selection that took the text with it since 2.15, and a Related card that hid its
own subtitle whenever the mouse passed over it. Two were found by looking at the
screen; one by arithmetic. None by the suite.

They share a cause. 55 tests in the suite did not run the application - they read
the source as text and matched regular expressions against it. The repository has
marked those `grep contract` since 2.20.3 and said in every one of them what it
costs.

## What section A did

Nine slices. 55 stubs became 40; 146 renderer tests became 224.

| new file | what it holds |
|---|---|
| `llm-tab-dom` | no log line reaches a third-party model, checked on the request itself |
| `secret-tab-dom` | the confirmation never shows a decoded value, checked by revealing one |
| `themed-select-dom` | the replacement for a native `<select>` behaves like one |
| `anchored-popover-dom` | a press on the trigger does not close and reopen the popover |
| `cluster-rail-dom` | one current cluster, arrows that wrap, a menu that cannot strand |
| `usage-cells-dom` | limit, then request, then the raw reading |
| `workspace-tabs-dom` | closing a background tab leaves the drawer alone |
| `terminal-theme-dom` | all sixteen ANSI slots come from the theme, in every theme |
| `usage-history-dom` | the live window opens, and the percentiles do not follow the view |
| `namespace-refresh-dom` | a background poll cannot rewrite the namespaces a person chose |

Two existing files were extended, and `helpers/contrast.cjs` now holds the WCAG
arithmetic that had been written out three times.

**Every one of the 46 new tests was shown failing on the defect it exists for.**
Seventy-six mutations of the product source across the nine slices, each caught
by the right test and by no other, each reverted afterwards. The rule is in the
plan: a test nobody has seen fail does not count as written.

## What stays, and why

All 40 remaining stubs now carry their reason. They fall into five kinds, and
every kind is something a behavioural test cannot reach:

- **Layout and cascade.** jsdom lays nothing out and resolves no container
  queries, so it cannot tell a popover that escaped its panel from one cut in
  half.
- **An absence.** Code that is not imported, a listener that is not attached, a
  request that never goes out. Nothing to render.
- **Work that is avoided.** A table that recomputes its rows quadratically
  renders the same rows; `React.memo` changes how often a render runs, never
  what it produces.
- **What cannot be mounted.** xterm needs a canvas; the Electron main process is
  not a browser.
- **Wiring in App.tsx.** Following a wire by clicking would mean standing up the
  whole application.

Six contracts in `release-surface` were reclassified rather than annotated. They
hold properties of a release - no Python runtime in the package, no bundled
kubectl, Help and About describing the application as it behaves - and a property
of a file has no behaviour to click. They were never this debt and are no longer
counted as it. One marker elsewhere was simply wrong: a test of selection pruning
was labelled a grep contract while loading the hook and calling it.

## The button

Moving the theme contract onto the shared helper widened it from one theme to
seven, and it failed. White text on the primary button missed WCAG AA in five of
them:

```
theme      primary   hover      now
nord         3.48     2.69     5.55 / 4.64
forest       4.14     3.14     5.52 / 4.62
mocha        4.19     3.22     5.52 / 4.64
plum         4.53     3.57     5.50 / 4.61
midnight     5.54     4.45     5.54 / 4.63
graphite     5.58     4.61     unchanged
light        5.63     7.07     unchanged
```

`--primary` and `--primary-hover` are darkened in nord, forest, mocha and plum,
and `--primary-hover` in midnight. Lightness only: each accent keeps its HSL hue
and saturation, because these are the colours the themes are named for.

The finding was reported before it was fixed, and the fix waited for a decision
rather than being made inside a test change. Until it landed, a ratchet in
`theme.contract.test.cjs` held every theme at what it measured, so the palette
could not get worse while the question was open. The ratchet moved up with the
palette.

**One deliberate side effect.** The accent is also used as a text colour in a few
places - the `+N` node-label chip, the control-plane role chip, the `is-info`
condition. Darkening it took those from 2.93-3.39:1 to 2.12-2.42:1 on `--panel`
in the four changed dark themes. None met AA before either, and they now sit
where midnight and graphite have sat all along. It is recorded as open in section
B of the plan and called out for the manual pass.

## Two harness faults, fixed at the harness

- `assert.equal(view.first(".x"), null)` hands a live DOM node to the reporter,
  which serialises the whole node: a failing test hung for thirty-five seconds
  and was killed, naming the file rather than the assertion.
- A view unmounted at the end of a test is not unmounted when an assertion
  throws, which leaves a `requestAnimationFrame` alive and the run hanging.

Both are written at the top of `helpers/dom.cjs`.

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **224 tests**, up from 146
- `npm --workspace apps/desktop run test:gateway` - **170 tests**, unchanged
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- 76 mutations of the product source, each caught by the right test
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.23.6.md](./REGRESSION_CHECKLIST_2.23.6.md).
