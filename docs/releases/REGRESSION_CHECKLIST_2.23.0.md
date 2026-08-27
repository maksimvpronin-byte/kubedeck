# KubeDeck 2.23.0 regression checklist

2.23.0 replaces the three-second poll behind the Logs tab with a WebSocket
stream, and adds the first new route since 2.13. The Logs tab is where to look.

Earlier 2.13.x through 2.22.8 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (139 tests, was 138)
- [ ] `npm --workspace apps/desktop run test:gateway` (170 tests, was 166)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `npm run smoke:cluster` against a cluster: all checks pass
- [ ] `/migration/status` reports **Node 59 / Python 0**

## Following a pod

On a pod that writes logs continuously (a busy ingress controller is ideal):

- [ ] Open the drawer, Logs tab: the tail appears as before.
- [ ] Turn **follow** on: new lines appear as they are written, without the
  visible three-second stutter.
- [ ] The view does not flicker or jump to the top when new lines arrive.
- [ ] With `Get-Process kubectl` open: following holds **one** kubectl process
  for as long as the tab is open, and it does not come and go every three
  seconds.
- [ ] Turn follow off: the kubectl process disappears, and the tab keeps the
  lines it has.
- [ ] Turn follow on again: it starts a new stream and keeps going.

## The controls still work while following

- [ ] Switch **container** on a multi-container pod: the stream restarts on the
  new container.
- [ ] Toggle **timestamps**: lines carry them.
- [ ] Change the **tail** size: the stream restarts from that tail.
- [ ] **Previous** on a restarted pod: the previous container's logs stream.
- [ ] The **filter** box still narrows what is shown, live.
- [ ] **Download full logs** still downloads the whole log, not the stream.

## Ends and interruptions

- [ ] Delete the pod being followed: the tab reports the stream ended rather
  than silently stopping, and no kubectl is left behind.
- [ ] Close the drawer while following: the process stops.
- [ ] Switch to another drawer tab and back: following resumes cleanly.
- [ ] Disconnect the cluster while following: the stream closes, and re-opening
  a Logs tab is refused until the cluster is connected again.
- [ ] Quit the application while following: no kubectl process survives it.

## Deployment logs are unchanged

- [ ] Open a Deployment's Logs tab: it still aggregates its pods, still lets you
  pick a pod and a container, and still refreshes on the same schedule as before
  (it is not streamed).

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.23.0**.
