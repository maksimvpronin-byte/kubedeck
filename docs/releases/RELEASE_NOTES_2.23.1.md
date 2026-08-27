# KubeDeck 2.23.1 release notes

A page of 500, 1000 or 2000 rows keeps only what is near the viewport in the
DOM. No route changes. Node-only ownership stays at Node 59 / Python 0.

## What was happening

The page size selector offers 50 to 2000 rows, and every row was real DOM: a
dozen cells, each a formatted component. At 2000 rows that is around 24 000
elements built on load, laid out on every resize, and walked by the browser on
every paint. Picking a large page made the table sluggish in a way the row
memoization of 2.22.6 could not fix - that stops rows being *rebuilt*, not
being *there*.

This was deferred twice, in the 2.10.3 audit and again in the 2.22.x pass, on
the grounds that it needed a dependency or a rewrite. It needed neither.

## What it does now

Above 200 rows on a page - the default, which still renders whole - the table
renders the rows near the viewport plus a dozen above and below, and holds the
rest as two spacer rows whose height is exactly what the missing rows would
occupy. The scrollbar, the page size, the row count and keyboard scrolling all
mean what they meant before.

Three details keep it honest:

- **The row height is measured, not assumed.** A nodes table draws two lines of
  usage in a cell and is taller than a pods table, and the measurement corrects
  itself as the table renders. A change under a pixel is ignored, because
  re-rendering for it would cost more than it fixes.
- **One read per frame.** A wheel gesture fires scroll events far faster than
  the table can usefully re-render, so the viewport is read in
  `requestAnimationFrame`.
- **Under the threshold nothing changes.** The default page is untouched code
  paths and untouched behaviour.

## Measured

Not measured here, deliberately: this is DOM and layout work, which the contract
suites cannot time and this machine has no cluster large enough to profile
honestly. What the tests do establish is the shape - at a page of 1000 rows the
table holds fewer than 100 in the DOM, and the spacers account for exactly the
height of the rest.

## Files

| File | |
|---|---|
| `apps/desktop/src/renderer/utils/virtualRows.ts` | new: the window and the height estimate |
| `apps/desktop/src/renderer/components/ResourceTable.tsx` | the scroll container, the measurement, the spacers |
| `apps/desktop/src/renderer/styles/resource-table.css` | the spacer takes no row styling |
| `apps/desktop/tests/resource-table.contract.test.cjs` | the window arithmetic |
| `apps/desktop/tests/resource-table-dom.contract.test.cjs` | a page of 1000 rows, scrolled |

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **142 tests** (was 139)
- `npm --workspace apps/desktop run test:gateway` - **170 tests**, unchanged
- `npm run typecheck`, `npm run build`, `npm run verify:release`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.23.1.md](./REGRESSION_CHECKLIST_2.23.1.md).
