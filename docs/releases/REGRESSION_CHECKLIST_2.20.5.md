# KubeDeck 2.20.5 regression checklist

The resource drawer's tab bodies moved into `PodDrawerTabBody.tsx` and its LLM
state into `usePodDrawerLlm`. Same JSX, same state, reached through props and a
hook instead of closures.

Scope is exactly the drawer. Nothing outside it was touched, so the pass below
is the drawer end to end, with one thing that genuinely changed shape worth
checking first: **the LLM answer is now cleared by the hook rather than by the
drawer's general reset**, so the "switch object while an answer is on screen"
case is the one to try hardest.

Earlier 2.13.x through 2.20.4 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (93 tests)
- [x] `npm --workspace apps/desktop run test:gateway` (146 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**
- [x] `PodDrawerTabBody` built into the PodDrawer chunk, not the main bundle

## The LLM tab

- [ ] Run an analysis on a pod: the answer, model, elapsed time and context
  size appear as before.
- [ ] **While the answer is on screen, open a different pod**: the answer is
  gone, not showing the previous pod's text under the new name.
- [ ] Do the same by clicking a different row in the table, and by switching
  workspace tabs.
- [ ] Start an analysis and switch object mid-flight: the spinner clears and no
  late answer lands on the new object.
- [ ] An analysis that errors shows the error, and switching object clears it.
- [ ] Hide the prompt preview while an analysis runs (the 2.13.3 behaviour).
- [ ] No Secret value and no log line reaches the prompt.

## Every drawer tab

Open a pod, a deployment, a node, a service, a secret and a CRD instance, and
walk the tabs each offers.

- [ ] **Summary** - tiles, container rows, restart card, events, endpoints, the
  usage history chart, and the age ticking once a second.
- [ ] **YAML** - editing, the dirty marker, Reset, Reload from cluster, Dry run,
  Apply with its confirmation, and the compare picker.
- [ ] A **CRD definition** opens read-only with its notice; a **CRD instance**
  shows its own notice and can be edited.
- [ ] **Describe** renders.
- [ ] **Logs** - container picker, tail, previous, timestamps, follow, filter,
  refresh, copy, download visible, download full. On a **deployment**, the pod
  picker and all-containers option.
- [ ] **Related** - the group list, the resource filter, opening a related
  object, deleting related pods.
- [ ] **Secret** - reveal, copy, auto-hide; no value in the audit log.
- [ ] A tab a resource does not offer is not shown, and a remembered tab that
  does not apply falls back to Summary.

## The drawer around the tabs

- [ ] Header, resource title, copy-name button, close.
- [ ] Actions: delete, restart, redeploy, scale, trigger a CronJob by hand.
- [ ] Cordon, uncordon and drain from a node drawer.
- [ ] Start a port forward; the drawer reports the URL and jumps to Port
  forwards.
- [ ] Open a Pod Terminal, including the container picker on a multi-container
  pod, and a Node SSH session.
- [ ] Edit YAML and try to close: the unsaved-changes prompt appears, Continue
  editing returns focus to the editor, Discard closes.
- [ ] Edit YAML and navigate away in the table: the same prompt guards it.
- [ ] Resize the drawer; the width survives a restart.

## Nothing else moved

- [ ] Resource tables, Overview, Problems, Global Search, Settings.
- [ ] Switch themes and languages.
- [ ] Help and About report **2.20.5**.
