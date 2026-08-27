# KubeDeck 2.23.1 regression checklist

2.23.1 stops rendering every row of a large page. Scrolling is where to look,
and the default page size must be entirely unaffected.

Earlier 2.13.x through 2.23.0 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (142 tests, was 139)
- [ ] `npm --workspace apps/desktop run test:gateway` (170 tests, unchanged)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `npm run smoke:cluster` against a cluster: all checks pass
- [ ] `/migration/status` remains `node-only`, Node 59 / Python 0

## The default page is unchanged

- [ ] With the page size at **200** (the default), the table looks and behaves
  exactly as before: scrolling, hover, selection, the sticky header.
- [ ] Namespaces with fewer than 200 pods: nothing about them changed.

## A large page

On a namespace with a thousand pods or more (or `all` on a busy cluster), page
size **1000**:

- [ ] The table opens without the pause it used to have.
- [ ] Scrolling to the middle and to the end is smooth, and rows are always
  drawn - no blank bands that stay blank.
- [ ] The scrollbar is the size it should be for a thousand rows, and dragging
  it to the bottom lands on the last row.
- [ ] `Ctrl+End` / `Ctrl+Home` and Page Up/Down reach the ends.
- [ ] The row count under the title still says "1000 shown of N".
- [ ] Select a row near the top, scroll to the bottom and back: it is still
  selected.
- [ ] Select rows, scroll away, and use a bulk action: it acts on the rows that
  were selected, including ones not currently on screen.
- [ ] Sort by a column and scroll: the order holds all the way down.
- [ ] Filter down to a handful of rows and back: the table recovers.
- [ ] Try the same at page size **2000**.

## Row heights

- [ ] The **nodes** table (taller rows, two lines of usage) scrolls without
  drift: the last row is reachable and nothing overlaps.
- [ ] Resize the window while scrolled into the middle of a large page: the
  rows stay put.
- [ ] Toggle a column on or off from the columns menu while scrolled: no jump.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.23.1**.
