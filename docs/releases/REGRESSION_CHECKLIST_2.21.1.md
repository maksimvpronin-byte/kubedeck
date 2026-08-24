# KubeDeck 2.21.1 regression checklist

2.21.1 moves the end of the boot screen from "the cluster opened" to "the first
table has rows", and changes how the hand-over is decided. The 2.21.0 checklist
still applies in full; this one covers what changed.

Earlier 2.13.x through 2.21.0 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (124 tests)
- [ ] `npm --workspace apps/desktop run test:gateway` (154 tests, unchanged)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, Node 58 / Python 0

## Where the screen ends

- [ ] Start with a cluster that restores. The **Resources** stage appears after
  the cluster one, names what it is loading (`pods` or `nodes`), and the screen
  only leaves when the table underneath it already has rows - not before.
- [ ] There is no moment of an empty table, empty sidebar or blank workspace
  between the screen fading and the application being usable.
- [ ] Do it on a cluster with a large namespace, where the first `kubectl get`
  takes several seconds: the screen stays for all of it, and the estimate on the
  second start reflects that.

## Where the screen must not wait

- [ ] Start with **no clusters configured**: nothing loads a table, and the
  screen leaves shortly after the cluster stage rather than sitting there.
- [ ] Start with the last section being **Overview** (or Settings/Help): same -
  the screen leaves promptly and the panel loads behind it.
- [ ] Start with an **unreachable** cluster: the cluster stage turns red, the
  screen leaves, and the application shows its own error.
- [ ] Start with a cluster whose first table load **fails** (RBAC-denied kind,
  for example): the Resources stage turns red and the screen still leaves.

## The rest of the start, unchanged

- [ ] The window still opens immediately, in the theme's background colour.
- [ ] The bar still only moves forward and reaches 100% once.
- [ ] "Continue in background" still appears after ~3 s and dismisses the screen.
- [ ] Left alone on a hanging start, the screen still gives up ~20 s after the
  interface stage completed.
- [ ] Russian and English both label all six stages.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs.
- [ ] Open a Pod Terminal and a Node SSH session.
- [ ] Start and stop a Port Forward.
- [ ] Run an LLM analysis on a pod: no Secret value or log line reaches the
  prompt.
- [ ] Help and About report **2.21.1**.
