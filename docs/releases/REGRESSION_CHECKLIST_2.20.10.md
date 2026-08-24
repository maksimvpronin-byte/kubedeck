# KubeDeck 2.20.10 regression checklist

The SSH connect validator stopped treating port 0 as "no port given". Nothing in
the application can send a 0 - the SSH form defaults an empty field before
sending - so **nothing should behave differently**, and this pass is about
confirming that rather than finding the new behaviour.

Everything is in Node SSH.

Earlier 2.13.x through 2.20.9 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (115 tests)
- [x] `npm --workspace apps/desktop run test:gateway` (154 tests)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## SSH still connects the way it did

On a cluster with a node you can reach:

- [ ] Open a node's SSH with the **Port field left as 22**: connects.
- [ ] **Clear the Port field entirely** and connect: still goes to 22, no error.
- [ ] Type a **non-default port** your node listens on: connects there, and the
  command preview shows `-p <port>`.
- [ ] Type `0` in the Port field: the form turns it into 22 before sending, as
  it always has, so this connects to 22. It does **not** show an error - the
  change is in the backend validator, and the form never lets it get there.
- [ ] The same four checks for a **jump host**: default port, cleared field,
  a custom port shown as `bastion:2222` in the preview.

## The session itself

- [ ] Password, private key and agent authentication each still connect.
- [ ] The host key prompt appears for an unknown host, and trusting it works.
- [ ] Input, output, resize and reconnect behave as before.
- [ ] Closing the session ends the process.
- [ ] No password or passphrase appears in the command preview or the audit log.

## Nothing else moved

- [ ] Pod Terminal in the bottom workspace, which shares the PTY size limits.
- [ ] Run an **LLM** analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.20.10**.
