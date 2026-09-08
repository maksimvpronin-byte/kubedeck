# KubeDeck 2.24.1 regression checklist

2.24.1 fixes one thing and enables one check. Node-only ownership is unchanged
at Node 59 / Python 0, no route moved, and no screen was redesigned.

It is also the release that answers the two boxes 2.24.0 could not: a first
release can only show that the update metadata exists and names files that are
there, not that an update applies. There is now something to update *from*.

Earlier 2.13.x through 2.24.0 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css` - the ratchet is 0
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm --workspace apps/desktop run test:gateway` (174 tests, up from 173)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.24.1`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Saving a Secret

The release. Against a real cluster, on a Secret you are allowed to write.

- [ ] Reveal a key, change the value, save. It saves - no red card, no
  `unable to read patch file`.
- [ ] `kubectl get secret <name> -o json` shows the new value, base64 of exactly
  what was typed, and **every other key unchanged**.
- [ ] The value does not appear in the command preview shown on failure, nor in
  `%APPDATA%\KubeDeck\logs\desktop.log`, nor in the audit log. Search all three
  for it.
- [ ] The audit log gains a `secret.update` entry - `success` for the save
  above, `failed` for a refused one.
- [ ] Save a key on an **immutable** Secret: refused, and the reason says
  immutable rather than kubectl's own words.
- [ ] Force a conflict: open the Secret, change the same key with `kubectl` from
  a terminal, then save from KubeDeck without reloading. The message says the
  Secret changed and to reload - not `kubectl command failed` with a redacted
  line under it.
- [ ] A binary key elsewhere in the same Secret still reads as binary after the
  save; the write must not have rewritten it as text.

## An update, actually applied

Not answerable before this release existed.

- [ ] A 2.24.0 **Windows installer** build offers 2.24.1, downloads it with the
  progress bar moving, and **Restart and install** replaces the application
  rather than leaving it half-written. The gateway must be down before the
  installer starts, or it fails on files still held open.
- [ ] A 2.24.0 **Linux AppImage** does the same.
- [ ] The **portable** Windows build still says it cannot install in place and
  offers the release page, now with a newer version to point at.
- [ ] The **unsigned macOS** build says the same, for the signature reason.
- [ ] Nothing downloads on its own: watch the network on first open of About.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs, including Logs with follow on.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.24.1**.
