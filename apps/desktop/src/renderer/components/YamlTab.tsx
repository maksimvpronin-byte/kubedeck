import { ChevronDown, ChevronUp, FileCheck2, GitCompareArrows, RotateCcw, Save, Search } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import type { MutableRefObject, ReactNode } from "react";
import { useAsyncActionFeedback } from "../hooks/useAsyncActionFeedback";
import { AsyncActionButton, reloadActionLabels } from "./AsyncActionButton";
import type { ApiClient } from "../api";
import type { ResourceWorkspaceTab } from "../utils/workspaceTabs";

const ManifestCompare = lazy(() => import("./ManifestCompare").then((module) => ({ default: module.ManifestCompare })));

interface YamlTabProps {
  yamlDraft: string;
  setYamlDraft: (value: string) => void;
  yamlChanged: boolean;
  loading: boolean;
  status: string;
  editorRef: MutableRefObject<HTMLTextAreaElement | null>;
  onReset: () => void;
  onReloadFromCluster: () => void | boolean | Promise<void | boolean>;
  onDryRun: () => void;
  onRequestApply: () => void;
  readOnly?: boolean;
  readOnlyReason?: string;
  t: (key: string) => string;
  api: ApiClient;
  current: { clusterId: string; resource: string; namespace: string; name: string; label: string };
  candidates: ResourceWorkspaceTab[];
}

export function YamlTab({
  yamlDraft,
  setYamlDraft,
  yamlChanged,
  loading,
  status,
  editorRef,
  onReset,
  onReloadFromCluster,
  onDryRun,
  onRequestApply,
  t,
  readOnly = false,
  readOnlyReason = "",
  api,
  current,
  candidates,
}: YamlTabProps) {
  const [yamlQuery, setYamlQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const matchCount = yamlQuery ? countMatches(yamlDraft, yamlQuery) : 0;
  const reloadFeedback = useAsyncActionFeedback();
  const [compareOpen, setCompareOpen] = useState(false);
  const labels = reloadActionLabels(t);

  function jumpMatch(direction: 1 | -1) {
    if (!editorRef.current || !yamlQuery || matchCount === 0) return;
    const next = matchIndex < 0 && direction === 1 ? 0 : (matchIndex + direction + matchCount) % matchCount;
    setMatchIndex(next);
    selectMatch(editorRef.current, yamlDraft, yamlQuery, next);
  }

  return (
    <>
      <div className="yaml-toolbar">
        <div className="yaml-search-row">
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
          <span className="yaml-action-tooltip" data-tooltip="Previous match">
            <button className="icon-button yaml-icon-action" disabled={!matchCount} onClick={() => jumpMatch(-1)} aria-label="Previous match">
              <ChevronUp size={18} />
            </button>
          </span>
          <span className="yaml-action-tooltip" data-tooltip="Next match">
            <button className="icon-button yaml-icon-action" disabled={!matchCount} onClick={() => jumpMatch(1)} aria-label="Next match">
              <ChevronDown size={18} />
            </button>
          </span>
        </div>
        <div className="yaml-action-row">
          <span className="yaml-action-tooltip" data-tooltip="Reset YAML">
            <button className="icon-button yaml-icon-action" disabled={loading || !yamlChanged || readOnly} onClick={onReset} aria-label="Reset YAML">
              <RotateCcw size={18} />
            </button>
          </span>
          <span className="yaml-action-tooltip" data-tooltip="Reload YAML from cluster">
            <AsyncActionButton className="icon-button yaml-icon-action" phase={reloadFeedback.phase} labels={labels} disabled={loading} onClick={() => void reloadFeedback.run(onReloadFromCluster)} />
          </span>
          <span className="yaml-action-tooltip" data-tooltip="Dry-run YAML">
            <button className="icon-button yaml-icon-action" disabled={loading || yamlDraft.trim() === "" || readOnly} onClick={onDryRun} aria-label="Dry-run YAML">
              <FileCheck2 size={18} />
            </button>
          </span>
          <span className="yaml-action-tooltip" data-tooltip="Apply YAML">
            <button className="icon-button yaml-icon-action primary" disabled={loading || yamlDraft.trim() === "" || !yamlChanged || readOnly} onClick={onRequestApply} aria-label="Apply YAML">
              <Save size={18} />
            </button>
          </span>
          <span className="yaml-action-tooltip" data-tooltip={candidates.length ? "Compare with open resource" : "Open another resource tab of the same kind"}>
            <button className="icon-button yaml-icon-action" disabled={!candidates.length || !yamlDraft} aria-label="Compare YAML" onClick={() => setCompareOpen(true)}>
              <GitCompareArrows size={18} />
            </button>
          </span>
          {readOnly && readOnlyReason ? <span className="yaml-readonly-indicator">{readOnlyReason}</span> : null}
          {yamlChanged ? <span className="yaml-dirty-indicator">modified · auto-refresh paused</span> : null}
          {status ? (
            <span className="apply-result" role="status" aria-live="polite">
              {status}
            </span>
          ) : null}
        </div>
      </div>
      {compareOpen ? (
        <Suspense fallback={null}>
          <ManifestCompare api={api} current={current} currentYaml={yamlDraft} unsaved={yamlChanged} candidates={candidates} onClose={() => setCompareOpen(false)} />
        </Suspense>
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
