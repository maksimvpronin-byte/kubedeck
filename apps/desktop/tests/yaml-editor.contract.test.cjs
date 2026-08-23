// The YAML editor: folding, editing, search and the kubeconfig reuse.
// Split out of renderer-controllers.contract.test.cjs; see
// docs/file-structure-refactor-plan.md, section C.
// A test marked `grep contract` reads a source file and asserts on its text.
// It breaks on a rename and passes through a real regression, so it is a
// placeholder for a behavioural test rather than one. See section C of
// docs/file-structure-refactor-plan.md.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTypeScript, rendererRoot } = require("./helpers/renderer.cjs");

test("a manifest diff fold collapses and expands both panes from one key", () => {
  const folding = loadTypeScript("utils/yamlFolding.ts", { yaml: require("yaml") });
  const model = loadTypeScript("components/ManifestCompare.tsx", { diff: require("diff"), yaml: require("yaml"), "../utils/yamlFolding": folding });
  const left = "metadata:\n  labels:\n    app: web\n  name: web\nspec:\n  replicas: 2\n";
  const right = "metadata:\n  labels:\n    app: web\n    tier: front\n  name: web\nspec:\n  replicas: 2\n";
  const rows = model.buildManifestDiff(left, right);
  const ranges = model.mergeFoldRanges([...model.diffFoldRanges(rows, "left", left), ...model.diffFoldRanges(rows, "right", right)]);

  // The same block on the left and on the right is one fold, not two rival keys:
  // collapsing every top level group used to leave the second key holding a group
  // shut while its chevron already reported the group open.
  assert.deepEqual(
    ranges.map((range) => range.key),
    [...new Set(ranges.map((range) => range.key))],
  );
  assert.equal(ranges.filter((range) => range.start === 0).length, 1);

  const topLevel = ranges.filter((range) => range.depth === Math.min(...ranges.map((item) => item.depth)));
  const collapsed = new Set(topLevel.map((range) => range.key));
  const folded = model.visibleDiffRows(rows, ranges, collapsed);
  assert.deepEqual(
    folded.map((entry) => entry.row.left),
    ["metadata:", "spec:"],
  );
  assert.ok(folded.every((entry) => entry.hiddenCount > 0));

  // One chevron expands its own group and leaves the other one folded.
  collapsed.delete(folded[0].fold.key);
  const expanded = model.visibleDiffRows(rows, ranges, collapsed);
  assert.deepEqual(
    expanded.map((entry) => entry.row.right),
    ["metadata:", "  labels:", "    app: web", "    tier: front", "  name: web", "spec:"],
  );
  assert.equal(expanded.at(-1).hiddenCount, 1);

  // A fold ends with its own block: the line the other side added inside metadata
  // folds away with it, and spec, which follows metadata, does not.
  assert.equal(ranges.find((range) => range.start === 0).end, 4);
});

// grep contract: asserts on source text, not behaviour.
test("the kubeconfig editor reuses the YAML editor and never persists credentials", () => {
  const modal = fs.readFileSync(path.join(rendererRoot, "components/KubeconfigEditorModal.tsx"), "utf8");
  const yamlTab = fs.readFileSync(path.join(rendererRoot, "components/YamlTab.tsx"), "utf8");
  const editor = fs.readFileSync(path.join(rendererRoot, "components/YamlSourceEditor.tsx"), "utf8");
  const clusterPanel = fs.readFileSync(path.join(rendererRoot, "components/ClusterPanel.tsx"), "utf8");
  const api = fs.readFileSync(path.join(rendererRoot, "api.ts"), "utf8");

  // One editor implementation, used by both surfaces, and CodeMirror lives
  // only inside it: nothing else in the renderer may reach for an EditorView.
  assert.match(modal, /<YamlSourceEditor/);
  assert.match(yamlTab, /<YamlSourceEditor/);
  assert.doesNotMatch(yamlTab, /@codemirror/);
  assert.doesNotMatch(modal, /@codemirror/);
  assert.match(editor, /from "@codemirror[/]view"/);
  // The line renderer that survived the migration serves the surfaces that
  // show a YAML line outside an editor, such as the manifest diff.
  assert.match(editor, /export function highlightYamlLine[(]/);
  // Kubeconfig content holds credentials: it must not reach persisted UI state.
  assert.doesNotMatch(modal, /saveUiState|localStorage|uiState/);
  // Saving is confirmed by typing the cluster name.
  assert.match(modal, /typedName\.trim\(\) !== cluster\.displayName/);
  assert.match(api, /saveClusterKubeconfig\(clusterId: string, content: string, typedName: string\)/);

  assert.match(clusterPanel, /clusters\.editKubeconfig/);
});

test("YAML folding preserves full source and hides only collection descendants", () => {
  const model = loadTypeScript("utils/yamlFolding.ts", { yaml: require("yaml") });
  const source = "apiVersion: v1\nmetadata:\n  name: demo\n  labels:\n    app: demo\nspec:\n  containers:\n    - name: app\n";
  const regions = model.yamlFoldRegions(source);
  const metadata = regions.find((region) => region.label === "metadata");
  assert.ok(metadata);
  const visible = model.visibleYamlLines(source, regions, new Set([metadata.path]));
  assert.equal(
    visible.some((line) => line.line.includes("name: demo")),
    false,
  );
  assert.equal(source.includes("name: demo"), true);
  assert.deepEqual(model.yamlFoldRegions("metadata:\n  name: ["), []);
});

// grep contract: asserts on source text, not behaviour.
test("the YAML editor offers column selection, multiple carets and indent shifting", () => {
  const editor = fs.readFileSync(path.join(rendererRoot, "components/YamlSourceEditor.tsx"), "utf8");

  // Alt+drag is a rectangular selection, and the crosshair pointer says so
  // before the drag starts. Without allowMultipleSelections that rectangle
  // collapses to one range and typing reaches a single line.
  assert.match(editor, /rectangularSelection[(][)]/);
  assert.match(editor, /crosshairCursor[(][)]/);
  assert.match(editor, /EditorState[.]allowMultipleSelections[.]of[(]true[)]/);
  // drawSelection paints the extra ranges; the native selection only ever
  // shows the primary one.
  assert.match(editor, /drawSelection[(][)]/);

  // Tab shifts the indent of the selected lines instead of moving focus out of
  // the editor, which is what it did while this was a plain textarea.
  assert.match(editor, /indentWithTab/);
  assert.match(editor, /indentUnit[.]of[(]" {2}"[)]/);

  // IntelliJ bindings, ahead of the default keymap because the defaults already
  // claim some of these combinations.
  for (const binding of [/"Shift-Alt-ArrowUp", run: moveLineUp/, /"Shift-Alt-ArrowDown", run: moveLineDown/, /"Mod-d", run: copyLineDown/, /"Mod-[/]", run: toggleComment/]) {
    assert.match(editor, binding);
  }
  assert.ok(editor.indexOf("intelliJStyleKeymap,") < editor.indexOf("keymap.of([indentWithTab"), "the IntelliJ bindings must be reachable before the defaults claim the same keys");

  // Undo has to survive a re-render. Rebuilding the view whenever a callback
  // identity changed would drop the history, the folds and the selection.
  assert.match(editor, /history[(][)]/);
  assert.match(editor, /onChangeRef[.]current = onChange/);
  const mountEffect = editor.slice(editor.indexOf("const host = hostRef.current"), editor.indexOf("}, []);"));
  assert.ok(mountEffect.length > 0, "the editor is built inside an effect with an empty dependency list");
  assert.match(mountEffect, /doc: initialValueRef[.]current/);
});

// grep contract: asserts on source text, not behaviour.
test("the YAML tab is editable immediately, and folding is the editor's own", () => {
  const yamlTab = fs.readFileSync(path.join(rendererRoot, "components/YamlTab.tsx"), "utf8");

  // The old "Edit full YAML" toggle (and the state it flipped) is gone - there
  // is nothing to click before the manifest becomes editable.
  assert.doesNotMatch(yamlTab, /useState[(]false[)][^;]*editing|\[editing, setEditing\]/);
  assert.doesNotMatch(yamlTab, /Edit full YAML|Open fold view|<Pencil/);

  // Folding moved into CodeMirror, so the hand-split editable segments and the
  // summary rows they needed are gone with it.
  assert.doesNotMatch(yamlTab, /yamlEditSegments|joinYamlEditSegments|FoldedYamlEditor|yaml-fold-gutter/);

  // Collapsing and expanding are always available, not only in a read-only mode,
  // and each greys out once it would no longer change anything. CodeMirror owns
  // the fold state and reports it back, which is what those checks read.
  assert.doesNotMatch(yamlTab, /disabled=\{editing/);
  assert.match(yamlTab, /onFoldedLinesChange=\{setFoldedLines\}/);
  assert.match(yamlTab, /disabled=\{foldedLines[.]length === 0\}/);
  assert.match(yamlTab, /disabled=\{collapseIsNoOp\}/);
  assert.match(yamlTab, /topLevelFoldRegions[.]every[(][(]region[)] => foldedLines[.]includes[(]region[.]startLine[)][)]/);

  // Which regions count as top level is still decided by the tested fold
  // analysis rather than by anything CodeMirror infers.
  assert.match(yamlTab, /yamlFoldRegions[(]yamlDraft[)]/);
  assert.match(yamlTab, /foldLineRanges[(]topLevelFoldRegions[)]/);
  assert.match(yamlTab, /Collapse top-level YAML groups/);
});

test("a searched-for match is highlighted rather than selected, in the manifest and in the log", () => {
  const search = loadTypeScript("utils/searchMatches.ts");
  const yamlTab = fs.readFileSync(path.join(rendererRoot, "components/YamlTab.tsx"), "utf8");
  const editor = fs.readFileSync(path.join(rendererRoot, "components/YamlSourceEditor.tsx"), "utf8");
  const logsTab = fs.readFileSync(path.join(rendererRoot, "components/LogsTab.tsx"), "utf8");
  const drawerStyles = fs.readFileSync(path.join(rendererRoot, "styles/drawer.css"), "utf8");

  // One walker for both surfaces, so the counter counts the occurrences the
  // highlight paints - in a manifest and in a log alike.
  const text = "a: one\nb: one\nc: one";
  assert.deepEqual(
    search.matchRanges(text, "one").map((range) => range.from),
    [text.indexOf("one"), text.indexOf("one", 4), text.lastIndexOf("one")],
  );
  assert.equal(search.matchRanges(text, "ONE").length, 3);
  assert.deepEqual(search.matchRanges(text, ""), []);
  // Overlapping matches are not counted twice: the scan resumes past the one it
  // just found.
  assert.deepEqual(
    search.matchRanges("aaaa", "aa").map((range) => range.from),
    [0, 2],
  );

  // From nothing chosen, forwards lands on the first match and backwards on the
  // last - stepping back from -1 used to skip the last one.
  assert.equal(search.nextMatchIndex(-1, 1, 3), 0);
  assert.equal(search.nextMatchIndex(-1, -1, 3), 2);
  assert.equal(search.nextMatchIndex(2, 1, 3), 0);
  assert.equal(search.nextMatchIndex(0, -1, 3), 2);
  assert.equal(search.nextMatchIndex(0, 1, 0), -1);

  // The editor paints its matches. A selection is what the next keystroke
  // replaces, so Enter straight after a search used to swallow the very line
  // that had just been found.
  assert.doesNotMatch(editor, /selectRange/);
  assert.match(editor, /provide: \(field\) => EditorView\.decorations\.from\(field\)/);
  assert.match(editor, /return decorations\.map\(transaction\.changes\);/);
  assert.match(editor, /\.cm-kd-search-match-current/);
  const showMatches = editor.slice(editor.indexOf("showSearchMatches(ranges, current, reveal)"), editor.indexOf("foldLineRanges(ranges)"));
  assert.match(showMatches, /setSearchMatches\.of\(/);
  assert.doesNotMatch(showMatches, /view\.focus\(\)|selection:/);

  // A match can sit inside a folded region, where the highlight would be hidden
  // behind the placeholder. Repainting after a keystroke must not drag the
  // viewport off what is being typed, so only a jump reveals.
  const jumpMatch = yamlTab.slice(yamlTab.indexOf("const jumpMatch"), yamlTab.indexOf("const findNext"));
  assert.match(jumpMatch, /handle\.unfoldAll\(\)/);
  assert.match(jumpMatch, /handle\.showSearchMatches\(matches, next, true\)/);
  assert.match(yamlTab, /showSearchMatches\(matches, currentMatch, false\)/);
  assert.doesNotMatch(jumpMatch, /setEditing|setJumpRequest|scrollTop/);

  // F3 steps the same search from inside the editor, without going back to the
  // toolbar for it.
  assert.match(yamlTab, /onFindNext=\{findNext\}/);
  assert.match(yamlTab, /onFindPrevious=\{findPrevious\}/);

  // The log viewer searches the same way. Its query still filters the lines -
  // "Current view" downloads what the filter left - and the arrows now step
  // through every occurrence inside those lines.
  assert.match(logsTab, /filteredLines = normalizedQuery \? allLines\.filter/);
  assert.match(logsTab, /matchRanges\(line, normalizedQuery\)/);
  assert.match(logsTab, /nextMatchIndex\(currentMatch, direction, matches\.length\)/);
  assert.match(logsTab, /jumpMatch\(event\.shiftKey \? -1 : 1\)/);
  assert.match(logsTab, /aria-label="Previous match"/);
  assert.match(logsTab, /aria-label="Next match"/);
  // Every occurrence in a line is marked, not only the first one.
  assert.doesNotMatch(logsTab, /const start = lower\.indexOf\(needle\);/);
  assert.match(logsTab, /className=\{isCurrent \? "is-current" : undefined\}/);
  assert.match(drawerStyles, /\.log-line mark\.is-current\s*\{/);

  // Both surfaces run out of matches the same way: a step the reader had
  // reached can outlive the text that produced it.
  assert.match(yamlTab, /const currentMatch = matchIndex < matchCount \? matchIndex : -1;/);
  assert.match(logsTab, /const currentMatch = matchIndex < matches\.length \? matchIndex : -1;/);
});
