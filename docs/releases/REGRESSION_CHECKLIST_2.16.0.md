# KubeDeck 2.16.0 regression checklist

The automated gates below ran and passed during development. The manifest
highlight was also driven against a live CodeMirror before release: with four
matches painted and one accented, the editor reported no selection drawn and no
focused editor.

Earlier 2.13.x, 2.14.0, 2.15.x checklists still apply. The "Search and folding"
section of the 2.15.0 checklist is superseded by this one.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## Find in YAML: the match is not editable

- [ ] Type a query, press Enter, then press Enter again: the search steps to the
  second match. **Nothing is deleted and no newline is inserted.** (This is the
  2.16.0 fix.)
- [ ] Hold Enter down: the search keeps cycling, and the manifest stays clean -
  the dirty indicator does not appear.
- [ ] After stepping, the caret is still wherever it was, and the editor has no
  focus outline until you click into it.
- [ ] Click into the manifest, select some text by hand, press Enter: the
  selection is replaced by a newline, exactly as an editor should behave.
- [ ] Apply a manifest after searching in it: what reaches the cluster is what
  was loaded, with no stray newline.

## Find in YAML: what the highlight shows

- [ ] Every occurrence is tinted; the one being stepped to has a stronger fill
  and an outline.
- [ ] Step forward past the last match: it wraps to the first.
- [ ] With a fresh query, press **Shift+Enter** first: it lands on the **last**
  match, not the second to last.
- [ ] The counter and the accented match are always the same occurrence.
- [ ] Type into the manifest next to a highlighted match: the highlight moves
  with the text, and the viewport does not jump while typing.
- [ ] Delete text until there are fewer matches than the step you had reached:
  the counter falls back to `0/n` instead of pointing past the end.
- [ ] Collapse top-level groups, then search for text inside one: the fold opens
  and the match is scrolled to the middle.
- [ ] F3 and Shift+F3 from inside the editor step the same search.
- [ ] Clear the query: every highlight disappears.
- [ ] Open a CustomResourceDefinition (read-only manifest): searching and
  highlighting still work, and nothing becomes editable.
- [ ] Switch theme with matches highlighted: the highlight repaints with
  everything else, in light and dark.

## Search in logs

- [ ] Open Logs on a busy pod, type a query: matching lines are still filtered,
  and the `visible/total` line count is unchanged.
- [ ] Every occurrence in each visible line is marked, not just the first one.
- [ ] The `n/N` counter appears next to the arrows.
- [ ] Enter and Shift+Enter step forward and back, wrapping at both ends; the
  arrow buttons do the same and grey out when there are no matches.
- [ ] The current occurrence is accented and scrolled to the middle of the log
  pane - and only the log pane scrolls, the drawer stays put.
- [ ] Clear the query: the marks, the counter and the filter all go.
- [ ] With **Follow** on, stepping still works; new lines pull the pane back to
  the bottom, as documented.
- [ ] **Download logs → Current view** still saves the filtered lines.
- [ ] Copy logs, Refresh, Timestamps, Previous, Tail and the container/pod
  selectors all behave as in 2.15.2.

## Nothing else moved

- [ ] The YAML editor's column selection, multi-caret typing, Tab indenting and
  undo history are untouched.
- [ ] Compare manifests still folds and unfolds as in 2.15.1.
- [ ] The columns popover still opens whole on Nodes, as in 2.15.2.
- [ ] Connect and disconnect a cluster, and run an LLM analysis on a pod: both
  behave as before.
- [ ] Help and About report **2.16.0**.
