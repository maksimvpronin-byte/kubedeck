# KubeDeck 2.13.3 regression checklist

Automated gates below ran and passed during development, including a test that
pins the prompt toggle to its own loading flag rather than the shared one.

The 2.13.0, 2.13.1 and 2.13.2 checklists still apply; nothing in them was
superseded.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## LLM prompt preview

- [ ] Show prompt, then Analyze: Hide prompt stays clickable and closes the
  preview while the analysis is still running.
- [ ] Close the preview mid-analysis, then let the answer arrive: the answer
  renders normally and Copy answer works.
- [ ] Open the preview while an analysis is running: it builds and shows without
  disturbing the run.
- [ ] Press Show prompt twice quickly: the second press does nothing until the
  first has finished collecting.
- [ ] Start an analysis while the preview is still collecting: Analyze is
  unavailable until it finishes.

## Cluster

The LLM tab lives in the resource drawer of a connected cluster, so the path to
it is worth one pass.

- [ ] Open a pod in a connected cluster, switch to the LLM tab and back to
  Summary: both render and the drawer keeps its selection.
- [ ] Disconnect the cluster with the LLM tab open: the workspace falls back to
  the disconnected panel rather than leaving a dead tab behind.
