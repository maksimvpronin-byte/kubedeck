# KubeDeck 2.22.6 regression checklist

2.22.6 changes how the resource table renders its rows. Nothing about what it
shows should differ, and every interaction on a row has to keep working - the
row markup moved into its own component.

Earlier 2.13.x through 2.22.5 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (127 tests, was 125)
- [ ] `npm --workspace apps/desktop run test:gateway` (166 tests, unchanged)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, Node 58 / Python 0

## Everything a row does

On a pods table with a few hundred rows:

- [ ] **Single click** opens the resource in the drawer.
- [ ] **Double click** pins it as a workspace tab (and does not open twice).
- [ ] The **namespace pill** switches the namespace selection without opening
  the drawer.
- [ ] The **checkbox** selects one row; the header checkbox selects the page.
- [ ] With rows selected, the bulk actions appear and act on exactly those rows.
- [ ] **Right click** does not open the browser context menu.
- [ ] The selected row keeps its highlight, including after a refresh.
- [ ] Cells still render as before: phase colours, container cubes, usage bars,
  node labels/annotations popovers, the age column ticking every second.
- [ ] Clicking a label chip in the node labels cell still puts it in the filter.

## What should feel different

- [ ] **Drag a column edge** on a full page of rows: resizing is smooth, and
  noticeably smoother than before on a wide table.
- [ ] **Tick a checkbox** on a 500 or 1000 row page: instant, with no pause.
- [ ] Watch a pods table for a minute while usage updates: no flicker, no jump
  of scroll position, and the usage numbers still move.
- [ ] Type in the table filter: the row count updates as before.

## Selection across refreshes

- [ ] Select a few rows and wait for an auto-refresh: the selection survives.
- [ ] Select a row, then delete that object elsewhere: after the refresh it is
  gone from the selection and the bulk action count is right.
- [ ] Switch resource tab and back: the selection is cleared as before.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.22.6**.
