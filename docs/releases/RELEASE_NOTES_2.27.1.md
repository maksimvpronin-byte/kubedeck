# KubeDeck 2.27.1 release notes

One fix, to the tables. Node-only ownership stays at Node 59 / Python 0, and no
route changed.

## Compact tables reach the edge of the window

2.26.0 made every table as wide as its columns. The table element itself was
that wide too, so its header background, row lines, hover and selection all
ended with the last column, and on a wide monitor the table stopped halfway
across with nothing after it - it looked cut off.

- The columns keep the widths they were given or fitted to.
- An empty last column, with no width of its own, takes the rest of the row, so
  the table spans the window again.
- Stretch to the window width is unchanged: there the columns share the spare
  width and there is no empty column.
- Fitting columns to content is unaffected; the empty column is not measured.

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **296 tests**, up from 295: a compact table ends in
  an empty column in its header and every row, and a stretched one has none
- `npm --workspace apps/desktop run test:gateway` - **185 tests**
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.27.1`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.27.1.md](./REGRESSION_CHECKLIST_2.27.1.md).
