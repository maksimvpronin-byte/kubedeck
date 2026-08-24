# KubeDeck 2.20.10 release notes

An SSH port that cannot work is refused instead of quietly replaced. No route
changes. Node-only ownership stays at Node 58 / Python 0.

## What it was doing

```ts
const port = Number(value || 22);
```

`0` is falsy. So a connect message asking for port 0 was read as one that had
not asked for a port at all, silently became 22, and connected there. The same
line ran for the jump host.

Nothing in the application could reach it: the SSH form does
`Number(port) || 22` before sending, so the backend never saw a 0 from
KubeDeck's own UI. That is exactly why it survived - it was unreachable, so it
was invisible.

But a validator that substitutes a value for one it was given is not validating.
This module is the boundary in front of `ssh2`; it should mean what it says.

## What it does now

"Not given" and "given and cannot work" are two different cases:

```ts
if (value === undefined || value === null || value === "") return DEFAULT_SSH_PORT;
const port = Number(value);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw …
```

A connect message that omits the port, or sends an empty one, still gets 22 -
that is a message that did not ask. A message asking for `0`, `-1`, `70000`,
`22.5` or `"ssh"` is refused with `INVALID_SSH_PORT`, which is what the other
four of those already did.

`normalizeConnection` was also doing `payload[portField] || 22` before handing
the value over, which would have defeated the check it just gained. That is
gone too.

## What you should see

Nothing. The form still defaults an empty Port field to 22 on the way out, so
no session that worked before behaves differently.

The change is worth having anyway: the next thing to talk to this websocket -
a test, a script, a future feature that builds the payload itself - now gets
told when its port is wrong instead of being connected somewhere else.

## Tests

Ten assertions across the two cases: every shape of "absent" yields 22, for the
target and for a jump host; `0`, `-1`, `22.5`, `70000` and a non-numeric string
are all refused; and `1`, `65535` and a numeric string like `"2200"` still work,
since a port arrives from a text field as a string.
