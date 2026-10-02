# KubeDeck 2.28.2 regression checklist

2.28.2 asks its questions in its own dialog instead of the system's, and stops
`desktop.log` at 20 MB. Node-only ownership is unchanged at Node 59 / Python 0,
and no route changed.

Earlier 2.13.x through 2.28.1 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (307 tests, up from 301)
- [x] `npm --workspace apps/desktop run test:gateway` (187 tests, up from 186)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.28.2`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Questions (Windows first)

- [ ] Edit a pod's YAML without applying, then click another row: the dialog
  "Unsaved YAML changes" appears in the app's theme. Cancel keeps the drawer
  and the edit; Discard changes opens the row.
- [ ] Same with a section in the tree, a resource tab, the cluster rail and the
  command palette: each asks once and moves only on Discard changes.
- [ ] Change a setting without saving, go to Pods: "Leave without saving"
  appears; Cancel stays in Settings.
- [ ] An edited YAML and unsaved settings together: two questions, one after
  the other, and the move happens only after both.
- [ ] Remove a cluster: the dialog starts on Cancel; Enter does not remove it.
- [ ] Edit a kubeconfig in Settings and close it: the question appears over the
  editor; Cancel returns to the edit.
- [ ] Focus the table filter, trigger any question, press Escape: typing in the
  filter carries on without a click and without a reload.
- [ ] After answering, type in the filter, the logs search and a pod terminal:
  every key arrives, spaces included.
- [ ] With nothing unsaved, rows, sections and tabs open at once, with no
  dialog.

## Logs

- [ ] Start 2.28.2 with an existing `desktop.log` over 20 MB: after the first
  kubectl call it is `desktop.previous.log`, and a new `desktop.log` holds the
  new lines.
- [ ] Settings → open the logs folder: only `desktop.log`,
  `desktop.previous.log`, `audit.jsonl` and possibly `audit.previous.jsonl`.

## Updates

- [ ] An installed 2.28.1: Check for updates shows 2.28.2 in the panel, with
  these notes and without their Verification section.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.28.1 installer build offers 2.28.2 and installs it without the wizard.
- [ ] Help and About report **2.28.2**.
