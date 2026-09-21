# KubeDeck 2.24.5 release notes

One fix, reported from a real cluster. Node-only ownership stays at Node 59 /
Python 0, and no route changed.

## Node disk bars no longer flicker

On the Nodes table the yellow Disk bars kept flashing on and off.

The disk reading is not part of the node list: it comes from each node's
kubelet, one request per node, and is cached for five minutes. A refresh of the
list - polling, or a watch event, which a node produces every time its kubelet
reports in - replaced every row with one that had no disk reading. For a frame
the bars were empty, then the disk loader put them back from its cache. On a
cluster of seventy nodes that happened constantly.

- A node list refresh now keeps each row's disk reading, matched by uid, until
  the disk loader replaces it. Status, labels and everything else on the row
  come from the new list as before.
- A row that already brings its own disk reading keeps it, and a node that was
  not on screen before has nothing carried onto it.

## Verification

- `npm run lint`, `npm run lint:css`, `npm run format:check`
- `npm run test:renderer` - **269 tests**, up from 268: a node list refresh
  keeps the disk reading on screen, takes the list's own fields from the new
  rows, and leaves a row with its own reading alone
- `npm --workspace apps/desktop run test:gateway` - **182 tests**
- `npm run typecheck`, `npm run build`, `npm run verify:release --tag v2.24.5`
- `/migration/status` remains `node-only`, Node 59 / Python 0

Manual pass: [REGRESSION_CHECKLIST_2.24.5.md](./REGRESSION_CHECKLIST_2.24.5.md).
