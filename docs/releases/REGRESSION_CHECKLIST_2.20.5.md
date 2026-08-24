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

- [x] Run an analysis on a pod: the answer, model, elapsed time and context
  size appear as before.
- [x] **While the answer is on screen, open a different pod**: the answer is
  gone, not showing the previous pod's text under the new name.
- [x] Do the same by clicking a different row in the table, and by switching
  workspace tabs.
- [x] Start an analysis and switch object mid-flight: the spinner clears and no
  late answer lands on the new object.
- [x] An analysis that errors shows the error, and switching object clears it.
- [x] Hide the prompt preview while an analysis runs (the 2.13.3 behaviour).
- [x] No Secret value and no log line reaches the prompt.

## Every drawer tab

Open a pod, a deployment, a node, a service, a secret and a CRD instance, and
walk the tabs each offers.

- [x] **Summary** - tiles, container rows, restart card, events, endpoints, the
  usage history chart, and the age ticking once a second.
- [x] **YAML** - editing, the dirty marker, Reset, Reload from cluster, Dry run,
  Apply with its confirmation, and the compare picker.
- [x] A **CRD definition** opens read-only with its notice; a **CRD instance**
  shows its own notice and can be edited.
- [x] **Describe** renders.
- [x] **Logs** - container picker, tail, previous, timestamps, follow, filter,
  refresh, copy, download visible, download full. On a **deployment**, the pod
  picker and all-containers option.
- [x] **Related** - the group list, the resource filter, opening a related
  object, deleting related pods.
- [x] **Secret** - reveal, copy, auto-hide; no value in the audit log.
- [x] A tab a resource does not offer is not shown, and a remembered tab that
  does not apply falls back to Summary.

## The drawer around the tabs

- [x] Header, resource title, copy-name button, close.
- [x] Actions: delete, restart, redeploy, scale, trigger a CronJob by hand.
- [x] Cordon, uncordon and drain from a node drawer.
- [x] Start a port forward; the drawer reports the URL and jumps to Port
  forwards.
- [x] Open a Pod Terminal, including the container picker on a multi-container
  pod, and a Node SSH session.
- [x] Edit YAML and try to close: the unsaved-changes prompt appears, Continue
  editing returns focus to the editor, Discard closes.
- [x] Edit YAML and navigate away in the table: the same prompt guards it.
- [x] Resize the drawer; the width survives a restart.

## Nothing else moved

- [x] Resource tables, Overview, Problems, Global Search, Settings.
- [x] Switch themes and languages.
- [x] Help and About report **2.20.5**.
