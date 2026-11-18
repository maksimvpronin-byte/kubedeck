# KubeDeck 2.33.0 regression checklist

The expected gateway ownership is **Node 60 / Python 0**.

## Namespace selector

- [ ] Select All namespaces, exclude two namespaces, then restore one.
  Check the scope label, resource table, Global Search and Overview.
- [ ] Switch clusters and reopen KubeDeck. Each cluster restores its own
  selection after a visit to a cluster-scoped resource.
- [ ] Create a namespace while exclusions are active. Its resources appear
  as the cluster refreshes.
- [ ] Select individual namespaces using the checkboxes, then choose All
  namespaces to reset the selection.

## Logs

- [ ] Search a pod or deployment log containing matching and surrounding
  lines. Matches are highlighted and surrounding lines remain visible.
- [ ] Toggle Matches only. The active match stays selected, and Current
  view exports the displayed lines.
- [ ] Confirm that the arrows, Enter and Shift+Enter step through matches.
  A query with zero matches leaves the full log visible in the default mode.

## Build and update

- [ ] Run the source and release checks with `npm run verify` and
  `npm run verify:release -- --tag v2.33.0`.
- [ ] Confirm that the lock contains Joi 17.13.9 and minimatch 11.0.1
  for the affected dependency chains.
- [ ] Check the GitHub release for Windows, macOS and Linux downloads and
  the three platform update manifests.
- [ ] Open a pod and run an LLM analysis. Confirm that the prompt contains
  only the permitted context.
