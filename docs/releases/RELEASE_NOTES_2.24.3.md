# KubeDeck 2.24.3 release notes

The rest of the 2.24.2 audit that could be done without a cluster. Node-only
ownership stays at Node 59 / Python 0, and no route was added or removed.

## A failed refresh no longer blanks the table

When a refresh failed - the VPN dropped, the API server stopped answering - the
table emptied, and the list the user was reading went with it. Now a failed
refresh of the scope already on screen keeps the last good rows, and a bar above
them says so: *Could not refresh. Showing the list from 14:05.*, with the reason
and a Retry button.

The rows are kept only where they are still true to what they claim:

- a **permission error** drops them - they were read before access was
  withdrawn;
- a failure of a **different scope** (another namespace, another resource) never
  shows the previous scope's rows;
- a lost cluster still clears everything, as before.

## The error panel offers the next step

Where the panel can tell what the next step is, it offers it: *Open Settings*
when kubectl is not found (trying again would not find it), and *Retry* when the
error is the table's own failed load. The same panel also shows errors of
searches and actions, which a table reload would not repeat, so it offers no
Retry for those rather than the wrong one.

## The port-forward window in Russian

The port-forward window was the last one written in English only. Its title,
labels, hints and buttons now follow the interface language.

## Live updates: every order of events, checked

The logic that decides whether a table may trust its live updates moved out of
the React hook into a session with no React and no socket in it, so it can be
driven directly. A new test runs it through **every sequence of six events** -
socket open and close, the watch dying, the gateway answering or refusing, a
restart timer firing, 46,656 sequences in about two seconds - against a model of
the gateway, and checks after every step that the table is never called live
while the socket is closed or the watch is gone, and that it always recovers.

It found two more gaps the hand-written tests had not:

- **A watch that died before its socket ever opened.** The first reply described
  the dead watch, the session asked again and got a new one - and nothing
  reloaded the table, so changes between the two were lost. The same happened
  when a confirmed watch died while the socket was down and was replaced after
  the reconnect. Now, when the gateway reports a different watch than the last
  one it reported, the table is reloaded.
- **A refused start.** While the gateway refused to start a watch, nothing
  reported changes; when it finally started one, the gap was not reloaded. It is
  now.

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **265 tests**, up from 259
- `npm --workspace apps/desktop run test:gateway` - **182 tests**
- both suites also on Node 22.12, the version CI runs
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.24.3`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Still not measured against a real cluster: none was available.

Manual pass: [REGRESSION_CHECKLIST_2.24.3.md](./REGRESSION_CHECKLIST_2.24.3.md).
