# KubeDeck 2.26.1 release notes

One fix, in Settings. Node-only ownership stays at Node 59 / Python 0, and no
route changed.

## Remembered SSH host keys fit their card

- The last cell of each row - the Forget button - carried `row-actions`, a
  flex layout class. On a table cell that takes the cell out of the table's
  columns: every row came out narrower than the header, and the button was
  cut off at the row's edge. It is a plain table cell now, aligned right.
- The fingerprint was cut to an ellipsis by the fixed layout every table in the
  application shares, so a changed key could not be compared. This table is
  laid out by its content; the fingerprint column takes the spare width, wraps
  when it must, and carries the full value in its tooltip.

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **294 tests**, up from 293: remembered hosts are
  rows of plain cells, as many as the header has, with the fingerprint whole
- `npm --workspace apps/desktop run test:gateway` - **185 tests**
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.26.1`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.26.1.md](./REGRESSION_CHECKLIST_2.26.1.md).
