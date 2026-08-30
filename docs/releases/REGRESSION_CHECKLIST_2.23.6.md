# KubeDeck 2.23.6 regression checklist

Pending. 2.23.6 is the next patch to be cut; this file is opened early because
the change it carries has an acceptance that only a person can perform. If the
release that carries it takes another number, rename the file with it.

So far 2.23.6 changes nine hex values in `tokens.css` and nothing else. No route
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
- [x] `npm run test:renderer` (209 tests, unchanged)
- [x] `npm --workspace apps/desktop run test:gateway` (170 tests, unchanged)
- [x] `npm run typecheck`
- [x] `npm run build`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, Node 59 / Python 0

## The primary button, in all eight themes

The accent is the colour each theme is named for and this is the most visible
button in the application, so the pass is a look, not a measurement - arithmetic
is already held by `PRIMARY_BUTTON_FLOOR` in `theme.contract.test.cjs`. Walk
**system**, **light**, **midnight**, **nord**, **forest**, **plum**, **mocha**
and **graphite**, and in each one:

- [ ] **In a dialog** - the confirm button of a delete or a Secret save. Idle:
  the label is crisp white, not grey-on-teal. Hover: it stays readable and the
  hover is still visibly a hover. Disabled: it reads as unavailable and is not
  mistaken for the idle state.
- [ ] **In the resource table toolbar** - the primary action next to the bulk
  selection. Same three states.
- [ ] **In the drawer** - Apply on the YAML tab, and the terminal workspace
  buttons that share the same action tokens. Same three states.
- [ ] The button still belongs to its theme: nord still reads as nord's blue,
  forest as green, mocha as amber, plum as violet. If a theme now reads as
  muddy rather than darker, say so - the hue was deliberately not touched, so
  that is a palette decision, not a bug in this change.
- [ ] The accent's other roles did not go with it: `--primary-border` and
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

- [ ] Look at the `+N` chip and the control-plane chip in **nord** (the worst,
  2.12:1) and confirm they are still findable. If not, that item moves up.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs, including Logs with follow on.
- [ ] Edit and apply a manifest: dry-run and apply both behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Switch theme and language from Settings: every theme applies at once and
  the primary button in Settings itself follows.
- [ ] Help and About report the released version.
