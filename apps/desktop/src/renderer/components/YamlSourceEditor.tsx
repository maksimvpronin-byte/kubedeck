import { copyLineDown, defaultKeymap, history, historyKeymap, indentWithTab, moveLineDown, moveLineUp, toggleComment } from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import { codeFolding, foldEffect, foldedRanges, foldGutter, HighlightStyle, indentUnit, syntaxHighlighting, unfoldAll } from "@codemirror/language";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { crosshairCursor, Decoration, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, rectangularSelection } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { MutableRefObject, ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { SearchMatch } from "../utils/searchMatches";

// What the surfaces around the editor are allowed to ask of it. Everything
// CodeMirror-shaped stays inside this module: the YAML tab and the kubeconfig
// modal drive the editor through these calls and never hold an EditorView.
export interface YamlEditorHandle {
  focus(): void;
  // Character offsets into the document, which is how the toolbar search
  // counts. The matches are painted, never selected, and `reveal` says whether
  // this is a jump - which scrolls the current match to the middle - or a
  // repaint after the text changed, which must leave the viewport alone.
  showSearchMatches(ranges: readonly SearchMatch[], current: number, reveal: boolean): void;
  // 1-based inclusive line numbers, which is what `yamlFoldRegions` produces.
  foldLineRanges(ranges: ReadonlyArray<{ startLine: number; endLine: number }>): void;
  unfoldAll(): void;
}

interface YamlSourceEditorProps {
  value: string;
  readOnly?: boolean;
  ariaLabel?: string;
  editorRef?: MutableRefObject<YamlEditorHandle | null>;
  // The first line of every region currently folded, so the surface above can
  // tell whether its collapse control would still change anything.
  onFoldedLinesChange?: (startLines: number[]) => void;
  // Bound to F3 and Shift-F3 inside the editor, so the toolbar's search can be
  // stepped through without leaving the text.
  onFindNext?: () => void;
  onFindPrevious?: () => void;
  onChange: (value: string) => void;
}

// The application owns its palette in CSS variables and switches theme at
// runtime, so every colour here is a variable rather than a literal: a theme
// change reaches the editor without rebuilding it.
const yamlHighlightStyle = HighlightStyle.define([
  { tag: [tags.definition(tags.propertyName), tags.propertyName, tags.attributeName], color: "var(--focus-ring)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--success-text)" },
  { tag: [tags.number, tags.integer, tags.float], color: "var(--warning-text)" },
  { tag: [tags.bool, tags.null, tags.atom, tags.keyword], color: "var(--text-strong)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--muted-soft)", fontStyle: "italic" },
  { tag: [tags.punctuation, tags.separator, tags.brace, tags.bracket, tags.meta], color: "var(--muted)" },
]);

// The toolbar search paints its matches instead of selecting them. A selection
// is what the next keystroke replaces, so Enter straight after a search used to
// swallow the very text that had just been found; a decoration is visual only,
// and it leaves the caret and the focus where the reader put them.
const setSearchMatches = StateEffect.define<{ ranges: readonly SearchMatch[]; current: number }>();
const searchMatchMark = Decoration.mark({ class: "cm-kd-search-match" });
const currentSearchMatchMark = Decoration.mark({ class: "cm-kd-search-match cm-kd-search-match-current" });

const searchMatchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSearchMatches)) {
        const { ranges, current } = effect.value;
        return Decoration.set(
          ranges.map((range, index) => (index === current ? currentSearchMatchMark : searchMatchMark).range(range.from, range.to)),
          true,
        );
      }
    }
    // Typing next to a highlighted match arrives before the surface above can
    // recompute the ranges, so the existing ones move with the text rather than
    // staying behind on whatever now occupies those offsets.
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const yamlEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--text)",
    backgroundColor: "transparent",
    fontSize: "12px",
  },
  "&.cm-focused": {
    outline: "1px solid var(--focus-ring)",
    outlineOffset: "-1px",
  },
  ".cm-scroller": {
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
    lineHeight: "16px",
  },
  ".cm-content": {
    padding: "10px 0",
    caretColor: "var(--text)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--muted-soft)",
    border: "0",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 12px",
    minWidth: "38px",
  },
  ".cm-foldGutter .cm-gutterElement": {
    padding: "0 2px",
    color: "var(--muted)",
    cursor: "pointer",
  },
  ".cm-foldGutter .cm-gutterElement:hover": { color: "var(--text)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--text) 5%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--muted)" },
  // Extra selections and the rectangular one are drawn by `drawSelection`, so
  // the native ::selection colour never reaches them.
  //
  // The accent is laid on thinly. A selection has to sit behind syntax-coloured
  // text rather than on top of a blank line, and property names are painted in
  // `--focus-ring`, which every theme derives from the same accent as
  // `--primary-border`: at the 70% this used to be, a selected key was the
  // colour of its own highlight and simply disappeared. Thirty percent keeps
  // the tint the theme asks for while every token holds more than half the
  // contrast it has on the bare background.
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--primary-border) 30%, transparent)",
  },
  // Every caret of a multi-caret edit, not only the primary one.
  ".cm-cursor, .cm-dropCursor, .cm-cursor-secondary": { borderLeftColor: "var(--text)" },
  // Every match of the toolbar search, with the one being stepped to picked out
  // of them. The hue is the log viewer's, so a search still reads as the same
  // thing in both tabs, but the log lays it on twice as thick: a log line is one
  // colour and `.log-line mark` repaints it, so no amount of wash can cost it
  // anything. Here the text underneath keeps its syntax colours, and at the 85%
  // the current match used to be, a matched number sat at 1.65:1. The outline,
  // not the fill, is what tells the current match from the rest.
  ".cm-kd-search-match": {
    backgroundColor: "color-mix(in srgb, var(--warning-border) 25%, transparent)",
    borderRadius: "2px",
  },
  ".cm-kd-search-match-current": {
    backgroundColor: "color-mix(in srgb, var(--warning-border) 45%, transparent)",
    outline: "1px solid var(--warning-text)",
  },
  ".cm-foldPlaceholder": {
    background: "transparent",
    border: "0",
    color: "var(--muted)",
    fontStyle: "italic",
  },
});

// IntelliJ muscle memory. These sit ahead of the default keymap because some of
// the combinations are already bound to something else there.
const intelliJStyleKeymap = keymap.of([
  { key: "Shift-Alt-ArrowUp", run: moveLineUp, preventDefault: true },
  { key: "Shift-Alt-ArrowDown", run: moveLineDown, preventDefault: true },
  { key: "Mod-d", run: copyLineDown, preventDefault: true },
  { key: "Mod-/", run: toggleComment, preventDefault: true },
]);

// Reported as handled only when there is a search to step through, so the key
// keeps whatever meaning it has elsewhere when the toolbar has no query.
function runFind(handler: (() => void) | undefined): boolean {
  if (!handler) return false;
  handler();
  return true;
}

function foldedStartLines(view: EditorView): number[] {
  const lines: number[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from) => {
    lines.push(view.state.doc.lineAt(from).number);
  });
  return lines;
}

export function YamlSourceEditor({ value, readOnly = false, ariaLabel, editorRef, onFoldedLinesChange, onFindNext, onFindPrevious, onChange }: YamlSourceEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  // Held in refs so a new callback identity never tears the editor down and
  // rebuilds it, which would drop the selection, the folds and the undo history.
  const onChangeRef = useRef(onChange);
  const onFoldedLinesChangeRef = useRef(onFoldedLinesChange);
  const onFindNextRef = useRef(onFindNext);
  const onFindPreviousRef = useRef(onFindPrevious);
  const ariaLabelRef = useRef(ariaLabel);
  const initialValueRef = useRef(value);
  const initialReadOnlyRef = useRef(readOnly);
  onChangeRef.current = onChange;
  onFoldedLinesChangeRef.current = onFoldedLinesChange;
  onFindNextRef.current = onFindNext;
  onFindPreviousRef.current = onFindPrevious;
  ariaLabelRef.current = ariaLabel;

  // Built once per mount: value, read-only state and callbacks are all pushed
  // into the live editor by the effects below rather than rebuilding it.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          lineNumbers(),
          foldGutter(),
          codeFolding(),
          history(),
          drawSelection(),
          dropCursor(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          // The pair that makes Alt+drag a column selection, and turns the
          // pointer into a crosshair while Alt is held so it can be seen before
          // the drag starts.
          rectangularSelection(),
          crosshairCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentUnit.of("  "),
          yaml(),
          syntaxHighlighting(yamlHighlightStyle),
          searchMatchField,
          yamlEditorTheme,
          intelliJStyleKeymap,
          keymap.of([
            { key: "F3", run: () => runFind(onFindNextRef.current), preventDefault: true },
            { key: "Shift-F3", run: () => runFind(onFindPreviousRef.current), preventDefault: true },
            { key: "Mod-g", run: () => runFind(onFindNextRef.current), preventDefault: true },
            { key: "Shift-Mod-g", run: () => runFind(onFindPreviousRef.current), preventDefault: true },
          ]),
          // Tab indents the selected lines rather than leaving the editor,
          // which is what a YAML editor needs it for.
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          readOnlyCompartment.current.of([EditorState.readOnly.of(initialReadOnlyRef.current), EditorView.editable.of(!initialReadOnlyRef.current)]),
          EditorView.contentAttributes.of(ariaLabelRef.current ? { "aria-label": ariaLabelRef.current } : {}),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
            // A fold or an unfold arrives as an effect, not as a document
            // change, so both have to be watched to keep the collapse control
            // honest about whether it would still do anything.
            if (update.docChanged || update.transactions.some((transaction) => transaction.effects.length > 0)) {
              onFoldedLinesChangeRef.current?.(foldedStartLines(update.view));
            }
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    // Equal on every keystroke, because the change that produced this value came
    // out of this editor. Dispatching anyway would fight the caret.
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartment.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  useEffect(() => {
    if (!editorRef) return undefined;
    const handle: YamlEditorHandle = {
      focus() {
        viewRef.current?.focus();
      },
      showSearchMatches(ranges, current, reveal) {
        const view = viewRef.current;
        if (!view) return;
        const limit = view.state.doc.length;
        const clamped = ranges.map((range) => ({ from: Math.max(0, Math.min(range.from, limit)), to: Math.max(0, Math.min(range.to, limit)) })).filter((range) => range.to > range.from);
        const target = current >= 0 ? clamped[current] : undefined;
        const scroll = reveal && target ? [EditorView.scrollIntoView(target.from, { y: "center" })] : [];
        view.dispatch({ effects: [setSearchMatches.of({ ranges: clamped, current }), ...scroll] });
      },
      foldLineRanges(ranges) {
        const view = viewRef.current;
        if (!view) return;
        const document = view.state.doc;
        const effects = ranges.flatMap((range) => {
          if (range.startLine < 1 || range.endLine > document.lines || range.endLine <= range.startLine) return [];
          return [foldEffect.of({ from: document.line(range.startLine).to, to: document.line(range.endLine).to })];
        });
        if (effects.length) view.dispatch({ effects });
      },
      unfoldAll() {
        const view = viewRef.current;
        if (view) unfoldAll(view);
      },
    };
    editorRef.current = handle;
    return () => {
      editorRef.current = null;
    };
  }, [editorRef]);

  return <div className="yaml-ide-editor" ref={hostRef} />;
}

// Still hand-rolled: this renders one YAML line as read-only markup for the
// surfaces that show a line outside an editor, such as the manifest diff.
export function highlightYamlLine(line: string): ReactNode {
  const commentIndex = findYamlCommentIndex(line);
  const code = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const comment = commentIndex >= 0 ? line.slice(commentIndex) : "";
  const keyMatch = code.match(/^(\s*)(-\s*)?([^:#\n][^:\n]*?)(:\s*)(.*)$/);
  if (!keyMatch) {
    return (
      <>
        {highlightYamlScalars(code)}
        {comment ? <span className="yaml-comment">{comment}</span> : null}
      </>
    );
  }
  return (
    <>
      {keyMatch[1]}
      {keyMatch[2] ? <span className="yaml-punctuation">{keyMatch[2]}</span> : null}
      <span className="yaml-key">{keyMatch[3]}</span>
      <span className="yaml-punctuation">{keyMatch[4]}</span>
      {highlightYamlScalars(keyMatch[5])}
      {comment ? <span className="yaml-comment">{comment}</span> : null}
    </>
  );
}

function highlightYamlScalars(text: string): ReactNode {
  if (!text) return text;
  const trimmed = text.trim();
  const leading = text.slice(0, text.length - text.trimStart().length);
  if (/^(['"]).*\1$/.test(trimmed))
    return (
      <>
        {leading}
        <span className="yaml-string">{trimmed}</span>
      </>
    );
  if (/^(true|false|null|~)$/i.test(trimmed))
    return (
      <>
        {leading}
        <span className="yaml-constant">{trimmed}</span>
      </>
    );
  if (/^-?\d+(\.\d+)?$/.test(trimmed))
    return (
      <>
        {leading}
        <span className="yaml-number">{trimmed}</span>
      </>
    );
  if (/^[>|]-?$/.test(trimmed))
    return (
      <>
        {leading}
        <span className="yaml-punctuation">{trimmed}</span>
      </>
    );
  return text;
}

function findYamlCommentIndex(line: string) {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "'" || char === '"') && line[index - 1] !== "\\") {
      quote = quote === char ? null : (quote ?? char);
    }
    if (char === "#" && !quote && (index === 0 || /\s/.test(line[index - 1]))) return index;
  }
  return -1;
}
