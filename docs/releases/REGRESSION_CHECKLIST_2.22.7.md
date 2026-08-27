# KubeDeck 2.22.7 regression checklist

2.22.7 adds a test script and a CI step. No product code changed, so the
application cannot regress from it - what has to be checked is that the new
script behaves, and that it really is read-only.

Earlier 2.13.x through 2.22.6 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (127 tests, unchanged)
- [ ] `npm --workspace apps/desktop run test:gateway` (166 tests, unchanged)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, Node 58 / Python 0
- [ ] CI on the release commit runs **both** `verify` and `verify:release`.

## The smoke script

- [ ] `npm run smoke:cluster` with no environment variables set: prints why it
  skipped and exits 0.
- [ ] With `KUBEDECK_SMOKE_KUBECONFIG` pointing at a file that does not exist:
  skips, exits 0.
- [ ] Without a build (`apps/desktop/dist` removed): skips and says to build.
- [ ] With a real kubeconfig: every check passes and a timing table is printed.
- [ ] `KUBEDECK_SMOKE_REPORT=out.md` writes that table as Markdown.
- [ ] The temporary app-data directory it names at the start is gone afterwards.

## It really is read-only

- [ ] `%APPDATA%/KubeDeck/config.json` is unchanged after a run - same clusters,
  same settings, same `lastOpened`.
- [ ] The cluster list in the running application is unchanged; no `smoke`
  cluster appears anywhere.
- [ ] On the cluster: no object was created, modified or deleted. `kubectl get
  events -A --field-selector type=Warning` shows nothing new caused by the run.
- [ ] `kubectl get pods -A` before and after the run: identical.
- [ ] No kubectl process is left behind (`Get-Process kubectl` is empty once the
  script exits) - the watch it starts is stopped by the script itself.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.22.7**.
