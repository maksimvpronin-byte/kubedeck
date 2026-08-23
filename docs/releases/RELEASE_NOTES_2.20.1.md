# KubeDeck 2.20.1 release notes

Internal cleanup. Nothing about the application changed: no new surface, no
route changes, no behaviour change. Node-only ownership stays at Node 58 /
Python 0.

## What moved

`main/backend/resources/normalizers.ts` had grown to 926 lines around 25
exports - roughly twenty independent `xxxSummary(item)` functions, one per
family of Kubernetes resource, sharing a file for no reason other than history.
Only two of those names were ever used from outside: `normalizeResourceItems`
and the `ResourceRow` type.

It is now a directory, one file per family:

```
resources/normalizers/
  index.ts        the resource → normalizer table, normalizeResourceItems
  primitives.ts   reading a manifest safely: record, records, text, meta
  pod.ts          podSummary, restart diagnostics, container states
  node.ts         nodeSummary, roles, labels, annotations
  workload.ts     deploymentSummary, jobSummary, workload conditions
  network.ts      serviceSummary, ingressSummary, service ports
  rbac.ts         serviceAccountSummary, roleSummary, roleBindingSummary
  misc.ts         ConfigMap/Secret, storage, CRD, events, quotas, generic
```

The largest file is now 216 lines instead of 926.

`index.ts` is the only entry point and re-exports exactly what the single file
exported before, so `import { … } from "../resources/normalizers"` still means
the same thing. Not one import in `src/` changed.

## What was deliberately not done

Function bodies were copied, not edited. A normalizer that rounded a value one
way before rounds it the same way now. Anything worth changing about them is a
separate patch with its own regression checklist - this one is a move.

Two helpers ended up beside their only caller rather than in the shared
primitives: `effectivePodResource` (in `pod.ts`, the only place that needs the
CPU/memory quantity parser) and `formatBytesQuantity` (in `node.ts`).

## Two notes for anyone building locally

`tests/resource-lists.contract.test.cjs` required the compiled
`dist/main/backend/resources/normalizers.js` directly; it now points at
`normalizers/index.js`. The names it imports are unchanged.

`tsc` does not clean `dist/`, so a tree built before this release still has the
old `normalizers.js` sitting next to the new `normalizers/` directory, and CJS
resolution prefers the file. Delete it, or build clean. A fresh checkout is
unaffected.

## Why

First of seven sections in
[docs/file-structure-refactor-plan.md](../file-structure-refactor-plan.md),
which came out of a size audit of the whole codebase. The audit's conclusion
was that KubeDeck does not have a god-file problem - 192 source files, 170
lines on average, 115 of them under 150 lines - but that a handful of files
have obvious seams, and two things outside the source tree cost more than any
long `.ts` file does. This is the cheapest of those seams and carries no risk.
