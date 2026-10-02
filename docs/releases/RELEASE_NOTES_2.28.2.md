# KubeDeck 2.28.2 release notes

Two fixes: questions no longer take the keyboard away, and the desktop log stops
growing.

## Typing works after a question is answered

KubeDeck asked a few questions in the system's own dialog: leaving an edited
YAML, leaving unsaved settings, removing a cluster, closing an edited
kubeconfig. On Windows such a dialog could leave the window without keyboard
focus once it closed. The caret blinked in the table filter, and no key reached
it until the window was reloaded.

- These questions are now asked in a dialog of KubeDeck's own, in the theme,
  with a title.
- When it closes, the keyboard goes back to the field you were typing in.
- Escape or Cancel leaves everything as it was. Removing a cluster starts on
  Cancel, so Enter does not remove it by accident.
- Nothing is asked when nothing would be lost: moving around with no unsaved
  edits is as immediate as before.

## The desktop log stops at 20 MB

`desktop.log` used to grow for as long as KubeDeck was installed, a line per
kubectl call: over a hundred megabytes in ten days with a few clusters
connected. It now starts again at 20 MB and keeps the previous file beside it
as `desktop.previous.log`, the way the audit log already did. A log already
larger than that is moved aside by the first line written after the update.

## Verification

Node-only ownership stays at Node 59 / Python 0, and no route changed.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **307 tests**, up from 301: the confirmation
  dialog answers, cancels, closes on Escape, returns focus to the field it came
  from and keeps a second question asked by the first answer; no renderer file
  opens a native dialog
- `npm --workspace apps/desktop run test:gateway` - **187 tests**, up from 186:
  `desktop.log` rotates at its size, keeps one previous file, never drops the
  newest line and moves an oversized old log aside
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.28.2`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.28.2.md](./REGRESSION_CHECKLIST_2.28.2.md).
