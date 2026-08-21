# KubeDeck 2.15.0 regression checklist

Automated gates below ran and passed during development. The new editor was
also driven end to end against a live build before release: rectangular
selection, multi-caret typing, the indent and line keys, undo across a
multi-caret edit, top-level collapse, and a theme switch reaching the editor's
colours.

Earlier 2.13.x and 2.14.0 checklists still apply. The YAML editor sections of
those are superseded by this one, because the editor underneath them changed.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## Column selection and multiple carets

- [ ] Hold Alt over the manifest: the pointer becomes a crosshair.
- [ ] Alt+drag down several lines: a rectangle is selected across all of them.
- [ ] Type with that rectangle active: every line takes the text at the same
  column.
- [ ] Press Backspace with it active: every line loses a character.
- [ ] Ctrl+Z once: the whole multi-caret edit comes back as one step.
- [ ] Ctrl+V with a rectangle active: the paste lands on every caret.

## Indentation and line editing

- [ ] Select several lines, press Tab: all of them shift two spaces right, and
  the selection is kept.
- [ ] Shift+Tab: they shift back, and a line already at column 0 stays there.
- [ ] Tab with nothing selected inserts an indent rather than moving focus out
  of the editor.
- [ ] Alt+Shift+↑ and Alt+Shift+↓ move the selected lines; Ctrl+D duplicates;
  Ctrl+/ comments and uncomments with `#`.
- [ ] Apply a manifest edited this way: the YAML that reaches the cluster is
  what the editor shows, indentation included.

## Search and folding

- [ ] Type a query in Find in YAML: the counter matches the highlighted result
  as you step with the arrows, Enter, Shift+Enter, F3 and Shift+F3.
- [ ] With a query in the box, press Enter **inside the editor**: a newline is
  inserted. (This changed in 2.15.0 - it used to jump to the next match.)
- [ ] Collapse top-level groups, then search for text hidden inside one: the
  folds open and the match is selected and scrolled to the middle.
- [ ] Collapse top-level groups: the same groups collapse as in 2.14.0, and the
  button greys out. Expand all re-enables it.
- [ ] Click a chevron in the gutter to fold one nested group: only that group
  folds, and Expand all is enabled.
- [ ] Folding then applying: the applied manifest still holds the folded lines.

## Read-only and the kubeconfig editor

- [ ] Open a CustomResourceDefinition: the manifest is read-only, typing does
  nothing and the Apply button stays disabled.
- [ ] Open the kubeconfig editor from a cluster: it sizes to the modal, edits,
  and saving still requires typing the cluster name.
- [ ] Open the kubeconfig of a file KubeDeck cannot write: it renders read-only.

## Theme, layout and the rest of the drawer

- [ ] Switch between every theme with the YAML tab open: keys, strings,
  numbers, comments and the gutter all repaint, in both light and dark.
- [ ] Resize the drawer and the window: the editor fills the tab, and a long
  line scrolls horizontally inside it rather than stretching the drawer.
- [ ] Switch to Logs, Describe, Related, Secret, Terminal and LLM and back to
  YAML: an unsaved draft survives the round trip and the dirty indicator stays.
- [ ] Close the drawer with unsaved YAML: the discard confirmation still
  appears.
- [ ] Compare with another open resource: the manifest diff still renders its
  YAML lines with colours.
- [ ] Reset YAML and Reload from cluster both replace the editor's content, and
  the caret does not jump while typing.
