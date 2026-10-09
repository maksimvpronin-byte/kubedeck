# KubeDeck 2.30.0 release notes

Secrets are shown as base64 and can be edited in place, a right-click pastes
in a terminal, and Scale opens on the replica count the workload has.

## Secrets: base64, ready to edit

- Each value is shown as the Secret holds it, base64, in a field you can edit
  straight away. There is no Reveal step and nothing hides itself after 30
  seconds any more.
- The eye button decodes a value to text and back. Copy copies what is on
  screen, base64 or text.
- Save writes the value at once, without a confirmation. An edit you do not
  save is dropped when you open another Secret or close the drawer.
- A value can be edited as base64 or as text; text is encoded to base64 on
  save. Base64 pasted over several lines is joined. A value that is not valid
  base64 cannot be saved until it is fixed or the change is undone.
- Binary data, and anything that is not UTF-8 text, stays base64 - editing it
  as text would change its bytes.
- An immutable Secret is shown read-only, without Save.
- Decoding, copying and saving are written to the audit log, by key and never
  with the value.

## Terminal: a right-click pastes

Selecting text in the pod terminal or in node SSH copies it, as before; a
right-click now pastes the clipboard, as in PuTTY and the Windows console.

## Scale

The Scale dialog opens on the workload's current replica count. It used to
start at 1, so confirming it unchanged scaled the workload down to one replica.

## Verification

Node-only ownership stays at Node 59 / Python 0. No route was added; the
Secret `keys` route now sends each value's base64, and `update` also takes it.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **323 tests**, up from 320: Scale opens on the
  current replica count; a right-click pastes through xterm's own paste; the
  Secret tab shows base64, decodes on request, saves at once, keeps binary and
  non-UTF-8 values in base64 and drops an unsaved edit without asking
- `npm --workspace apps/desktop run test:gateway` - **229 tests**, unchanged;
  the Secret contracts now cover each value's base64 in `keys` and a base64
  `update`
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.30.0`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.30.0.md](./REGRESSION_CHECKLIST_2.30.0.md).
