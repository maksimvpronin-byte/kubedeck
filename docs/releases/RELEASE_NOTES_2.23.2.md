# KubeDeck 2.23.2 release notes

The cluster smoke follows a pod's logs and compares itself to a baseline. No
product code changed. Node-only ownership stays at Node 59 / Python 0.

## What this adds

Two things to `npm run smoke:cluster`, which arrived in 2.22.7:

**It exercises the log stream.** 2.23.0 added the first new route since 2.13,
and the harness now opens it: it connects, checks the stream names the pod it is
following, waits a second and a half for whatever the pod writes, and asserts
that what arrived was a handful of messages rather than a poll. Then it closes
and checks nothing is left running.

**It can be compared to a previous run.** `KUBEDECK_SMOKE_BASELINE=<report.md>`
reads an earlier report - its own Markdown table, no second format - and prints
a delta beside every step. A step that got both materially slower and slower by
more than 100 ms is called out at the end and written into the report.

It does not fail the run for a slow step. A real cluster is not a benchmark rig:
the API server is shared, the node is doing other things, and a build that fails
because someone else was deploying at the time would be a build nobody trusts.

## A run against k3s, before and after

The report is the artifact this produces; the interesting rows from the first
run with the log stream in it:

| step | ms |
|---|---:|
| WS pod logs stream, first message | 10 |
| WS pod logs stream, lines in the first 1.5 s | 19 lines in 2 messages |
| Problems, cold | 229 → 217 |
| Overview | 344 → 281 |
| pod-usage (recorded samples, no kubectl) | 1 → 2 |

Nineteen lines in two messages is 2.23.0 doing what it was built for: the batches
are batches, and nothing was re-fetched to produce them.

## Files

| File | |
|---|---|
| `scripts/cluster-smoke.cjs` | the log stream checks, the baseline comparison |
| `docs/release-checklist.md` | how to use a baseline |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **142 tests**, unchanged
- `npm --workspace apps/desktop run test:gateway` - **170 tests**, unchanged
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- `npm run smoke:cluster` against a live k3s cluster, twice: all checks passed,
  the second run reporting deltas against the first
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.23.2.md](./REGRESSION_CHECKLIST_2.23.2.md).
