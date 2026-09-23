# KubeDeck 2.26.0 release notes

Tables fit their content instead of the monitor. Node-only ownership stays at
Node 59 / Python 0, and no route changed.

## Compact tables

Every table was stretched to the width of the window, and the spare width was
shared out between its columns, so the larger the monitor, the wider every
column and the further apart the values of one row.

- A table is now as wide as its columns, and the room to its right stays
  empty. Column widths are pixels, the same on every monitor.
- The columns menu has **Stretch to the window width**, for a table that should
  fill the window as before. It is remembered per resource tab, with that
  tab's columns and widths, and Reset columns turns it off again.
- **Fit columns to content** sets every column to the width of its longest
  value on screen - the header and the rows around the viewport - within
  48-480px. The usage bars keep their width: they are drawn to the column
  and have none of their own.
- A double-click on a column's border fits just that column.
- A column can be dragged down to 48px, from 72px, so Ready or Age can be as
  narrow as what they hold.

Fitting measures the table in the browser's automatic layout for one
synchronous moment and puts the fixed layout back before the next paint, so
nothing flickers.

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **293 tests**, up from 291: a table is compact
  until told to fill, per tab and across a restart; fit sets every column to
  its content and a border double-click fits one
- `npm --workspace apps/desktop run test:gateway` - **185 tests**
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.26.0`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.26.0.md](./REGRESSION_CHECKLIST_2.26.0.md).
