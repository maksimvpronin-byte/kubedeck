# KubeDeck 2.15.0 release notes

KubeDeck 2.15.0 replaces the hand-rolled YAML editor with CodeMirror 6. The
manifest editor now has column selection, multiple carets, real indent
shifting and an undo history that survives everything the editor does to it.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## Why the editor had to be replaced rather than extended

The old editor was a `<textarea>` with a highlight layer painted behind it. A
textarea has exactly one selection and exactly one caret - that is a browser
constraint, not something the code was choosing - so no amount of work on it
could produce IntelliJ's Alt+drag column edit. Everything below follows from
moving off it.

## Column selection and multiple carets

- **Alt+drag** selects a rectangle across lines. The pointer turns into a
  crosshair while Alt is held, so the mode is visible before the drag starts.
- Typing, deleting and pasting apply at **every caret at once**, and every
  caret survives the edit.
- Undo takes a multi-caret edit back as one step, not one step per caret.

## Indentation and line editing

`Tab` had no handler at all before this release: pressing it in the YAML editor
moved focus out of the editor. It now shifts the indent of whatever is
selected.

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Indent / outdent every selected line, two spaces at a time |
| `Alt+Shift+↑` / `Alt+Shift+↓` | Move the selected lines up or down |
| `Ctrl+D` | Duplicate the line |
| `Ctrl+/` | Comment or uncomment the selected lines |
| `F3` / `Shift+F3` | Step the toolbar's search without leaving the text |
| `Ctrl+Z` / `Ctrl+Y` | Undo and redo, editor-owned rather than the browser's |

## Folding is the editor's own now

The manifest used to be split into several textareas around each collapsed
region, with the fold chevrons positioned by hand in a gutter column beside
them. CodeMirror folds in place, so the document is one editor again and the
chevrons are its gutter.

What did not change is which groups are foldable: that is still decided by
KubeDeck's own YAML analysis, so **Collapse top-level groups** collapses
exactly what it collapsed before, and both buttons still grey out once they
would no longer do anything. A search match inside a folded region still opens
the folds before selecting - the editor now scrolls to it itself, rather than
KubeDeck measuring rows and writing `scrollTop`.

## Syntax colours follow the theme, as before

Highlighting comes from the Lezer YAML grammar instead of a line-by-line
regular expression, but every colour is still read from the application's CSS
variables. Switching theme repaints the editor with everything else; nothing is
frozen to a bundled editor theme.

## What this costs

The editor is a separate lazily-loaded chunk, so it is fetched when a resource
drawer or the kubeconfig editor is opened rather than at startup. That chunk
grows from about 2 KB to about 334 KB (109 KB gzipped). CodeMirror, Lezer and
their bundled transitive packages are MIT-licensed and are listed in
`docs/third-party-notices.md`.

## One behaviour deliberately dropped

With text in the "Find in YAML" box, `Enter` **inside the editor** used to jump
to the next match instead of inserting a newline, which meant a query left in
the box quietly blocked typing new lines. `Enter` in the editor is now a
newline. `Enter` and `Shift+Enter` still step the search from the search field,
and `F3` / `Shift+F3` step it from inside the text.
