# KubeDeck 2.23.5 regression checklist

2.23.5 adds tests and changes no product code at all. The application cannot
regress from it. What the manual pass is for is the opposite question: the new
tests claim the application behaves a certain way, and this is the chance to
confirm they describe the real thing rather than a jsdom-shaped version of it.

Earlier 2.13.x through 2.23.4 checklists still apply.

## Automated gates

- [ ] `npm run lint`
- [ ] `npm run lint:css`
- [ ] `npm run format:check`
- [ ] `npm run test:renderer` (193 tests, up from 146)
- [ ] `npm --workspace apps/desktop run test:gateway` (170 tests, unchanged)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:release`
- [ ] `/migration/status` remains `node-only`, Node 59 / Python 0

## What the new tests claim - confirm each once in the real application

**The LLM tab.** Configure a model, open a pod's LLM tab.

- [ ] Show prompt: the prompt contains no log lines.
- [ ] Analyse: the answer arrives, and the button is unavailable while it runs.
- [ ] Show prompt during an analysis, then hide it: it hides at once, without
  waiting for the model.

**The Secret tab.** Open a Secret with a text key and a binary one.

- [ ] Nothing is shown until Reveal is pressed.
- [ ] A revealed text value is editable straight away, with no separate Edit step.
- [ ] A binary value is shown but not editable.
- [ ] Change a value and press Save: the dialog names the cluster, the Secret and
  the key, and **shows neither the old value nor the new one**.
- [ ] Cancel writes nothing; Escape closes it; Confirm writes.
- [ ] Leave a revealed value alone for the auto-hide interval: it disappears, and
  an open confirmation disappears with it.

**The container and shell pickers in Pod Terminal.**

- [ ] The list opens, Escape closes it and the focus returns to the button.
- [ ] Clicking outside closes it; clicking an option applies it.
- [ ] Picking the container that is already selected does not reconnect.

**Node labels and the columns menu.**

- [ ] The "+N" chip opens the label popover; the same chip closes it.
- [ ] Escape and a click elsewhere close it; a click inside does not.
- [ ] Clicking a label filters by the full label, not the short chip text.

**The cluster rail.**

- [ ] Exactly one cluster looks current.
- [ ] Up and Down move between clusters and wrap at the ends.
- [ ] Right-click a connected cluster: Connect is unavailable, Disconnect works.
- [ ] Right-click an unconnected one: the other way round.
- [ ] Escape, a click elsewhere, and resizing the window each dismiss the menu.

**Pod usage bars.** On a namespace with mixed pods:

- [ ] A pod with a CPU limit shows a percentage against the limit.
- [ ] A pod with a CPU request and no limit shows a percentage against the
  request, marked as the softer measure, and may read above 100%.
- [ ] A pod with neither shows the raw reading rather than N/A.

**The resource table.**

- [ ] The page size starts at 200 and offers 2000.
- [ ] Choosing a larger page shows more rows without changing anything else.

## Standard smoke test

- [ ] Connect a cluster; browse pods, deployments, services and nodes.
- [ ] Open a resource drawer and walk its tabs, including Logs with follow on.
- [ ] Start and stop a Port Forward.
- [ ] Edit and apply a manifest: dry-run and apply behave as before.
- [ ] Help and About report **2.23.5**.
