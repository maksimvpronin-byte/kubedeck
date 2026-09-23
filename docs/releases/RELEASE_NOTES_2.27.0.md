# KubeDeck 2.27.0 release notes

Settings laid out in sections, updates installed without the installer wizard,
and the remembered SSH host keys table repaired. Node-only ownership stays at
Node 59 / Python 0, and no route changed.

## Settings in sections

Settings was one column about three screens long: bare fields at the top,
cards in three different styles below them, a lone Open logs button between
two of them, and Local activity behind a button of its own.

- Sections are listed on the left - General, Clusters, SSH, LLM, Diagnostics,
  Local activity - and one is shown at a time. The last one opened is where
  Settings opens next. Below 1300px the list goes above the section.
- A section holding unsaved changes is marked in the list, so a change made in
  one section is not forgotten after moving to another. Save stays in the bar
  at the top, for all of them.
- Every card has one border, padding and title size, and one button style;
  General holds kubectl, language and refresh, with Open logs, above the theme.
- Checkboxes sit on the line of their label. `.settings-panel label` laid every
  label out as a caption over its field, which put the box on a line of its own,
  drawn as a 34px input.
- The diagnostics cards and the activity log read in Russian; the English notes
  the backend wrote for its maintainers are no longer shown.

## Updates install without the wizard

"Restart and install" handed the update to the installer visibly. The installer
is not one-click, so it walked through its whole wizard again - folder,
options, Finish - for an update. It now runs silently, into the folder KubeDeck
was installed to, and starts KubeDeck again once done
(`quitAndInstall(true, true)`, as TerminalDeck does).

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
- `npm run test:renderer` - **295 tests**, up from 293: remembered hosts are
  rows of plain cells, as many as the header has, with the fingerprint whole;
  settings are sections, one at a time, with unsaved ones marked
- `npm --workspace apps/desktop run test:gateway` - **185 tests**; the update
  contract requires the silent, relaunching install
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.27.0`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.27.0.md](./REGRESSION_CHECKLIST_2.27.0.md).
