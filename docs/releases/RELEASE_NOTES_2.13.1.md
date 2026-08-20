# KubeDeck 2.13.1 release notes

KubeDeck 2.13.1 fixes the cluster rail claiming every cluster was disconnected
after settings were saved.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## Saving settings turned the whole rail grey

Pressing Save in Settings made every cluster badge go to the disconnected
colour. Nothing was actually disconnected - the samplers kept running and the
metrics kept arriving, which is how the report came in - but the rail said
otherwise, and the workspace would have followed it into the disconnected
state.

Two responses carry a whole `AppConfig` back to the interface: `GET /config`
and `PUT /settings`. The connection state was added to the first and not the
second, so saving settings replaced the interface's copy of the config with one
that had no connection state in it at all.

Both now go through a single builder, so they cannot drift apart again.

The interface no longer treats the two cases as the same either. An absent
connection list means "this response did not report it", not "nothing is
connected", and the previous value is kept. That way a response that omits the
field can never again grey out the entire rail while the backend is still
talking to those clusters.

## Why this is a patch and not an edit

2.13.0 was already on `main` when the fault was found. Anyone who pulled it has
a build that behaves differently from one built after the fix, so the version
had to move rather than its notes being rewritten.
