# KubeDeck 2.23.6 regression checklist

2.23.6 carries two things: nine hex values in `tokens.css`, and section A of
`docs/unseen-defects-plan.md` - seventy-eight more tests than it began
with, and no product code changed by them at all. The tests cannot regress the application; the nine hex
values can, and they have an acceptance only a person can perform, which is what
most of this file is.

The palette half changes nine hex values in `tokens.css` and nothing else. No route
changed and no logic changed. `--primary` and `--primary-hover` were darkened in
**nord**, **forest**, **mocha** and **plum**, and `--primary-hover` in
**midnight**, so that white text on the primary button clears WCAG AA (4.5:1) in
every theme. Only lightness moved - the HSL hue and saturation of each accent are
unchanged, so a theme still looks like itself. Measured with
`tests/helpers/contrast.cjs`:

```
theme      primary   hover     was
nord         5.55     4.64     3.48 / 2.69
forest       5.52     4.62     4.14 / 3.14
mocha        5.52     4.64     4.19 / 3.22
plum         5.50     4.61     4.53 / 3.57
midnight     5.54     4.63     5.54 / 4.45
graphite     5.58     4.61     unchanged
light        5.63     7.07     unchanged
```

Earlier 2.13.x through 2.23.5 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (224 tests, up from 146 at the start of section A)
- [x] `npm --workspace apps/desktop run test:gateway` (170 tests, unchanged)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## The primary button, in all eight themes

The accent is the colour each theme is named for and this is the most visible
button in the application, so the pass is a look, not a measurement - arithmetic
is already held by `PRIMARY_BUTTON_FLOOR` in `theme.contract.test.cjs`. Walk
**system**, **light**, **midnight**, **nord**, **forest**, **plum**, **mocha**
and **graphite**, and in each one:

- [x] **In a dialog** - the confirm button of a delete or a Secret save. Idle:
  the label is crisp white, not grey-on-teal. Hover: it stays readable and the
  hover is still visibly a hover. Disabled: it reads as unavailable and is not
  mistaken for the idle state.
- [x] **In the resource table toolbar** - the primary action next to the bulk
  selection. Same three states.
- [x] **In the drawer** - Apply on the YAML tab, and the terminal workspace
  buttons that share the same action tokens. Same three states.
- [x] The button still belongs to its theme: nord still reads as nord's blue,
  forest as green, mocha as amber, plum as violet. If a theme now reads as
  muddy rather than darker, say so - the hue was deliberately not touched, so
  that is a palette decision, not a bug in this change.
- [x] The accent's other roles did not go with it: `--primary-border` and
  `--primary-soft` are unchanged, so selection outlines, the resize handle and
  tinted backgrounds must look exactly as they did in 2.23.5.

## Known and deliberate: the accent as text

Darkening `--primary` also darkens the few places that use it as a **text**
colour - the `+N` node-label chip, the control-plane role chip, the `is-info`
workload condition, the tick in a themed select. On `--panel` these went from
2.93-3.39:1 to 2.12-2.42:1 in the four changed dark themes; none of them met AA
before either, and they now sit where midnight (2.60) and graphite (2.49) have
sat all along. Recorded as an open item in section B of
`docs/unseen-defects-plan.md`.

- [x] Look at the `+N` chip and the control-plane chip in **nord** (the worst,
  2.12:1) and confirm they are still findable. If not, that item moves up.

## The tests, which changed nothing

Section A replaced grep contracts with tests that mount components and click on
them. No product code changed, so nothing here can have regressed - but the tests
now claim the application behaves in particular ways, and this is the chance to
notice if any claim describes a jsdom-shaped version of it rather than the real
one. The 2.23.5 checklist walked the first five surfaces; these are the ones
added since.

- [x] **Workspace tabs.** Double-click a row to pin a tab, single-click another:
  the second does not pin. Close a background tab while a drawer is open: the
  drawer stays exactly where it is. Close the shown tab: its neighbour takes
  over and loads.
- [x] **The terminal palette.** Open a Pod Terminal in **light** and run
  something that prints in bold - `top`, or `ls` in a coloured shell. The bold
  text is readable, not near-white on near-white.
- [x] **The usage history chart.** Open a pod's Summary: the live window opens
  first, the longer one is a click away, and switching between them does not
  change the p50/p95/max line above the bars.
- [x] **The namespace selection.** Choose two namespaces, open a Node (a
  cluster-scoped resource), wait past a refresh, then go back: the two
  namespaces are still chosen. Switch clusters and back: each keeps its own.

## Standard smoke test

- [x] Connect a cluster; browse pods, deployments, services and nodes.
- [x] Open a resource drawer and walk its tabs, including Logs with follow on.
- [x] Edit and apply a manifest: dry-run and apply both behave as before.
- [x] Start and stop a Port Forward.
- [x] Switch theme and language from Settings: every theme applies at once and
  the primary button in Settings itself follows.
- [x] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt, and the prompt preview shows what was sent.
- [x] Help and About report **2.23.6**.
