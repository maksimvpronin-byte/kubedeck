# KubeDeck 2.15.1 regression checklist

A single-fix release: folding in the manifest diff. The automated gates below
ran and passed during development, and a contract test now covers the fold keys
and the visible rows on both sides of the diff.

Earlier 2.13.x, 2.14.0 and 2.15.0 checklists still apply. Nothing outside
Compare manifests changed, so the YAML editor sections of the 2.15.0 checklist
are unaffected.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## Collapse and expand in Compare manifests

- [ ] Open a resource, Compare, and pick another open resource of the same kind.
- [ ] Press **Collapse top-level groups**: every top-level group folds, each
  folded row showing `… N lines`.
- [ ] Click the chevron of one folded group: **that group opens** and the rows
  appear in both panes. (This is the 2.15.1 fix - it used to do nothing but
  flip the arrow.)
- [ ] Click the same chevron again: the group folds back.
- [ ] Fold a nested group by its own chevron, then its parent: the parent's
  count covers the whole block, and expanding the parent leaves the nested one
  folded.
- [ ] **Expand all** opens everything and greys itself out; it stays greyed out
  until something is folded again.

## The two panes stay in step

- [ ] Both panes fold and unfold together on every click, and their line counts
  stay aligned.
- [ ] Scroll one pane: the other follows, with folds applied.
- [ ] Compare two resources that differ by added and removed lines: collapsing
  a group hides that block only - the added or removed line after it stays
  visible.
- [ ] A row that exists on one side only shows a chevron on that side, not
  beside the blank line opposite it.

## Switching what is compared

- [ ] Fold some groups, then choose a different resource in the dropdown: the
  diff opens fully expanded and **Expand all** is greyed out.
- [ ] Fold some groups, then toggle **Clean** / **Raw**: the same, and the diff
  scrolls back to the top.
- [ ] Edit the YAML in the tab behind the modal, reopen Compare: folding still
  matches the manifest shown.
- [ ] Compare against a manifest that fails to parse: the error line appears and
  the fold buttons are disabled rather than throwing.
- [ ] Open Compare with no target chosen: the current manifest folds on its own.

## Nothing else moved

- [ ] Connect and disconnect a cluster from the rail: the badges, the resource
  lists and the drawer behave as in 2.15.0.
- [ ] Open the YAML tab: the CodeMirror editor, its folding gutter and Collapse
  top-level groups are untouched by this release.
- [ ] Run an LLM analysis on a pod: the prompt preview, the streaming answer
  and Hide prompt all still work.
- [ ] Help and About report **2.15.1**.
