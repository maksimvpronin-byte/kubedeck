import { ChevronDown, ChevronRight, ChevronUp, FileCheck2, GitCompareArrows, ListTree, RotateCcw, Save, Search, UnfoldVertical } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useAsyncActionFeedback } from "../hooks/useAsyncActionFeedback";
import { AsyncActionButton, reloadActionLabels } from "./AsyncActionButton";
import type { ApiClient } from "../api";
import type { ResourceWorkspaceTab } from "../utils/workspaceTabs";
import { joinYamlEditSegments, yamlEditSegments, yamlFoldRegions, type YamlEditSegment, type YamlFoldRegion } from "../utils/yamlFolding";
import { highlightYamlLine, YamlSourceEditor } from "./YamlSourceEditor";

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
  const [jumpRequest, setJumpRequest] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const matchCount = useMemo(() => (yamlQuery ? countMatches(yamlDraft, yamlQuery) : 0), [yamlDraft, yamlQuery]);
  const reloadFeedback = useAsyncActionFeedback();
  const [compareOpen, setCompareOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const foldRegions = useMemo(() => yamlFoldRegions(yamlDraft), [yamlDraft]);
  const topLevelFoldPaths = useMemo(() => {
    if (foldRegions.length === 0) return [];
    const minimumDepth = Math.min(...foldRegions.map((region) => region.depth));
    return foldRegions.filter((region) => region.depth === minimumDepth).map((region) => region.path);
  }, [foldRegions]);
  // Collapsing replaces the whole set, so the button is spent once that set is
  // already exactly what is collapsed - clicking again would be a no-op.
  const collapseIsNoOp = topLevelFoldPaths.length === 0 || (collapsed.size === topLevelFoldPaths.length && topLevelFoldPaths.every((path) => collapsed.has(path)));
  const labels = reloadActionLabels(t);

  useEffect(() => {
    const paths = new Set(foldRegions.map((region) => region.path));
    setCollapsed((current) => new Set([...current].filter((path) => paths.has(path))));
  }, [foldRegions]);

  function jumpMatch(direction: 1 | -1) {
    if (!yamlQuery || matchCount === 0) return;
    const next = matchIndex < 0 && direction === 1 ? 0 : (matchIndex + direction + matchCount) % matchCount;
    setMatchIndex(next);
    // A match can sit inside a collapsed section; clear folds so the whole
    // document becomes one editable run before selecting into it.
    setCollapsed(new Set());
    // Bumped rather than acted on here: clearing the folds re-renders the
    // editor, and the jump has to run against the DOM that render produces. An
    // effect is ordered after the commit; a requestAnimationFrame scheduled
    // here is not.
    setJumpRequest((current) => current + 1);
  }

  // Deliberately keyed on the counter alone: it is the trigger, and re-running
  // on every draft or query keystroke would drag the caret around while typing.
  useEffect(() => {
    if (jumpRequest === 0 || matchIndex < 0 || !editorRef.current) return;
    selectMatch(editorRef.current, yamlDraft, yamlQuery, matchIndex);
  }, [jumpRequest]);

  function toggleFold(path: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
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
          <span className="yaml-action-tooltip" data-tooltip="Collapse top-level groups">
            <button className="icon-button yaml-icon-action" disabled={collapseIsNoOp} aria-label="Collapse top-level YAML groups" onClick={() => setCollapsed(new Set(topLevelFoldPaths))}>
              <ListTree size={18} />
            </button>
          </span>
          <span className="yaml-action-tooltip" data-tooltip="Expand all groups">
            <button className="icon-button yaml-icon-action" disabled={collapsed.size === 0} aria-label="Expand all YAML groups" onClick={() => setCollapsed(new Set())}>
              <UnfoldVertical size={18} />
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
      <FoldedYamlEditor
        value={yamlDraft}
        onChange={setYamlDraft}
        readOnly={readOnly}
        regions={foldRegions}
        collapsed={collapsed}
        onToggle={toggleFold}
        editorRef={editorRef}
        onKeyDown={(event) => {
          if (event.key === "Enter" && yamlQuery && matchCount > 0) {
            event.preventDefault();
            jumpMatch(event.shiftKey ? -1 : 1);
          }
        }}
      />
    </>
  );
}

interface FoldedYamlEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  regions: YamlFoldRegion[];
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
  editorRef: MutableRefObject<HTMLTextAreaElement | null>;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

// The manifest is edited directly, with no separate "fold view" to switch out
// of: collapsed sections render as a single summary row, and every other line
// sits inside one of possibly several editable text blocks split only where a
// collapsed region hides a run of lines. Typing in one block never touches
// the others, so a fold elsewhere in the document survives it.
function FoldedYamlEditor({ value, onChange, readOnly, regions, collapsed, onToggle, editorRef, onKeyDown }: FoldedYamlEditorProps) {
  const segments = useMemo(() => yamlEditSegments(value, regions, collapsed), [value, regions, collapsed]);
  const firstTextIndex = segments.findIndex((segment) => segment.kind === "text");

  function updateSegment(index: number, nextText: string) {
    const next = segments.map((segment, position) => (position === index ? { ...segment, text: nextText } : segment));
    onChange(joinYamlEditSegments(next));
  }

  return (
    <div className="yaml-fold-view yaml-editor" role="region" aria-label="YAML manifest" tabIndex={0}>
      {segments.map((segment, index) =>
        segment.kind === "folded" ? (
          <FoldedRegionRow key={`folded-${index}`} segment={segment} onToggle={onToggle} />
        ) : (
          <EditableYamlSegment
            key={`text-${index}`}
            segment={segment}
            regions={regions}
            collapsed={collapsed}
            onToggle={onToggle}
            readOnly={readOnly}
            editorRef={index === firstTextIndex ? editorRef : undefined}
            onKeyDown={onKeyDown}
            onChange={(nextText) => updateSegment(index, nextText)}
          />
        ),
      )}
    </div>
  );
}

function FoldedRegionRow({ segment, onToggle }: { segment: Extract<YamlEditSegment, { kind: "folded" }>; onToggle: (path: string) => void }) {
  const headerLine = segment.text.split("\n")[0] ?? "";
  const hiddenCount = segment.region.endLine - segment.region.startLine;
  return (
    <div className="yaml-segment-row yaml-fold-summary-row">
      <div className="yaml-fold-gutter-col">
        <button
          type="button"
          className="yaml-fold-gutter-button"
          aria-label={`Expand ${segment.region.label}`}
          aria-expanded={false}
          title={`Expand ${segment.region.label}`}
          onClick={() => onToggle(segment.region.path)}
        >
          <ChevronRight size={13} />
        </button>
      </div>
      <span className="yaml-line yaml-fold-summary-line">
        <span className="yaml-line-number">{segment.region.startLine}</span>
        <span className="yaml-line-code">{highlightYamlLine(headerLine)}</span>
        <span className="yaml-fold-summary"> … {hiddenCount} lines</span>
      </span>
    </div>
  );
}

interface EditableYamlSegmentProps {
  segment: Extract<YamlEditSegment, { kind: "text" }>;
  regions: YamlFoldRegion[];
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
  readOnly: boolean;
  editorRef?: MutableRefObject<HTMLTextAreaElement | null>;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onChange: (value: string) => void;
}

// A region nested inside this run (not itself collapsed) still needs its own
// fold toggle even though its lines are part of one shared textarea, so those
// buttons sit in a gutter column next to it, positioned by row offset.
function EditableYamlSegment({ segment, regions, collapsed, onToggle, readOnly, editorRef, onKeyDown, onChange }: EditableYamlSegmentProps) {
  const lineCount = segment.text.split("\n").length;
  const nestedStarts = regions.filter((region) => !collapsed.has(region.path) && region.startLine >= segment.startLine && region.startLine < segment.startLine + lineCount);

  return (
    <div className="yaml-segment-row">
      <div className="yaml-fold-gutter-col">
        {nestedStarts.map((region) => (
          <button
            key={region.path}
            type="button"
            className="yaml-fold-gutter-button yaml-fold-gutter-button-nested"
            style={{ top: `calc(${region.startLine - segment.startLine} * var(--yaml-line-height))` }}
            aria-label={`Collapse ${region.label}`}
            aria-expanded={true}
            title={`Collapse ${region.label}`}
            onClick={() => onToggle(region.path)}
          >
            <ChevronDown size={13} />
          </button>
        ))}
      </div>
      <div className="yaml-segment-editor">
        <YamlSourceEditor value={segment.text} readOnly={readOnly} startLineNumber={segment.startLine} editorRef={editorRef} onChange={onChange} onKeyDown={onKeyDown} />
      </div>
    </div>
  );
}

function countMatches(text: string, query: string) {
  if (!query) return 0;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let count = 0;
  let index = lowerText.indexOf(lowerQuery);
  while (index !== -1) {
    count += 1;
    index = lowerText.indexOf(lowerQuery, index + lowerQuery.length);
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
  // preventScroll because the container is scrolled deliberately below; a
  // focus-driven scroll first would fight it.
  element.focus({ preventScroll: true });
  if (element.value === text) element.setSelectionRange(index, index + query.length);

  // The textarea itself no longer scrolls. Since the folding editor arrived it
  // is sized to its content with overflow hidden, and `.yaml-fold-view` is the
  // one scroll container - so writing scrollTop here did nothing at all, and
  // the counter advanced while the view stayed put.
  const container = element.closest(".yaml-fold-view");
  if (!(container instanceof HTMLElement)) return;
  const line = text.slice(0, index).split("\n").length;
  const row = lineRow(container, line);
  if (!row) return;

  // Measured rather than multiplied by a line height: fold rows and segment
  // boundaries make the document taller than its line count, and a fractional
  // line box would drift over a long manifest.
  const rowBox = row.getBoundingClientRect();
  const containerBox = container.getBoundingClientRect();
  container.scrollTop += rowBox.top - containerBox.top - container.clientHeight / 2 + rowBox.height / 2;
}

// Line numbers are rendered per line and are absolute across segments, so the
// row can be found without knowing how the document was split.
function lineRow(container: HTMLElement, line: number): HTMLElement | null {
  for (const number of container.querySelectorAll(".yaml-line-number")) {
    if (number.textContent === String(line)) return number.parentElement;
  }
  return null;
}
