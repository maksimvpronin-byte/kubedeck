# KubeDeck 2.22.7 release notes

A release can now be checked against a real cluster, and CI checks the release
contract. No product code changed. Node-only ownership stays at
Node 58 / Python 0.

## Why

The 2.22.x pass shipped seven releases through the hot paths - request
cancellation, four caches, a memoized table - and every number behind them came
from a fixture: a fake kubectl that answers instantly, or a benchmark over
invented rows. The contract suites cannot see a real API server, and the
packaged smoke test is a list of steps a person walks through.

The other gap was smaller and sharper: CI ran `npm run verify` and nothing else,
so the release contract - the same version in six files, release notes and a
regression checklist that exist and mention it - was only ever checked on the
machine doing the release.

## What this adds

**`npm run smoke:cluster`** - the built gateway, against a cluster:

```bash
KUBEDECK_SMOKE_KUBECONFIG=~/.kube/config npm run smoke:cluster
```

It opens the cluster, loads the lists a table loads, walks Problems and Overview,
runs two searches, opens the related-resources fan-out and a pod's YAML, abandons
a request mid-flight, and starts and stops a watch - asserting the shapes the UI
depends on and timing every step. Without `KUBEDECK_SMOKE_KUBECONFIG` it explains
itself and exits 0, so CI is unaffected.

It is read-only: GETs, the cluster open (a `cluster-info` and a namespace list),
and one watch that it stops again. Nothing is applied, deleted, scaled, restarted
or exec'd, and the kubeconfig is copied into a temporary app-data root that is
removed at the end - the application's own configuration is never touched.

`KUBEDECK_SMOKE_REPORT=<file>` writes the timing table as Markdown, which is what
release notes should be quoting from now on.

**`verify:release` in CI**, as a second step after `npm run verify`.

## First run, against a k3s cluster (11 pods, 6 deployments, 369 events, 1 node)

| step | ms |
|---|---:|
| open cluster | 557 |
| pods, all namespaces | 124 |
| nodes | 97 |
| deployments | 94 |
| events | 148 |
| pod-usage (recorded samples, no kubectl) | 1 |
| **Problems, cold** | **229** |
| Overview (four of its nine lists shared with Problems) | 344 |
| **Problems again, inside the shared window** | **3** |
| search, a pod name | 588 |
| search, matching nothing | 421 |
| related resources of a pod | 898 |
| pod YAML | 94 |
| start watch / stop watch | 12 / 2 |

The two Problems rows are 2.22.1 measured for the first time on a real cluster
rather than a fixture: 229 ms when it has to read the cluster, 3 ms when Overview
has just read the same lists. Every check passed, including that an abandoned
request leaves no failure in the log and that the gateway answers normally
afterwards - 2.22.0, end to end.

## Files

| File | |
|---|---|
| `scripts/cluster-smoke.cjs` | new |
| `package.json` | `smoke:cluster` |
| `.github/workflows/verify.yml` | the release contract is checked in CI |
| `docs/release-checklist.md` | when to run it, and what it does not replace |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **127 tests**, unchanged
- `npm --workspace apps/desktop run test:gateway` - **166 tests**, unchanged
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- `npm run smoke:cluster` against a live k3s cluster: all checks passed
- `/migration/status` remains `node-only`, Node 58 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.22.7.md](./REGRESSION_CHECKLIST_2.22.7.md).
