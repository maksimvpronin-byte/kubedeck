# KubeDeck 2.28.1 release notes

One fix, to the tables: no more horizontal scrollbar over empty space.

## A table no longer scrolls sideways over empty columns

A column keeps the width it was given for its resource in every cluster. Node
fitted to one cluster's long node names stayed that wide in a cluster with short
ones, and so did Namespace; the table ran past the window over empty space, and
a horizontal scrollbar appeared with nothing to scroll to.

- While a table does not fit the window, a text column is drawn no wider than
  its longest value on the page and its header: Name, Namespace, Node, Phase,
  Ready, Restarts, Age and the like. The empty space goes to the end of the row.
- A column whose text is longer than it is keeps its width, so nothing is cut
  shorter than before.
- The widths you set are kept as they are. In a cluster whose values need the
  space, the columns take it again.
- A table that fits the window, and one stretched to the window width, are
  unchanged. Dragging a column border starts from the width it is drawn at.

## Verification

Node-only ownership stays at Node 59 / Python 0, and no route changed.

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **301 tests**, up from 300: a table that does not
  fit gives back only the empty space of its text columns, and one that fits
  keeps every width
- `npm --workspace apps/desktop run test:gateway` - **186 tests**
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.28.1`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.28.1.md](./REGRESSION_CHECKLIST_2.28.1.md).
