# KubeDeck 2.23.0 release notes

Following a pod's logs is a stream now, not a poll every three seconds. One new
WebSocket route: Node-only ownership moves to **Node 59 / Python 0**.

## What was happening

With follow on, the Logs tab re-ran `kubectl logs --tail=500` every three
seconds and transferred the whole tail again, whatever had changed. Twenty
kubectl processes a minute, per open tab, to deliver the same five hundred lines
over and over - and a line written just after a poll waited up to three seconds
to appear.

The HTTP endpoint refused `follow` outright, with the message
`HTTP logs endpoint is bounded; KubeDeck uses bounded polling for follow mode`.
This release is that decision changing.

## What it does now

`WS /clusters/{cluster_id}/pods/{namespace}/{name}/logs/stream` holds one
`kubectl logs -f` for as long as the tab is open, and sends lines as the pod
writes them. The tab appends them; nothing is re-fetched.

The pieces that matter:

- **Batching on both sides.** The server flushes at most every 120 ms, the
  renderer appends at most every 60 ms. A pod logging a thousand lines a second
  is a handful of frames and a handful of renders, not a thousand of each.
- **A bounded window.** Up to 5000 lines are held for a client that cannot keep
  up; beyond that the oldest are dropped and the tab is told how many, because a
  tail is worth more than a gap.
- **An end is an event.** When the pod is deleted or the container exits,
  kubectl exits, and the stream says `ended` instead of quietly stopping.
- **One reconnect a second** while follow is still on, and none once it is off
  or the tab is closed - which also kills the kubectl behind it.
- **Disconnecting the cluster closes the streams reading it**, and refuses new
  ones, through the same guard every other cluster WebSocket goes through.

What is unchanged: the bounded HTTP route still serves the first load, the full
download, and deployment logs, which read many pods at once. Follow on that
route is still refused - now with somewhere else to go.

One deliberate omission: an open log stream is not counted in the disconnect
confirmation next to terminals and port-forwards. It carries no state a person
can lose, and it is stopped either way.

## Files

| File | |
|---|---|
| `apps/desktop/src/main/backend/logs/podLogsWebSocket.ts` | new: the stream |
| `apps/desktop/src/main/backend/gateway.ts` | upgrade routing, disconnect, shutdown |
| `apps/desktop/src/main/backend/routeOwnership.ts` | the 59th route |
| `apps/desktop/src/renderer/api.ts`, `types.ts` | the stream URL and its messages |
| `apps/desktop/src/renderer/hooks/usePodDrawerLogs.ts` | follow opens a socket instead of a timer |
| `apps/desktop/tests/pod-logs-stream.contract.test.cjs` | new: 4 tests |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **139 tests** (was 138)
- `npm --workspace apps/desktop run test:gateway` - **170 tests** (was 166)
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- The new tests drive a real gateway over a fake kubectl: one process per open
  tab and no polling, lines batched as written, stderr surfaced without ending
  the stream, the process killed when the socket closes, `ended` when kubectl
  exits, and a disconnected cluster closing existing streams while refusing new
  ones with a policy violation.
- `/migration/status` now reports **Node 59 / Python 0**

Manual pass: [REGRESSION_CHECKLIST_2.23.0.md](./REGRESSION_CHECKLIST_2.23.0.md).
