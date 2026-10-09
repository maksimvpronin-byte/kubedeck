# KubeDeck 2.30.0 regression checklist

2.30.0 reworks the Secret tab, pastes on a right-click in a terminal and opens
Scale on the current replica count. Node-only ownership is unchanged at Node
59 / Python 0, and no route was added.

The 2.29.1 checklist and the earlier ones still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (323 tests, up from 320)
- [x] `npm --workspace apps/desktop run test:gateway` (229 tests, unchanged)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.30.0`
- [ ] `npm run smoke:cluster` against a live cluster
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Secrets

- [ ] Open an Opaque Secret: every value shows as base64 at once, no Reveal,
  no auto-hide.
- [ ] The eye decodes a text value and back; the audit log has one decode for
  the key.
- [ ] Edit a value as text, Save: written at once, no dialog; YAML shows the new
  base64, and the value decoded again reads as typed (Cyrillic included).
- [ ] Edit a value as base64, pasted over several lines: saved joined.
- [ ] Type something that is not base64: Save stays disabled; Undo changes
  restores the value.
- [ ] Edit one key, save another: the first edit is still there.
- [ ] Edit a key and open another Secret without saving: no question, nothing
  written.
- [ ] A TLS Secret: `tls.crt` decodes; a keystore or other binary key stays
  base64, and saving a base64 edit of it works.
- [ ] An immutable Secret: fields are read-only, no Save.
- [ ] Copy in base64 and in text: the clipboard holds what was on screen; the
  audit log names the key only.
- [ ] Two people editing: saving over a change made meanwhile reports a
  conflict and keeps the edit.

## Terminal

- [ ] Pod terminal: select text, paste it elsewhere - it was copied.
- [ ] Right-click in the pod terminal: the clipboard is pasted, a multi-line
  paste does not run line by line in a shell that supports bracketed paste.
- [ ] The same in a node SSH session.
- [ ] No browser context menu opens over the terminal.

## Scale

- [ ] Scale a Deployment with 5 replicas: the field opens on 5 and the command
  preview reads `--replicas=5`.
- [ ] A workload scaled to zero opens on 0.

## Updates

- [ ] An installed 2.29.1: Check for updates shows 2.30.0 with these notes and
  without their Verification section.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.29.1 installer build offers 2.30.0 and installs it without the wizard.
- [ ] Help and About report **2.30.0**.
