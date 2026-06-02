import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { useRef, useState } from "react";
import type { MutableRefObject, ReactNode } from "react";

interface YamlTabProps {
  yamlDraft: string;
  setYamlDraft: (value: string) => void;
  yamlChanged: boolean;
  loading: boolean;
  applyResult: string;
  operationTitle: string;
  operationOutput: string;
  editorRef: MutableRefObject<HTMLTextAreaElement | null>;
  onReset: () => void;
  onReloadFromCluster: () => void;
  onDryRun: () => void;
  onRequestApply: () => void;
  onCopyOutput: () => void;
  readOnly?: boolean;
  readOnlyReason?: string;
}

export function YamlTab({
  yamlDraft,
  setYamlDraft,
  yamlChanged,
  loading,
  applyResult,
  operationTitle,
  operationOutput,
  editorRef,
  onReset,
  onReloadFromCluster,
  onDryRun,
  onRequestApply,
  onCopyOutput,
  readOnly = false,
  readOnlyReason = "",
}: YamlTabProps) {
  const [yamlQuery, setYamlQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const matchCount = yamlQuery ? countMatches(yamlDraft, yamlQuery) : 0;

  function jumpMatch(direction: 1 | -1) {
    if (!editorRef.current || !yamlQuery || matchCount === 0) return;
    const next = matchIndex < 0 && direction === 1 ? 0 : (matchIndex + direction + matchCount) % matchCount;
    setMatchIndex(next);
    selectMatch(editorRef.current, yamlDraft, yamlQuery, next);
  }

  return (
    <>
      <div className="yaml-toolbar">
        <label className="yaml-search">
          <Search size={14} />
          <input
            ref={searchRef}
            value={yamlQuery}
            onChange={(event) => {
              setYamlQuery(event.target.value);
              setMatchIndex(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                jumpMatch(event.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Find in YAML"
          />
        </label>
        <span className="match-counter">{yamlQuery ? `${matchIndex >= 0 ? matchIndex + 1 : 0}/${matchCount}` : ""}</span>
        <button className="icon-button" disabled={!matchCount} onClick={() => jumpMatch(-1)} title="Previous match">
          <ChevronUp size={15} />
        </button>
        <button className="icon-button" disabled={!matchCount} onClick={() => jumpMatch(1)} title="Next match">
          <ChevronDown size={15} />
        </button>
        <button disabled={loading || !yamlChanged || readOnly} onClick={onReset} title="Discard local edits and return to the last loaded YAML">Reset</button>
        <button disabled={loading} onClick={onReloadFromCluster} title="Discard local edits and reload YAML from the cluster">Reload</button>
        <button disabled={loading || yamlDraft.trim() === "" || readOnly} onClick={onDryRun}>Dry-run</button>
        <button className="primary" disabled={loading || yamlDraft.trim() === "" || !yamlChanged || readOnly} onClick={onRequestApply}>Apply</button>
        {readOnly && readOnlyReason ? <span className="yaml-readonly-indicator">{readOnlyReason}</span> : null}
        {yamlChanged ? <span className="yaml-dirty-indicator">modified · auto-refresh paused</span> : null}
        {applyResult ? <span className="apply-result">{applyResult}</span> : null}
      </div>
      {operationOutput ? (
        <section className="yaml-operation-output">
          <header>
            <strong>{operationTitle}</strong>
            <button className="icon-text" onClick={onCopyOutput}>Copy output</button>
          </header>
          <pre>{operationOutput}</pre>
        </section>
      ) : null}
      <div className="yaml-ide-editor">
        <pre className="yaml-editor yaml-highlight-layer" ref={highlightRef} aria-hidden="true">
          {highlightYaml(yamlDraft)}
        </pre>
        <textarea
          ref={editorRef}
          className="yaml-editor yaml-editor-input"
          value={yamlDraft}
          readOnly={readOnly}
          onChange={(event) => {
            if (readOnly) return;
            setYamlDraft(event.target.value);
          }}
          onScroll={(event) => {
            if (!highlightRef.current) return;
            highlightRef.current.scrollTop = event.currentTarget.scrollTop;
            highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && yamlQuery && matchCount > 0) {
              event.preventDefault();
              jumpMatch(event.shiftKey ? -1 : 1);
            }
          }}
          spellCheck={false}
        />
      </div>
    </>
  );
}

function highlightYaml(value: string): ReactNode[] {
  const lines = value.split("\n");
  return lines.map((line, index) => (
    <span className="yaml-line" key={index}>
      <span className="yaml-line-number">{index + 1}</span>
      <span className="yaml-line-code">{highlightYamlLine(line)}</span>
      {index < lines.length - 1 ? "\n" : ""}
    </span>
  ));
}

function highlightYamlLine(line: string): ReactNode {
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
  if (/^(['"]).*\1$/.test(trimmed)) return <>{leading}<span className="yaml-string">{trimmed}</span></>;
  if (/^(true|false|null|~)$/i.test(trimmed)) return <>{leading}<span className="yaml-constant">{trimmed}</span></>;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return <>{leading}<span className="yaml-number">{trimmed}</span></>;
  if (/^[>|]-?$/.test(trimmed)) return <>{leading}<span className="yaml-punctuation">{trimmed}</span></>;
  return text;
}

function findYamlCommentIndex(line: string) {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "'" || char === '"') && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === "#" && !quote && (index === 0 || /\s/.test(line[index - 1]))) return index;
  }
  return -1;
}

function countMatches(text: string, query: string) {
  if (!query) return 0;
  let count = 0;
  let index = text.toLowerCase().indexOf(query.toLowerCase());
  while (index !== -1) {
    count += 1;
    index = text.toLowerCase().indexOf(query.toLowerCase(), index + query.length);
  }
  return count;
}

function selectMatch(element: HTMLTextAreaElement, text: string, query: string, targetIndex: number) {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let index = -1;
  let from = 0;
  for (let i = 0; i <= targetIndex; i += 1) {
    index = lowerText.indexOf(lowerQuery, from);
    if (index === -1) return;
    from = index + lowerQuery.length;
  }
  element.focus();
  element.setSelectionRange(index, index + query.length);
  const lineHeight = 16;
  const line = text.slice(0, index).split("\n").length;
  element.scrollTop = Math.max(0, (line - 6) * lineHeight);
}
