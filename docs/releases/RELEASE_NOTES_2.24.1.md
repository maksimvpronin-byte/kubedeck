# KubeDeck 2.24.1 release notes

The first release that fixes something a user can see, and the first one whose
update path can be tested at all. Node-only ownership stays at Node 59 /
Python 0, and no route changed.

## Saving a Secret never worked

Reveal a Secret key, edit the value, save it, and the drawer answered with a red
card: `KUBECTL_COMMAND_FAILED`, and under it

```
error: unable to read patch file: open -: The system cannot find the file specified.
```

The update ran `kubectl patch --type=json --patch-file=-`. `--patch-file` has no
reading of `-`: kubectl opens the path it is handed, so the patch was looked for
in a file literally named `-`. This is not a Windows fault. It could never have
worked anywhere, on any version, and it had shipped that way because the update
route had no test at all - the whole Secret contract covered keys, reveal and
copy, and stopped where the write began.

The write now goes through `kubectl replace -f - -o name` with the manifest on
standard input, which is how the YAML route already applies a manifest. Standard
input is not a detail of taste here: it is what keeps a Secret value out of
`argv`, out of the command preview the drawer shows, and out of the log line
every kubectl invocation writes.

**Optimistic locking survives the change.** The `resourceVersion` used to travel
as a JSON Patch `test` operation; it now travels inside the object, where the
API server enforces it. A concurrent write is refused rather than silently won.
An object that somehow arrives without a `resourceVersion` is refused here, too,
instead of overwriting whatever the cluster holds now.

## A conflict says what happened

A stale write returns *"Operation cannot be fulfilled ... the object has been
modified"*. Every line of kubectl output containing the word `secret` is redacted
before anyone sees it - and that message names the resource, so the one sentence
explaining the failure was replaced by `[redacted sensitive line]` under a
`kubectl command failed` heading.

The classifier now recognises that message and returns `CONFLICT`. The code is
computed from the raw output and survives redaction, so the route can turn it
into `409 SECRET_CONFLICT` with a sentence a person can act on: the Secret
changed since it was loaded, reload it and try again. A failed update is also
written to the audit log, which until now recorded only the successes.

## Verification

- `npm run lint`, `npm run lint:css` (ratchet at 0), `npm run format:check`
- `npm run test:renderer`, `npm --workspace apps/desktop run test:gateway` -
  **174 tests**, up from 173: the Secret update contract asserts the command,
  the manifest that goes to standard input, the base64 of the new value, the
  untouched neighbouring keys, the `resourceVersion`, the three ways to be
  refused, and that the value reaches neither the audit log nor the log file
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.24.1`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.24.1.md](./REGRESSION_CHECKLIST_2.24.1.md).
