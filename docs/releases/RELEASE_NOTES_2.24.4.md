# KubeDeck 2.24.4 release notes

One fix, reported from a real cluster. Node-only ownership stays at Node 59 /
Python 0, and no route changed.

## Following a pod's logs no longer flashes

With Follow on, the Logs tab kept flashing between the log and *No log lines*.

Every refresh of the table - polling, a watch event, and since 2.24.2 the
reloads after a watch gap as well - hands the open drawer a new row object for
the same pod. The log stream was keyed by that object, so each refresh closed
the stream and opened a new one; and each new stream began by clearing the tab,
which stayed empty until the tail came back. A pod logging every ten seconds
next to a table refreshing every ten seconds flashed steadily.

- The stream is now keyed by what it reads - the pod, its namespace, its
  container and the tail settings - and a table refresh leaves it alone.
- A reconnect no longer clears the tab. The lines on screen stay until the new
  stream's first batch replaces them, so even a real reconnect is not a flash.
- A stream that ends because the container stopped (kubectl exits 0) is not
  reopened every second any more; it would only end again. A stream that fails
  is retried after 1, 2, 5, 10 and then 30 seconds. Refresh, or toggling Follow,
  starts either again.
- The hint under the toolbar said Follow "refreshes bounded logs every 3
  seconds". It has been a stream since 2.23.0; the hint now says so.

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **268 tests**, up from 265: a Follow stream survives
  table refreshes of the same pod, a reconnect never blanks the tab, and a
  finished stream is not reopened; the first of these fails on 2.24.3
- `npm --workspace apps/desktop run test:gateway` - **182 tests**
- both suites also on Node 22.12, the version CI runs
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.24.4`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.24.4.md](./REGRESSION_CHECKLIST_2.24.4.md).
