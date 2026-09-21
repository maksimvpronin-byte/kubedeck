# KubeDeck 2.24.3 regression checklist

2.24.3 keeps the last good rows through a failed refresh, adds actions to the
error panel, translates the port-forward window, and moves the live-update
logic into a session checked through every order of events. Node-only ownership
is unchanged at Node 59 / Python 0, and no route was added or removed.

Nothing here was run against a real cluster before release. The 2.24.2
checklist was not run either; its boxes still apply and matter most.

Earlier 2.13.x through 2.24.2 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (265 tests, up from 259)
- [x] `npm --workspace apps/desktop run test:gateway` (182 tests)
- [x] Both suites on Node 22.12 as well as 24
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.24.3`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## A failed refresh keeps the rows

- [ ] Open Pods, then drop the VPN and press Refresh. The rows stay, and a bar
  above them says the refresh failed and names the time of the list shown.
- [ ] Retry on that bar with the VPN still down keeps the rows and the bar; with
  the VPN back it replaces both with a fresh list.
- [ ] Switch to another namespace while the VPN is down: the table does not show
  the previous namespace's rows.
- [ ] With a user whose access to Pods is withdrawn mid-session: the next refresh
  empties the table and says the list could not be loaded - it does not keep
  the rows as if they were still allowed.

## The error panel's actions

- [ ] Point Settings at a kubectl path that does not exist and open a table: the
  panel offers *Open Settings*, which opens Settings, and no Retry.
- [ ] A table that times out offers *Retry* in the panel, and it reloads that
  table.
- [ ] A search or action error shows no Retry.

## The port-forward window

- [ ] With the language set to Russian, open port-forward from a pod drawer:
  title, labels, hints and buttons are in Russian; with English, in English.
- [ ] Start and stop a forward: it works as before.

## Live updates

- [ ] The 2.24.2 checks on a dead watch and a dropped VPN, again: the table
  catches up by itself, and only one `kubectl --watch-only` runs per scope.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs, including Logs with follow on.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.24.2 installer build offers 2.24.3 and installs it.
- [ ] Help and About report **2.24.3**.
