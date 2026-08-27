# KubeDeck 2.22.5 release notes

Normalizing a list stops paying for a collator per label comparison. No route
changes, no API change, identical rows. Node-only ownership stays at
Node 58 / Python 0.

Section F of the 2.22.x performance pass -
[perf-audit-2.22.0-plan.md](../perf-audit-2.22.0-plan.md).

## What was happening

`meta()` builds `labelsText` for every row of every list - it is what the table
shows in the labels column and what its filter searches - and sorted the keys
with `String.prototype.localeCompare`. That builds a collator behind every
single comparison. A table of three thousand pods with eight labels each is tens
of thousands of them, on every refresh, on the main process.

## What it does now

Each key is lowercased once, and the comparison runs on those. Ties - the same
key in two cases - are broken the way the collator broke them, lowercase before
uppercase, which is the one case where a plain `<` would have reordered the
text.

Measured against the built normalizer, 3000 pods with eight labels each:

| | before | after |
|---|---|---|
| `normalizeResourceItems` | 15.75 ms | **12.66 ms** |
| the label sort alone | 6.43 ms | **3.56 ms** |

The 3000 rows produced by the two builds are byte-for-byte identical.

For the record, the alternative was a plain code-unit comparison at 2.70 ms -
faster still, but it moves a capitalized key such as `Environment` to the front
of the cell. Half the saving for none of that is the better trade.

The same call appears in `normalizers/node.ts` for node roles, labels and
annotations. It is left alone deliberately: those run per node, of which a
cluster has tens, not thousands - and the note is now in the code so the next
pass does not have to work it out again.

## Files

| File | |
|---|---|
| `apps/desktop/src/main/backend/resources/normalizers/primitives.ts` | `labelsText` with a pre-lowercased key sort |
| `apps/desktop/tests/resource-lists.contract.test.cjs` | the order is asserted against `localeCompare` itself, not a frozen string |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **125 tests**, unchanged
- `npm --workspace apps/desktop run test:gateway` - **166 tests** (was 165)
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- `/migration/status` remains `node-only`, Node 58 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.22.5.md](./REGRESSION_CHECKLIST_2.22.5.md).
