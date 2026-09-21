# KubeDeck 2.24.2 release notes

A release about trust in what the screen says. An audit of day-to-day use found
the same fault in several places: a state the interface showed that was not the
state the cluster was in. A table that had stopped updating still looked live, a
refused resource looked like a lost cluster, a failed load looked like an empty
namespace. Node-only ownership stays at Node 59 / Python 0, and no route was
added or removed.

The audit and the order of the work are in
[product-audit-2026-09-21.md](../product-audit-2026-09-21.md).

## A table no longer stops updating without saying so

The table's live updates come from a `kubectl get --watch` behind a WebSocket.
When that kubectl ended on its own - it crashed, lost the API server, or the
server closed a long watch - nobody was told. The socket stayed up on its
heartbeat, the table counted as live, and polling stayed off. The data simply
stopped moving.

The gateway now announces the end of a watch it did not stop (`watch.ended` on
the socket of the same scope). The table goes back to polling at once, reloads
what it missed, and starts the watch again - 2, 5, 15, 30 then 60 seconds apart
while it keeps failing, back to 2 once a watch has run for a minute, so a watch
that is refused outright does not spawn a kubectl every two seconds. After a
socket gap the table reloads too, and a watch is only trusted once the gateway
confirms it is running.

The same work closed a long-standing gateway fault: a watch that failed with
`error` before `close` could erase the record of its own replacement, and the
next request started a second kubectl for the same scope.

## A refused resource is not a lost cluster

`forbidden: User ...` when reading one resource used to be classed as the
cluster being unavailable: the active cluster, its namespaces and every table
were dropped because one list was not allowed. A permission error now stays
with the table it belongs to; a real connection failure still marks the cluster
unavailable.

## The table tells four answers apart

Still loading, could not load, nothing there, nothing matches the filter - the
table used to give one of these for all of them. It now shows *Loading...* on a
first load, *The list could not be loaded* with the reason and a Retry button,
the empty state, and the filter state; rows already on screen carry an
*updating...* marker while a refresh runs.

The loading flag is switched off by the request that switched it on. It used to
be cleared by a 700 ms timer whenever rows were visible, even with the request
still running, and could stay on for good when a background refresh superseded
an explicit one. Opening a cluster follows the same rule.

## Search says what it did not search

- Matches the gateway found by labels, annotations or words in different fields
  are no longer filtered away again by the palette.
- Results of a previous query or scope are dropped at once, and a response that
  arrives after the query changed, the palette closed or the cluster went away is
  ignored.
- Searching, no results, a partial result, a limited result and a failure are
  now different messages, in both languages.
- Custom-resource discovery runs inside the 12-second search budget instead of
  before it (a cold search could take 30 + 12 seconds), is shared by concurrent
  searches instead of started once per keystroke, and is not started at all for
  a search already cancelled. When it does not finish, the built-in kinds are
  still searched and the palette says the result is incomplete.
- A closed palette no longer builds hundreds of commands on every table refresh.

## Switching clusters

- The CRD list of a cluster left before it arrived no longer lands in the next
  cluster's navigation, and its error no longer replaces that cluster's state.
- A background namespace refresh waits for a slow answer instead of cancelling
  it every tick - a cluster slower than the refresh interval used to never get
  its namespace list. A namespace list that arrives after the active cluster is
  gone is dropped.

## Errors in the interface language

The error panel titles an error by what happened, in the interface language,
instead of by its code. A permission error names what was refused ("No
permission to list deployments in namespace team-a"), the hints are translated,
the suggestion that a backend route "needs a hotfix" is gone, and the code,
command and kubectl output are folded into *Technical details*.

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **259 tests**
- `npm --workspace apps/desktop run test:gateway` - **182 tests**, up from 174
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.24.2`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Not measured: behaviour against a real cluster, a dropped VPN, and timings in
the packaged application. No cluster was available for this release; the watch,
search and namespace fixes are proven against a fake kubectl and a fake socket.

Manual pass: [REGRESSION_CHECKLIST_2.24.2.md](./REGRESSION_CHECKLIST_2.24.2.md).
