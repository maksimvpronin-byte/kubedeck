# KubeDeck 2.22.4 release notes

Global Search stops normalizing what it is about to throw away. No route
changes, no API change, and identical results. Node-only ownership stays at
Node 58 / Python 0.

Section C of the 2.22.x performance pass -
[perf-audit-2.22.0-plan.md](../perf-audit-2.22.0-plan.md).

## What was happening

`rankRawItems` normalized every raw object it was handed - for pods a full
`podSummary`: containers, restart diagnostics, ports, sorted labels - and only
then asked whether the query matched it at all. On a cluster-wide search that is
the cost of a whole pod list, repeated for every resource kind in the fan-out,
to keep at most a few rows.

The scoring itself lowercased the same text repeatedly: once for the joined
haystack, again for the name on each comparison, and again per field when
collecting `matchedFields`. The haystack was also built by joining every field
into one string - a few kilobytes per item, allocated to be scanned once.

## What it does now

An item is ruled out from the raw object, before any normalization. The text
behind that decision is built once and reused by the scoring that follows, so a
matching item still serializes its labels, annotations, status and spec exactly
once.

The one thing a summary can add to that text is `kind` - a CRD reports the kind
it defines rather than `CustomResourceDefinition`, and a normalizer supplies a
static kind for a list entry that carries none - so the rule-out offers every
candidate. An extra candidate can only produce a false positive, which the real
scoring then drops; it cannot hide a match. That is what keeps the results
identical.

Two smaller things fall out of it: each field is lowercased once, and the
haystack is no longer joined into one string at all. A token never contains
whitespace, because that is what the query was split on, so a token found in the
join must lie inside a single field - scanning the fields answers the same
question without the copy.

## Measured

400 pods, limit 40, against the built engine:

| query | before | after |
|---|---|---|
| matches nothing | 2.94 ms | **0.97 ms** |
| matches ~8% | 0.96 ms | **0.68 ms** |
| matches everything | 0.35 ms | 0.41 ms |

The first row is what typing looks like: most keystrokes match little or
nothing, across every resource kind in the fan-out. The last row is slower by
0.06 ms because the 40 items that do match build their field text twice, once
for the rule-out and once for the scoring - it is bounded by the limit and was
not worth complicating the code to avoid.

Results were compared row by row between the two builds over 56
resource/query combinations - pods with and without a `kind`, CRDs matched by
their defined kind, ingresses, config maps, phrase queries, an IP address, a
non-matching query - and are byte-for-byte identical.

## Files

| File | |
|---|---|
| `apps/desktop/src/main/backend/search/searchEngine.ts` | rule-out before normalization, text built once, per-field scan |
| `apps/desktop/tests/search.contract.test.cjs` | 3 new tests |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **125 tests**, unchanged
- `npm --workspace apps/desktop run test:gateway` - **165 tests** (was 162)
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- New tests: a pod that cannot match is never summarized (proved with a getter
  on `spec.containers`, which only the normalizer reads), a CRD is still found
  by the kind it defines while a near-miss still does not match, and
  `matchedFields` keeps its order.
- `/migration/status` remains `node-only`, Node 58 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.22.4.md](./REGRESSION_CHECKLIST_2.22.4.md).
