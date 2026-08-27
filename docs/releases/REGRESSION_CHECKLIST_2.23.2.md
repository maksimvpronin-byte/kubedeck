# KubeDeck 2.23.2 regression checklist

2.23.2 extends a test script. No product code changed, so the application cannot
regress from it - what has to hold is that the script stays read-only and honest.

Earlier 2.13.x through 2.23.1 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (142 tests, unchanged)
- [ ] `npm --workspace apps/desktop run test:gateway` (170 tests, unchanged)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, Node 59 / Python 0

## The smoke script

- [ ] `npm run smoke:cluster` with no environment: skips, exits 0.
- [ ] With a kubeconfig: every check passes, including the four new ones about
  the log stream.
- [ ] `KUBEDECK_SMOKE_REPORT=out.md`, then a second run with
  `KUBEDECK_SMOKE_BASELINE=out.md`: every step carries a delta.
- [ ] With a baseline that does not exist: it says so and reports absolute
  timings.
- [ ] With a baseline from a much faster machine: slower steps are listed at the
  end, and the script still exits 0.

## Still read-only, still leaves nothing behind

- [ ] No kubectl process survives the run - including the one behind the log
  stream it opens (`Get-Process kubectl` is empty afterwards).
- [ ] `%APPDATA%/KubeDeck/config.json` is unchanged; no `smoke` cluster appears
  in the application.
- [ ] `kubectl get pods -A` before and after: identical.
- [ ] The temporary app-data directory named at the start is gone.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs, including Logs with follow on.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.23.2**.
