# KubeDeck 2.24.2 regression checklist

2.24.2 changes how the interface reports state: live updates, loading, errors
and search. Node-only ownership is unchanged at Node 59 / Python 0, and no route
was added or removed.

None of it was run against a real cluster before release - there was none. The
boxes below are the ones that matter most for that reason.

Earlier 2.13.x through 2.24.1 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run lint:css`
- [x] `npm run format:check`
- [x] `npm run test:renderer` (259 tests)
- [x] `npm --workspace apps/desktop run test:gateway` (182 tests, up from 174)
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run verify:release`, including `--tag v2.24.2`
- [x] `/migration/status` remains `node-only`, Node 59 / Python 0

## Live updates survive a dead watch

- [ ] Open Pods and wait for the watch to connect. In Task Manager (or `ps`),
  kill the `kubectl get pods ... --watch-only` process. Change a pod from a
  terminal. The table catches up within the auto-refresh interval, without a
  manual Refresh.
- [ ] A few seconds later a new `kubectl ... --watch-only` process exists - one,
  not two.
- [ ] Drop the VPN (or block the API server) for a minute with Pods open, then
  bring it back. The table recovers on its own and shows changes made while it
  was down.
- [ ] With a user that may `list` but not `watch` pods, the table still refreshes
  by polling, and kubectl watch processes are not started every couple of
  seconds.

## Permission errors stay local

- [ ] With a user denied Deployments but allowed Pods: open Deployments. The
  table says the list could not be loaded, names the refusal ("No permission to
  list deployments in namespace ..."), and offers Retry. The cluster stays
  connected, and Pods still load.
- [ ] Switch the language to Russian: the same error reads in Russian, with the
  code under *Технические подробности*.

## Table states

- [ ] A first load on a slow cluster shows *Loading...*, not *No resources to
  display*.
- [ ] A refresh of a visible table shows *updating...* in the header for as long
  as it runs, and the rows stay readable.
- [ ] An empty namespace still says there are no resources; a filter with no
  match still offers to clear it.

## Search

- [ ] Type a query quickly on a freshly opened cluster: one
  `kubectl api-resources` process, not one per keystroke.
- [ ] A match found by a label or annotation appears in the palette.
- [ ] Change the query or close the palette mid-search: the old results do not
  come back.
- [ ] On a cluster where one resource is forbidden, the palette says the search
  was incomplete rather than that nothing was found.

## Switching clusters

- [ ] Switch between two clusters with different CRDs, quickly, several times.
  The navigation only ever shows the CRDs of the cluster on screen.
- [ ] On a slow cluster the namespace selector fills in, even when the answer
  takes longer than the refresh interval.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs, including Logs with follow on.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] A 2.24.1 installer build offers 2.24.2 and installs it.
- [ ] Help and About report **2.24.2**.
