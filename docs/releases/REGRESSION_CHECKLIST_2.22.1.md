# KubeDeck 2.22.1 regression checklist

2.22.1 changes what Overview and Problems ask the cluster for, and how often
they ask. The rows they show must not change - that is what most of this
checklist is about.

Earlier 2.13.x through 2.22.0 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (125 tests, was 124)
- [ ] `npm --workspace apps/desktop run test:gateway` (159 tests, was 157)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, Node 58 / Python 0

## The rows must be the same

Best done on a cluster that has real Warning events (a CrashLoopBackOff pod, a
failing mount, an unschedulable pod):

- [ ] Problems shows the same event-based rows as before the upgrade: same
  reasons, same messages, same targets when the row is opened.
- [ ] A Warning event that appears while the panel is open shows up on the next
  refresh.
- [ ] Overview's verdict, counters and problem summary match what Problems
  reports for the same cluster.
- [ ] The counters under `summary.sources.events` now count only warning events -
  expected, not a defect. Nothing in the UI displays that number.

## The cluster is asked less

With `Get-Process kubectl` (or a task manager) next to the application:

- [ ] Open Overview: the kubectl processes appear in waves of about three, not
  nine at once.
- [ ] Leave Overview open for a minute: a wave every ten seconds, and no
  accumulation between waves.
- [ ] Switch Overview → Problems within a couple of seconds: Problems paints
  without starting a new wave of kubectl processes.
- [ ] Wait ten seconds and switch again: this time it does read the cluster.
- [ ] Press Refresh twice in a row quickly: the second press does not double the
  work.

## Slow clusters

- [ ] On a cluster where one Overview refresh takes longer than the refresh
  interval, the panel now finishes and shows data instead of restarting
  forever. Same for Problems.
- [ ] Manual Refresh still supersedes whatever is running (it is not silent).
- [ ] Changing namespace scope while a refresh is running still switches
  immediately.

## Freshness must not regress

- [ ] Delete a pod from the resource table, then open Problems: its row is gone
  on the next refresh, not five seconds later than the panel claims.
- [ ] Apply a YAML change, then open Overview: counters reflect it on the next
  refresh.
- [ ] Disconnect a cluster and reconnect it: neither panel shows anything from
  before the disconnect.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.22.1**.
