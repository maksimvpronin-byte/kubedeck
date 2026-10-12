# KubeDeck 2.30.1 release notes

A saved kubeconfig now takes effect on screen at once, and a kubeconfig with
Windows line endings keeps them.

## Editing the kubeconfig of a cluster that did not open

When a cluster failed to open - wrong certificate, expired credentials, an
address that moved - fixing its kubeconfig in the editor seemed not to help:
after Save, the error from before the edit stayed on screen.

- The file was saved, but only the cluster in use was opened again after a
  save. A cluster that failed to open is shown as unavailable and is not the
  one in use, so it was left to the background retry, which runs every ten
  seconds and does not replace the error that is shown.
- Now a save opens the cluster again straight away, whether it was open or
  shown as unavailable: either it connects, or the error on screen is the one
  the new kubeconfig gives.
- A cluster that is not on screen is marked disconnected in the rail after its
  kubeconfig is saved, as it is on the backend, and connects again when it is
  next opened.
- This is the same from the cluster's menu and from Settings.

## Windows line endings

- A kubeconfig with Windows (CRLF) line endings opened as already changed, so
  Save was available before anything was edited, and saving rewrote every line
  in LF. It now opens unchanged and is saved with the line endings it had.

## Verification

Node-only ownership stays at Node 59 / Python 0, and no route changed.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **327 tests**, up from 323: a CRLF kubeconfig
  opens unchanged and is saved back in CRLF, an LF one in LF; saving the
  kubeconfig of an unavailable cluster opens it again and the error shown is
  the new one; saving the kubeconfig of a cluster not on screen re-reads the
  config and opens nothing
- `npm --workspace apps/desktop run test:gateway` - **229 tests**, unchanged
- Both suites also on Node 22.12, the version CI runs
- Checked in the real renderer against the Node gateway: a CRLF kubeconfig
  edited and saved keeps CRLF on every line, and the cluster is opened again
  about 0.1 s after the save
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.30.1`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.30.1.md](./REGRESSION_CHECKLIST_2.30.1.md).
